// controllers/order.controller.js

const mongoose = require("mongoose");
const Order = require("../modules/orders/Order");
const Product = require("../modules/products/Product");
const Sale = require("../modules/sales/Sale");
const Customer = require("../modules/Customer/Customer");
const Warehouse = require("../modules/Warehouse/Warehouse");

/* =======================
   HELPERS
======================= */
function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function normCurrency(c) {
  const x = String(c || "").toUpperCase();
  return x === "UZS" || x === "USD" ? x : null;
}

function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

// ✅ MANA SHU YERGA
function parseDate(value, endOfDay = false) {
  if (!value) return null;

  const d = new Date(value);
  if (isNaN(d.getTime())) return null;

  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }

  return d;
}

/* =======================
   CONFIRM ORDER → SALE
======================= */
exports.confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cashierId = getUserId(req);
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new Error("order id noto‘g‘ri");
    }

    /* =========================
       1️⃣ ORDER + CUSTOMER
    ========================= */
    const order = await Order.findById(id).session(session);
    if (!order) throw new Error("Zakas topilmadi");
    if (order.status !== "NEW") {
      throw new Error(`Zakas NEW emas (${order.status})`);
    }

    const customer = await Customer.findById(order.customer_id).session(
      session
    );
    if (!customer) throw new Error("Customer topilmadi");

    /* =========================
       2️⃣ STOCK KAMAYTIRISH
    ========================= */
    for (const it of order.items) {
      const ok = await Product.updateOne(
        { _id: it.product_id, qty: { $gte: it.qty } },
        { $inc: { qty: -it.qty } },
        { session }
      );
      if (ok.modifiedCount === 0) {
        throw new Error("Omborda yetarli mahsulot yo‘q");
      }
    }

    /* =========================
       3️⃣ SALE ITEMS + TOTALS
    ========================= */
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
      if (!cur) throw new Error("Currency noto‘g‘ri");

      const warehouse = await Warehouse.findOne({ currency: cur }).session(
        session
      );
      if (!warehouse) throw new Error(`Warehouse topilmadi (${cur})`);

      const product = await Product.findById(it.product_id)
        .select("buy_price")
        .session(session);
      if (!product) throw new Error("Product topilmadi");

      saleItems.push({
        productId: it.product_id,
        productSnapshot: it.product_snapshot,
        warehouseId: warehouse._id,
        currency: cur,
        qty: it.qty,
        sell_price: it.price_snapshot,
        buy_price: product.buy_price,
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

    /* =========================
       4️⃣ CUSTOMER BALANCE
       (FAQAT QARZ YOZILADI)
    ========================= */
    customer.balance.UZS += currencyTotals.UZS.debtAmount;
    customer.balance.USD += currencyTotals.USD.debtAmount;

    /* =========================
       5️⃣ SALE CREATE
       ❗ status DOIM COMPLETED
    ========================= */
    const saleDate = order.createdAt || new Date();

    const [sale] = await Sale.create(
      [
        {
          invoiceNo: `S-${Date.now()}`,
          soldBy: cashierId,
          customerId: customer._id,
          saleDate,
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
          note: order.note || "Agent zakas",
        },
      ],
      { session }
    );

    await customer.save({ session });

    /* =========================
       6️⃣ ORDER CONFIRM
    ========================= */
    order.status = "CONFIRMED";
    order.confirmedAt = new Date();
    order.confirmedBy = cashierId;
    await order.save({ session });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Zakas tasdiqlandi",
      sale,
      customerBalance: customer.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};



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

/* =======================
   EDIT ORDER (NEW ONLY)
   Zakasni qabul qilishdan oldin qty/price/note ni tahrirlash
======================= */
exports.editOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { items, note } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "order id noto‘g‘ri" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, message: "Zakas topilmadi" });
    }

    if (order.status !== "NEW") {
      return res.status(400).json({
        ok: false,
        message: "Faqat NEW zakas tahrirlanadi",
      });
    }

    let nextItems = order.items || [];

    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          ok: false,
          message: "items bo‘sh bo‘lishi mumkin emas",
        });
      }

      const productIds = items.map((i) => i.product_id || i.productId);
      const validIds = productIds.filter((x) => mongoose.isValidObjectId(x));
      if (validIds.length !== items.length) {
        return res.status(400).json({
          ok: false,
          message: "items ichida product_id noto‘g‘ri",
        });
      }

      const products = await Product.find({
        _id: { $in: validIds },
      })
        .select("_id name model color category unit images qty warehouse_currency sell_price")
        .lean();

      if (products.length !== items.length) {
        return res.status(400).json({
          ok: false,
          message: "Ba'zi productlar topilmadi",
        });
      }

      const pMap = new Map(products.map((p) => [String(p._id), p]));
      const seen = new Set();
      const rebuilt = [];

      for (const it of items) {
        const pid = String(it.product_id || it.productId);
        if (seen.has(pid)) {
          return res.status(400).json({
            ok: false,
            message: "Bir xil mahsulot takrorlanmasin",
          });
        }
        seen.add(pid);

        const p = pMap.get(pid);
        if (!p) {
          return res.status(400).json({
            ok: false,
            message: "Product topilmadi",
          });
        }

        const qty = safeNum(it.qty);
        if (qty <= 0) {
          return res.status(400).json({
            ok: false,
            message: "qty 0 dan katta bo‘lishi kerak",
          });
        }

        // NEW orderda stock reserve qilinmagan, shuning uchun edit payti ham tekshirib qo'yamiz.
        if (safeNum(p.qty) < qty) {
          return res.status(400).json({
            ok: false,
            message: `${p.name} uchun omborda ${p.qty} dona bor, siz ${qty} kiritdingiz`,
          });
        }

        const price = safeNum(it.price ?? it.price_snapshot ?? p.sell_price);
        if (price <= 0) {
          return res.status(400).json({
            ok: false,
            message: "price noto‘g‘ri",
          });
        }

        const subtotal = Number((qty * price).toFixed(2));

        rebuilt.push({
          product_id: p._id,
          product_snapshot: {
            name: p.name,
            model: p.model || "",
            color: p.color || "",
            category: p.category || "",
            unit: p.unit,
            images: p.images || [],
          },
          qty,
          price_snapshot: price,
          subtotal,
          currency_snapshot: p.warehouse_currency,
        });
      }

      nextItems = rebuilt;
    }

    if (note !== undefined) {
      order.note = String(note || "").slice(0, 500);
    }

    order.items = nextItems;
    order.total_uzs = (nextItems || [])
      .filter((x) => x.currency_snapshot === "UZS")
      .reduce((s, x) => s + safeNum(x.subtotal), 0);
    order.total_usd = (nextItems || [])
      .filter((x) => x.currency_snapshot === "USD")
      .reduce((s, x) => s + safeNum(x.subtotal), 0);

    await order.save();

    return res.json({
      ok: true,
      message: "Zakas yangilandi",
      order: {
        _id: order._id,
        status: order.status,
        note: order.note || "",
        totals: {
          UZS: Number(order.total_uzs || 0),
          USD: Number(order.total_usd || 0),
        },
        items: (order.items || []).map((it) => ({
          product_id: it.product_id,
          name: it.product_snapshot?.name || "",
          qty: Number(it.qty || 0),
          price: Number(it.price_snapshot || 0),
          subtotal: Number(it.subtotal || 0),
          currency: it.currency_snapshot,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Order editda xato",
      error: error.message,
    });
  }
};
