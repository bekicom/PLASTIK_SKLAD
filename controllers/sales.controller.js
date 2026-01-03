const mongoose = require("mongoose");

const Sale = require("../modules/sales/Sale");
const Product = require("../modules/products/Product");
const Warehouse = require("../modules/Warehouse/Warehouse");
const Customer = require("../modules/Customer/Customer");

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

/**
 * Utils
 */
function safeNumber(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  return String(phone).replace(/\s+/g, "").trim();
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function calcItemsSubtotals(items) {
  return items.map((it) => {
    const qty = safeNumber(it.qty);
    const sell_price = safeNumber(it.sell_price);
    const subtotal = +(qty * sell_price).toFixed(6);

    return {
      ...it,
      qty,
      sell_price,
      subtotal,
    };
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

    // 1) validate items
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

    // 2) fetch products
    const productIds = [...new Set(body.items.map((x) => String(x.productId)))];

    const products = await Product.find({ _id: { $in: productIds } })
      .select("_id name warehouse_currency qty bay_price ")
      .session(session);

    const pMap = new Map(products.map((p) => [String(p._id), p]));

    for (const pid of productIds) {
      if (!pMap.has(pid))
        return res.status(400).json({ message: `Product topilmadi: ${pid}` });
    }

    // 3) group qty + check stock
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

    // 4) decrement stock atomically
    for (const [pid, needQty] of grouped.entries()) {
      const updated = await Product.updateOne(
        { _id: pid, qty: { $gte: needQty } },
        { $inc: { qty: -needQty } },
        { session }
      );

      if (updated.modifiedCount !== 1) {
        return res
          .status(400)
          .json({ message: "Stock o'zgargan, qayta urinib ko'ring" });
      }
    }

    // 5) currency -> warehouseId map
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

    // 6) build sale items with automatic warehouseId + currency
  const items = body.items.map((it) => {
    const p = pMap.get(String(it.productId));
    const currency = p.warehouse_currency;

    return {
      productId: it.productId,
      nameSnapshot: p.name,
      currency,
      warehouseId: wMap.get(currency),

      qty: it.qty,

      sell_price: safeNumber(it.price), // 🔥 sotuv narxi
      buy_price: safeNumber(p.buy_price), // 🔥 tannarx (snapshot)
    };
  });


    const itemsCalculated = calcItemsSubtotals(items);

    // ✅ 7) CUSTOMER: create/find + attach (MANA SHU JOYDA!)
    let customerId = undefined;
    let customerSnapshot = body.customerSnapshot || undefined;

    if (body.customerId) {
      if (!mongoose.isValidObjectId(body.customerId)) {
        return res.status(400).json({ message: "customerId noto'g'ri" });
      }

      const c = await Customer.findById(body.customerId).session(session);
      if (!c) return res.status(400).json({ message: "Customer topilmadi" });

      customerId = c._id;
      customerSnapshot = {
        name: c.name,
        phone: c.phone,
        address: c.address,
        note: c.note,
      };
    } else if (customerSnapshot?.phone || customerSnapshot?.name) {
      const phone = normalizePhone(customerSnapshot.phone);
      const name = customerSnapshot.name
        ? String(customerSnapshot.name).trim()
        : undefined;

      let c = null;
      if (phone) c = await Customer.findOne({ phone }).session(session);
      if (!c && name) c = await Customer.findOne({ name }).session(session);

      if (!c) {
        const createdCustomer = await Customer.create(
          [
            {
              name: name || "Customer",
              phone,
              address: customerSnapshot.address?.trim(),
              note: customerSnapshot.note?.trim(),
            },
          ],
          { session }
        );
        c = createdCustomer[0];
      }

      customerId = c._id;
      customerSnapshot = {
        name: c.name,
        phone: c.phone,
        address: c.address,
        note: c.note,
      };
    }

    // 8) payments validate
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

          customerId: customerId || undefined, // ✅ MUHIM
          customerSnapshot: customerSnapshot || undefined, // ✅ MUHIM

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
    const filter = {};

    if (req.query.status) {
      filter.status = String(req.query.status).toUpperCase();
    }

    if (
      req.query.customerId &&
      mongoose.isValidObjectId(req.query.customerId)
    ) {
      filter.customerId = req.query.customerId;
    }

    const rows = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .populate("customerId", "name phone address note")
      .lean();

    const items = rows.map((sale) => ({
      _id: sale._id,
      invoiceNo: sale.invoiceNo,
      status: sale.status,
      createdAt: sale.createdAt,
      canceledAt: sale.canceledAt || null,

      customer: sale.customerId
        ? {
            _id: sale.customerId._id,
            name: sale.customerId.name,
            phone: sale.customerId.phone,
            address: sale.customerId.address,
            note: sale.customerId.note,
          }
        : sale.customerSnapshot || null,

      items: (sale.items || []).map((it) => ({
        productId: it.productId,

        // ✅ TO‘LIQ PRODUCT MA’LUMOT
        product: {
          name: it.productSnapshot?.name,
          model: it.productSnapshot?.model,
          color: it.productSnapshot?.color,
          category: it.productSnapshot?.category,
          unit: it.productSnapshot?.unit,
          images: it.productSnapshot?.images || [],
        },

        currency: it.currency,
        qty: Number(it.qty),
        sell_price: Number(it.sell_price),
        buy_price: Number(it.buy_price),
        subtotal: Number(it.subtotal),
      })),

      totals: sale.totals,
      currencyTotals: sale.currencyTotals,
      payments: sale.payments,
      note: sale.note || null,
    }));

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Sales olishda xato",
      error: err.message,
    });
  }
};


exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ message: "ID noto'g'ri" });

    const sale = await Sale.findById(id)
      .populate("customerId", "name phone address note")
      .lean();
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

    // stock qaytarish
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

exports.searchSalesByProduct = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.status(400).json({
        ok: false,
        message: "q (product nomi) majburiy",
      });
    }

    const rx = new RegExp(escapeRegex(q), "i");

    const filter = {
      "items.nameSnapshot": rx,
    };

    // ixtiyoriy filterlar (hozir yoki keyin ishlatish mumkin)
    if (req.query.status) {
      filter.status = String(req.query.status);
    }

    if (
      req.query.customerId &&
      mongoose.isValidObjectId(req.query.customerId)
    ) {
      filter.customerId = new mongoose.Types.ObjectId(req.query.customerId);
    }

    // ❌ limit yo‘q
    // ❌ pagination yo‘q
    const rows = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .select(
        "invoiceNo createdAt status customerSnapshot customerId totals currencyTotals items"
      )
      .lean();

    const items = rows.map((s) => ({
      _id: s._id,
      invoiceNo: s.invoiceNo,
      createdAt: s.createdAt,
      status: s.status,
      customerSnapshot: s.customerSnapshot,
      customerId: s.customerId,
      totals: s.totals,
      currencyTotals: s.currencyTotals,
      matchedItems: (s.items || []).filter((it) =>
        rx.test(String(it.nameSnapshot || ""))
      ),
    }));

    return res.json({
      ok: true,
      q,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Product bo‘yicha sales qidirishda xato",
      error: err.message,
    });
  }
};

