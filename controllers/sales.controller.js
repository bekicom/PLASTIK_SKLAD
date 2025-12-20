const mongoose = require("mongoose");

const Sale = require("../modules/sales/Sale");
const Product = require("../modules/products/Product"); // ⚠️ sende papka "Products" bo'lsa shunday qoldir
const Warehouse = require("../modules/Warehouse/Warehouse");

// Counter (invoiceNo uchun)
const Counter =
  mongoose.models.Counter ||
  mongoose.model(
    "Counter",
    new mongoose.Schema(
      {
        key: { type: String, required: true, unique: true },
        seq: { type: Number, default: 0 },
      },
      { timestamps: true }
    )
  );

function safeNumber(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function calcItemsSubtotals(items) {
  return items.map((it) => {
    const qty = safeNumber(it.qty);
    const price = safeNumber(it.price);
    const subtotal = +(qty * price).toFixed(6);
    return { ...it, qty, price, subtotal };
  });
}

function calcCurrencyTotals(items, discount = 0, payments = []) {
  const totals = {
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

  for (const it of items) {
    if (!totals[it.currency]) continue;
    totals[it.currency].subtotal += safeNumber(it.subtotal);
  }

  const totalAll = totals.UZS.subtotal + totals.USD.subtotal;
  const disc = Math.max(0, safeNumber(discount));

  if (totalAll > 0 && disc > 0) {
    const uzsShare = totals.UZS.subtotal / totalAll;
    const usdShare = totals.USD.subtotal / totalAll;
    totals.UZS.discount = +(disc * uzsShare).toFixed(2);
    totals.USD.discount = +(disc * usdShare).toFixed(2);
  }

  totals.UZS.grandTotal = Math.max(
    0,
    +(totals.UZS.subtotal - totals.UZS.discount).toFixed(2)
  );
  totals.USD.grandTotal = Math.max(
    0,
    +(totals.USD.subtotal - totals.USD.discount).toFixed(2)
  );

  for (const p of payments || []) {
    const cur = p.currency;
    if (!totals[cur]) continue;
    totals[cur].paidAmount += Math.max(0, safeNumber(p.amount));
  }

  totals.UZS.paidAmount = +totals.UZS.paidAmount.toFixed(2);
  totals.USD.paidAmount = +totals.USD.paidAmount.toFixed(2);

  totals.UZS.debtAmount = Math.max(
    0,
    +(totals.UZS.grandTotal - totals.UZS.paidAmount).toFixed(2)
  );
  totals.USD.debtAmount = Math.max(
    0,
    +(totals.USD.grandTotal - totals.USD.paidAmount).toFixed(2)
  );

  return totals;
}

async function generateInvoiceNo(session) {
  const year = new Date().getFullYear();
  const key = `SALE_${year}`;
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  const seqStr = String(counter.seq).padStart(6, "0");
  return `S-${year}-${seqStr}`;
}

/**
 * POST /sales/create
 * Body:
 * {
 *   customerSnapshot?: { name, phone },
 *   items: [{ productId, qty, price }],
 *   discount?,
 *   payments: [{ currency: "UZS"|"USD", method: "CASH"|"CARD"|"TRANSFER", amount }],
 *   note?
 * }
 */
exports.createSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const soldBy = req.user?._id || req.user?.id;
    if (!soldBy) return res.status(401).json({ message: "Auth required" });

    const body = req.body || {};

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res
        .status(400)
        .json({ message: "Items bo'sh bo'lishi mumkin emas" });
    }

    // 1) Input validate (productId, qty, price)
    for (const [idx, it] of body.items.entries()) {
      if (!it.productId || !mongoose.isValidObjectId(it.productId)) {
        return res
          .status(400)
          .json({ message: `items[${idx}].productId noto'g'ri` });
      }
      if (safeNumber(it.qty) <= 0) {
        return res
          .status(400)
          .json({ message: `items[${idx}].qty 0 dan katta bo'lishi kerak` });
      }
      if (safeNumber(it.price) < 0) {
        return res
          .status(400)
          .json({ message: `items[${idx}].price manfiy bo'lishi mumkin emas` });
      }
    }

    // 2) Products fetch
    const productIds = [...new Set(body.items.map((x) => String(x.productId)))];

    const products = await Product.find({ _id: { $in: productIds } })
      .select("_id name warehouse_currency qty")
      .session(session);

    const pMap = new Map(products.map((p) => [String(p._id), p]));
    for (const pid of productIds) {
      if (!pMap.has(pid)) {
        return res.status(400).json({ message: `Product topilmadi: ${pid}` });
      }
    }

    // 3) Stock group + check
    const grouped = new Map(); // productId -> totalQty
    for (const it of body.items) {
      const pid = String(it.productId);
      grouped.set(pid, (grouped.get(pid) || 0) + safeNumber(it.qty));
    }

    for (const [pid, needQty] of grouped.entries()) {
      const p = pMap.get(pid);
      const hasQty = safeNumber(p.qty);
      if (hasQty < needQty) {
        return res.status(400).json({
          message: `Stock yetarli emas: ${p.name} (${needQty} kerak, ${hasQty} bor)`,
          meta: { productId: pid, needQty, hasQty },
        });
      }
    }

    // 4) Stock decrement (atomic)
    for (const [pid, needQty] of grouped.entries()) {
      const updated = await Product.updateOne(
        { _id: pid, qty: { $gte: needQty } },
        { $inc: { qty: -needQty } },
        { session }
      );

      if (updated.modifiedCount !== 1) {
        return res.status(400).json({
          message: "Stock o'zgargan, qayta urinib ko'ring",
        });
      }
    }

    // 5) Currency bo'yicha warehouseId'larni DB dan topamiz (hardcode YO'Q)
    const currenciesInSale = [
      ...new Set(products.map((p) => p.warehouse_currency)),
    ];

    const warehouses = await Warehouse.find({
      currency: { $in: currenciesInSale },
    })
      .select("_id currency")
      .session(session);

    const wMap = new Map(warehouses.map((w) => [w.currency, w._id]));

    for (const cur of currenciesInSale) {
      if (!wMap.has(cur)) {
        return res
          .status(400)
          .json({ message: `Warehouse topilmadi: currency=${cur}` });
      }
    }

    // 6) Sale items build (warehouseId AUTOMATIC)
    const items = body.items.map((it) => {
      const p = pMap.get(String(it.productId));
      const currency = p.warehouse_currency;

      return {
        productId: it.productId,
        nameSnapshot: p.name,
        currency,
        warehouseId: wMap.get(currency), // ✅ mana shu joyda wMap ishlaydi va doim defined
        qty: it.qty,
        price: it.price,
      };
    });

    const itemsCalculated = calcItemsSubtotals(items);

    // 7) Payments validate
    const discount = Math.max(0, safeNumber(body.discount));
    const payments = Array.isArray(body.payments) ? body.payments : [];

    for (const [idx, p] of payments.entries()) {
      if (!["UZS", "USD"].includes(p.currency)) {
        return res
          .status(400)
          .json({ message: `payments[${idx}].currency noto'g'ri` });
      }
      if (!["CASH", "CARD", "TRANSFER"].includes(p.method)) {
        return res
          .status(400)
          .json({ message: `payments[${idx}].method noto'g'ri` });
      }
      if (safeNumber(p.amount) < 0) {
        return res
          .status(400)
          .json({ message: `payments[${idx}].amount manfiy bo'lmasin` });
      }
    }

    const currencyTotals = calcCurrencyTotals(
      itemsCalculated,
      discount,
      payments
    );
    const subtotalAll =
      currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal;
    const grandAll =
      currencyTotals.UZS.grandTotal + currencyTotals.USD.grandTotal;

    const invoiceNo = await generateInvoiceNo(session);

    const created = await Sale.create(
      [
        {
          invoiceNo,
          soldBy,
          customerSnapshot: body.customerSnapshot || undefined,
          items: itemsCalculated,
          totals: {
            subtotal: +subtotalAll.toFixed(2),
            discount: +discount.toFixed(2),
            grandTotal: +grandAll.toFixed(2),
          },
          currencyTotals,
          payments,
          note: body.note?.trim(),
          status: "COMPLETED",
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res
      .status(201)
      .json({ message: "Sotuv yaratildi", data: created[0] });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      message: "Sotuv yaratishda xato",
      error: err.message,
    });
  }
};

