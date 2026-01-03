const mongoose = require("mongoose");
const Order = require("../modules/orders/Order");
const Product = require("../modules/products/Product");
const Sale = require("../modules/sales/Sale");
const Customer = require("../modules/Customer/Customer");
const Warehouse = require("../modules/Warehouse/Warehouse");

/* =======================
   HELPERS
======================= */
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

/* =======================
   GET ORDER FULL (SOCKET)
======================= */
async function getOrderFull(orderId) {
  if (!mongoose.isValidObjectId(orderId)) return null;

  const order = await Order.findById(orderId)
    .populate("agent_id", "name phone login")
    .populate("customer_id", "name phone address note")
    .lean();

  if (!order) return null;

  return {
    _id: order._id,
    status: order.status,
    createdAt: order.createdAt,
    note: order.note || null,

    agent: order.agent_id
      ? {
          _id: order.agent_id._id,
          name: order.agent_id.name,
          phone: order.agent_id.phone,
          login: order.agent_id.login,
        }
      : null,

    customer: order.customer_id
      ? {
          _id: order.customer_id._id,
          name: order.customer_id.name,
          phone: order.customer_id.phone,
          address: order.customer_id.address,
          note: order.customer_id.note,
        }
      : null,

    items: (order.items || []).map((it) => ({
      productId: it.product_id,
      product: {
        name: it.product_snapshot?.name,
        model: it.product_snapshot?.model,
        color: it.product_snapshot?.color,
        category: it.product_snapshot?.category,
        unit: it.product_snapshot?.unit,
        images: it.product_snapshot?.images || [],
      },
      currency: it.currency_snapshot,
      qty: Number(it.qty),
      price: Number(it.price_snapshot),
      subtotal: Number(it.subtotal),
    })),

    totals: {
      UZS: Number(order.total_uzs || 0),
      USD: Number(order.total_usd || 0),
    },
  };
}

/* =======================
   GET NEW ORDERS
======================= */
exports.getNewOrders = async (req, res) => {
  try {
    const { from, to, agent_id, customer_id } = req.query;
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

    const rows = await Order.find(filter)
      .populate("agent_id", "name phone login")
      .populate("customer_id", "name phone address note")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, total: rows.length, items: rows });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/* =======================
   CONFIRM ORDER → SALE
======================= */
exports.confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cashierId = getUserId(req);
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ ok: false, message: "order id noto‘g‘ri" });

    const order = await Order.findById(id).session(session);
    if (!order)
      return res.status(404).json({ ok: false, message: "Zakas topilmadi" });

    if (order.status !== "NEW")
      return res.status(400).json({
        ok: false,
        message: `Zakas NEW emas (hozirgi: ${order.status})`,
      });

    const customer = await Customer.findById(order.customer_id).session(
      session
    );
    if (!customer)
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });

    // 1) STOCK KAMAYTIRISH
    for (const it of order.items) {
      const updated = await Product.findOneAndUpdate(
        { _id: it.product_id, qty: { $gte: it.qty } },
        { $inc: { qty: -it.qty } },
        { new: true, session }
      );
      if (!updated)
        throw new Error(`Omborda yetarli qty yo‘q: ${it.product_id}`);
    }

    // 2) SALE ITEMS
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
      const cur = normCurrency(it.currency_snapshot);
      if (!cur) throw new Error(`currency noto‘g‘ri: ${it.currency_snapshot}`);

      const warehouse = await Warehouse.findOne({ currency: cur }).session(
        session
      );
      if (!warehouse) throw new Error(`Warehouse topilmadi (${cur})`);

      saleItems.push({
        productId: it.product_id,
        productSnapshot: it.product_snapshot,
        warehouseId: warehouse._id,
        currency: cur,
        qty: it.qty,
        sell_price: it.price_snapshot,
        buy_price: it.buy_price || 0,
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

    // 3) SALE CREATE
    const [sale] = await Sale.create(
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

    // 4) ORDER UPDATE
    order.status = "CONFIRMED";
    order.confirmedAt = new Date();
    order.confirmedBy = cashierId;
    await order.save({ session });

    await session.commitTransaction();

    // SOCKET
    const io = req.app?.get("io");
    if (io) {
      const fullOrder = await getOrderFull(order._id);
      io.to("cashiers").emit("order:confirmed", {
        order: fullOrder,
        sale: { _id: String(sale._id), invoiceNo: sale.invoiceNo },
      });
    }

    return res.json({
      ok: true,
      message: "Zakas tasdiqlandi, sale yaratildi",
      order,
      sale,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/* =======================
   CANCEL ORDER
======================= */
exports.cancelOrder = async (req, res) => {
  try {
    const cashierId = getUserId(req);
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ ok: false, message: "order id noto‘g‘ri" });

    const order = await Order.findById(id);
    if (!order)
      return res.status(404).json({ ok: false, message: "Zakas topilmadi" });

    if (order.status !== "NEW")
      return res.status(400).json({
        ok: false,
        message: `Faqat NEW zakasni bekor qilish mumkin`,
      });

    order.status = "CANCELED";
    order.canceledAt = new Date();
    order.canceledBy = cashierId;
    order.cancelReason = String(reason || "Bekor qilindi").slice(0, 300);
    await order.save();

    const io = req.app?.get("io");
    if (io) {
      const fullOrder = await getOrderFull(order._id);
      io.to("cashiers").emit("order:canceled", { order: fullOrder });
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
