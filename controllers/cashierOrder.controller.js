const mongoose = require("mongoose");
const Order = require("../modules/orders/Order");
const Product = require("../modules/products/Product");
const Sale = require("../modules/sales/Sale");
const Customer = require("../modules/Customer/Customer");
const Warehouse = require("../modules/Warehouse/Warehouse");

function parseDate(d, endOfDay = false) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else dt.setHours(0, 0, 0, 0);
  return dt;
}

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function normCurrency(c) {
  const x = String(c || "").toUpperCase();
  return x === "UZS" || x === "USD" ? x : null;
}

/**
 * GET /orders/new?from=&to=&agent_id=&customer_id=
 * ADMIN/CASHIER
 */
exports.getNewOrders = async (req, res) => {
  try {
    const { from, to, agent_id, customer_id } = req.query;

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      100
    );
    const skip = (page - 1) * limit;

    const filter = { status: "NEW" };

    if (agent_id && mongoose.isValidObjectId(agent_id))
      filter.agent_id = agent_id;
    if (customer_id && mongoose.isValidObjectId(customer_id))
      filter.customer_id = customer_id;

    const fromDate = parseDate(from, false);
    const toDate = parseDate(to, true);
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate) filter.createdAt.$lte = toDate;
    }

    const [items, total] = await Promise.all([
      Order.find(filter)
        .populate("agent_id", "name phone login")
        .populate("customer_id", "name phone address")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/**
 * POST /orders/:id/confirm
 * ADMIN/CASHIER
 * NOTE: tasdiqlansa ombordan qty kamayadi va order CONFIRMED bo'ladi.
 *
 * ✅ Socket event: order:updated + order:confirmed
 */
exports.confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cashierId = getUserId(req);
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      await session.abortTransaction();
      return res.status(400).json({ ok: false, message: "order id noto‘g‘ri" });
    }

    const order = await Order.findById(id).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ ok: false, message: "Zakas topilmadi" });
    }

    if (order.status !== "NEW") {
      await session.abortTransaction();
      return res.status(400).json({
        ok: false,
        message: `Zakas NEW emas (hozirgi: ${order.status})`,
      });
    }

    const customer = await Customer.findById(order.customer_id).session(
      session
    );
    if (!customer) {
      await session.abortTransaction();
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    /** ===============================
     * 1. OMBORDAN QTY KAMAYTIRISH
     * =============================== */
    for (const it of order.items) {
      const updated = await Product.findOneAndUpdate(
        { _id: it.product_id, qty: { $gte: it.qty } },
        { $inc: { qty: -it.qty } },
        { new: true, session }
      );

      if (!updated) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: `Omborda yetarli qty yo‘q: ${it.product_id}`,
        });
      }
    }

    /** ===============================
     * 2. SALE ITEMS YASASH
     * =============================== */
    const saleItems = [];
    const currencyTotals = {
      UZS: {
        subtotal: 0,
        discount: 0,
        grandTotal: 0,
        paidAmount: 0,
        debtAmount: 0,
      },
      USD: {
        subtotal: 0,
        discount: 0,
        grandTotal: 0,
        paidAmount: 0,
        debtAmount: 0,
      },
    };

    for (const it of order.items) {
      const product = await Product.findById(it.product_id).session(session);
      if (!product) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ ok: false, message: "Product topilmadi" });
      }

      const cur = normCurrency(it.currency_snapshot);
      if (!cur) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: `currency_snapshot noto‘g‘ri: ${it.currency_snapshot}`,
        });
      }

      const warehouse = await Warehouse.findOne({ currency: cur }).session(
        session
      );
      if (!warehouse) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: `Warehouse topilmadi (${cur})`,
        });
      }

      saleItems.push({
        productId: product._id,
        nameSnapshot: it.name_snapshot,
        warehouseId: warehouse._id,
        currency: cur,
        qty: it.qty,
        price: it.price_snapshot,
        subtotal: it.subtotal,
      });

      currencyTotals[cur].subtotal += it.subtotal;
      currencyTotals[cur].grandTotal += it.subtotal;
      currencyTotals[cur].debtAmount += it.subtotal;
    }

    const totals = {
      subtotal: currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal,
      discount: 0,
      grandTotal: currencyTotals.UZS.grandTotal + currencyTotals.USD.grandTotal,
    };

    /** ===============================
     * 3. SALE CREATE
     * =============================== */
    const sale = await Sale.create(
      [
        {
          invoiceNo: `INV-${Date.now()}`,
          soldBy: cashierId,
          customerId: customer._id,
          customerSnapshot: {
            name: customer.name,
            phone: customer.phone,
            address: customer.address,
            note: customer.note,
          },
          items: saleItems,
          totals,
          currencyTotals,
          status: "COMPLETED",
          note: order.note || "Agent zakas (tasdiqlandi)",
        },
      ],
      { session }
    );

    /** ===============================
     * 4. ORDER UPDATE
     * =============================== */
    order.status = "CONFIRMED";
    order.confirmedAt = new Date();
    order.confirmedBy = cashierId;
    await order.save({ session });

    await session.commitTransaction();

    // ✅ SOCKET: cashierlar uchun update
    const io = req.app?.get("io");
    if (io) {
      io.to("cashiers").emit("order:updated", {
        id: order._id,
        status: "CONFIRMED",
        confirmedAt: order.confirmedAt,
        confirmedBy: cashierId,
      });

      io.to("cashiers").emit("order:confirmed", {
        id: order._id,
        saleId: sale?.[0]?._id,
        invoiceNo: sale?.[0]?.invoiceNo,
      });
    }

    return res.json({
      ok: true,
      message: "Zakas tasdiqlandi, sale yaratildi",
      order,
      sale: sale[0],
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * POST /orders/:id/cancel
 * ADMIN/CASHIER
 * body: { reason }
 *
 * ✅ Socket event: order:updated + order:canceled
 */
exports.cancelOrder = async (req, res) => {
  try {
    const cashierId = getUserId(req);
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "order id noto‘g‘ri" });
    }

    const order = await Order.findById(id);
    if (!order)
      return res.status(404).json({ ok: false, message: "Zakas topilmadi" });

    if (order.status !== "NEW") {
      return res.status(400).json({
        ok: false,
        message: `Faqat NEW zakasni bekor qilish mumkin (hozirgi: ${order.status})`,
      });
    }

    order.status = "CANCELED";
    order.canceledAt = new Date();
    order.canceledBy = cashierId;
    order.cancelReason = String(reason || "Bekor qilindi")
      .trim()
      .slice(0, 300);

    await order.save();

    // ✅ SOCKET
    const io = req.app?.get("io");
    if (io) {
      io.to("cashiers").emit("order:updated", {
        id: order._id,
        status: "CANCELED",
        canceledAt: order.canceledAt,
        canceledBy: cashierId,
        cancelReason: order.cancelReason,
      });

      io.to("cashiers").emit("order:canceled", {
        id: order._id,
        cancelReason: order.cancelReason,
      });
    }

    return res.json({ ok: true, message: "Zakas bekor qilindi", order });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