exports.getSales = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "20", 10))
    );
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [rows, total] = await Promise.all([
      Sale.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items: rows });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Sales olishda xato", error: err.message });
  }
};

exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ message: "ID noto'g'ri" });

    const sale = await Sale.findById(id).lean();
    if (!sale) return res.status(404).json({ message: "Sale topilmadi" });

    return res.json({ ok: true, item: sale });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Sale olishda xato", error: err.message });
  }
};

exports.cancelSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ message: "ID noto'g'ri" });

    const sale = await Sale.findById(id).session(session);
    if (!sale) return res.status(404).json({ message: "Sale topilmadi" });

    if (sale.status === "CANCELED") {
      return res
        .status(400)
        .json({ message: "Sale allaqachon bekor qilingan" });
    }

    // stock qaytarish: sale.items bo'yicha product.qty ga qaytaramiz
    const grouped = new Map(); // productId -> qty
    for (const it of sale.items) {
      const pid = String(it.productId);
      grouped.set(pid, (grouped.get(pid) || 0) + safeNumber(it.qty));
    }

    for (const [pid, qty] of grouped.entries()) {
      await Product.updateOne({ _id: pid }, { $inc: { qty } }, { session });
    }

    sale.status = "CANCELED";
    sale.canceledAt = new Date();
    sale.canceledBy = userId;
    sale.cancelReason = req.body?.reason?.trim();

    await sale.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({ message: "Sale bekor qilindi", data: sale });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res
      .status(500)
      .json({ message: "Sale cancel xato", error: err.message });
  }
};
