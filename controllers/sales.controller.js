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
function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function escapeRegex(text = "") {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    if (!soldBy) throw new Error("Auth required");

    const {
      items,
      customerId,
      customer,
      payments = [],
      discount = 0,
      note,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items bo'sh bo'lishi mumkin emas");
    }

    /* =========================
       0. CUSTOMER ANIQLASH / YARATISH
    ========================= */
    let finalCustomerId = null;

    if (mongoose.isValidObjectId(customerId)) {
      finalCustomerId = customerId;
    }

    if (!finalCustomerId && customer?.name) {
      const [newCustomer] = await Customer.create(
        [
          {
            name: customer.name,
            phone: normalizePhone(customer.phone),
            address: customer.address || "",
            note: customer.note || "",
            balance: { UZS: 0, USD: 0 },
            payment_history: [],
          },
        ],
        { session }
      );

      finalCustomerId = newCustomer._id;
    }

    /* =========================
       1. PRODUCTLARNI OLAMIZ
    ========================= */
    const productIds = items.map((i) => i.productId);

    const products = await Product.find({
      _id: { $in: productIds },
    })
      .select(
        "_id name model color category unit images qty buy_price warehouse_currency"
      )
      .session(session);

    const pMap = new Map(products.map((p) => [String(p._id), p]));

    /* =========================
       2. STOCK TEKSHIRISH
    ========================= */
    for (const it of items) {
      const p = pMap.get(String(it.productId));
      if (!p) throw new Error("Product topilmadi");

      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("qty noto'g'ri");
      }

      if (p.qty < qty) {
        throw new Error(`Stock yetarli emas: ${p.name}`);
      }
    }

    /* =========================
       3. STOCK KAMAYTIRISH
    ========================= */
    for (const it of items) {
      await Product.updateOne(
        { _id: it.productId, qty: { $gte: it.qty } },
        { $inc: { qty: -it.qty } },
        { session }
      );
    }

    /* =========================
       4. WAREHOUSE MAP
    ========================= */
    const currencies = [...new Set(products.map((p) => p.warehouse_currency))];

    const warehouses = await Warehouse.find({
      currency: { $in: currencies },
    })
      .select("_id currency")
      .session(session);

    const wMap = new Map(warehouses.map((w) => [w.currency, w._id]));

    /* =========================
       5. SALE ITEMS
    ========================= */
    const saleItems = items.map((it) => {
      const p = pMap.get(String(it.productId));
      const currency = p.warehouse_currency;
      const warehouseId = wMap.get(currency);

      if (!warehouseId) {
        throw new Error(`Warehouse topilmadi: ${currency}`);
      }

      const qty = Number(it.qty);
      const sellPrice = Number(it.sell_price);

      if (!Number.isFinite(sellPrice) || sellPrice < 0) {
        throw new Error("sell_price noto'g'ri");
      }

      return {
        productId: p._id,
        productSnapshot: {
          name: p.name,
          model: p.model || null,
          color: p.color || null,
          category: p.category || null,
          unit: p.unit,
          images: p.images || [],
        },
        warehouseId,
        currency,
        qty,
        sell_price: sellPrice,
        buy_price: Number(p.buy_price),
        subtotal: +(qty * sellPrice).toFixed(2),
      };
    });

    /* =========================
       6. CURRENCY TOTALS (✅ FIXED)
    ========================= */
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

    // 1️⃣ SUBTOTAL
    for (const it of saleItems) {
      currencyTotals[it.currency].subtotal += it.subtotal;
    }

    // 2️⃣ DISCOUNT (proportional)
    const totalAll = currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal;
    const disc = Math.max(0, safeNumber(discount));

    if (totalAll > 0 && disc > 0) {
      const uzsShare = currencyTotals.UZS.subtotal / totalAll;
      const usdShare = currencyTotals.USD.subtotal / totalAll;
      currencyTotals.UZS.discount = +(disc * uzsShare).toFixed(2);
      currencyTotals.USD.discount = +(disc * usdShare).toFixed(2);
    }

    // 3️⃣ GRAND TOTAL
    currencyTotals.UZS.grandTotal = Math.max(
      0,
      +(currencyTotals.UZS.subtotal - currencyTotals.UZS.discount).toFixed(2)
    );
    currencyTotals.USD.grandTotal = Math.max(
      0,
      +(currencyTotals.USD.subtotal - currencyTotals.USD.discount).toFixed(2)
    );

    // 4️⃣ PAID AMOUNT
    for (const p of payments) {
      if (!["UZS", "USD"].includes(p.currency)) {
        throw new Error("Payment currency noto'g'ri");
      }
      currencyTotals[p.currency].paidAmount += Math.max(
        0,
        safeNumber(p.amount)
      );
    }

    currencyTotals.UZS.paidAmount = +currencyTotals.UZS.paidAmount.toFixed(2);
    currencyTotals.USD.paidAmount = +currencyTotals.USD.paidAmount.toFixed(2);

    // 5️⃣ DEBT AMOUNT
    currencyTotals.UZS.debtAmount = Math.max(
      0,
      +(currencyTotals.UZS.grandTotal - currencyTotals.UZS.paidAmount).toFixed(
        2
      )
    );
    currencyTotals.USD.debtAmount = Math.max(
      0,
      +(currencyTotals.USD.grandTotal - currencyTotals.USD.paidAmount).toFixed(
        2
      )
    );

    const invoiceNo = `S-${Date.now()}`;

    /* =========================
       7. SALE CREATE
    ========================= */
    const [sale] = await Sale.create(
      [
        {
          invoiceNo,
          soldBy,
          customerId: finalCustomerId || undefined,
          items: saleItems,
          totals: {
            subtotal: currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal,
            discount: disc,
            grandTotal:
              currencyTotals.UZS.grandTotal + currencyTotals.USD.grandTotal,
          },
          currencyTotals,
          payments,
          note,
          status: "COMPLETED",
        },
      ],
      { session }
    );

    /* =========================
       8. CUSTOMER BALANCE
    ========================= */
    if (finalCustomerId) {
      const customerDoc = await Customer.findById(finalCustomerId).session(
        session
      );
      if (!customerDoc) throw new Error("Customer topilmadi");

      if (currencyTotals.UZS.debtAmount > 0) {
        customerDoc.balance.UZS += currencyTotals.UZS.debtAmount;
        customerDoc.payment_history.push({
          currency: "UZS",
          amount: currencyTotals.UZS.debtAmount,
          direction: "DEBT",
          note: `Sale ${invoiceNo}`,
        });
      }

      if (currencyTotals.USD.debtAmount > 0) {
        customerDoc.balance.USD += currencyTotals.USD.debtAmount;
        customerDoc.payment_history.push({
          currency: "USD",
          amount: currencyTotals.USD.debtAmount,
          direction: "DEBT",
          note: `Sale ${invoiceNo}`,
        });
      }

      await customerDoc.save({ session });
    }

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      message: "Sale yaratildi",
      sale,
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

exports.getSales = async (req, res) => {
  try {
    /* =====================
       FILTER
    ===================== */
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

    if (
      req.query.warehouseId &&
      mongoose.isValidObjectId(req.query.warehouseId)
    ) {
      filter["items.warehouseId"] = req.query.warehouseId;
    }

    /* =====================
       QUERY
    ===================== */
    const rows = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .populate("customerId", "name phone address note")
      .populate("soldBy", "name phone login")
      .populate({
        path: "items.warehouseId",
        select: "name currency",
      })
      .lean();

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows.map((sale) => ({
      _id: sale._id,
      invoiceNo: sale.invoiceNo,
      status: sale.status,
      createdAt: sale.createdAt,
      canceledAt: sale.canceledAt || null,

      agent: sale.soldBy
        ? {
            _id: sale.soldBy._id,
            name: sale.soldBy.name,
            phone: sale.soldBy.phone,
            login: sale.soldBy.login,
          }
        : null,

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
        product_id: it.productId,

        warehouse: it.warehouseId
          ? {
              _id: it.warehouseId._id,
              name: it.warehouseId.name,
              currency: it.warehouseId.currency,
            }
          : null,

        product_snapshot: {
          name: it.productSnapshot?.name,
          model: it.productSnapshot?.model,
          color: it.productSnapshot?.color,
          category: it.productSnapshot?.category,
          unit: it.productSnapshot?.unit,
          images: it.productSnapshot?.images || [],
        },

        qty: Number(it.qty),
        sell_price_snapshot: Number(it.sell_price),
        buy_price_snapshot: Number(it.buy_price),
        subtotal: Number(it.subtotal),
        currency_snapshot: it.currency,
      })),

      totals: sale.totals || null,
      currencyTotals: sale.currencyTotals || null,
      payments: sale.payments || [],
      note: sale.note || "",
    }));

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("getSales error:", err);
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
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new Error("Sale topilmadi");

    if (sale.status === "CANCELED") throw new Error("Sale allaqachon bekor");

    // STOCK QAYTARISH
    for (const it of sale.items) {
      await Product.updateOne(
        { _id: it.productId },
        { $inc: { qty: it.qty } },
        { session }
      );
    }

    // CUSTOMER QARZNI KAMAYTIRISH
    if (sale.customerId) {
      const customer = await Customer.findById(sale.customerId).session(
        session
      );
      if (customer) {
        customer.balance.UZS = Math.max(
          0,
          customer.balance.UZS - sale.currencyTotals.UZS.debtAmount
        );
        customer.balance.USD = Math.max(
          0,
          customer.balance.USD - sale.currencyTotals.USD.debtAmount
        );

        await customer.save({ session });
      }
    }

    sale.status = "CANCELED";
    sale.canceledAt = new Date();
    sale.cancelReason = req.body?.reason;

    await sale.save({ session });

    await session.commitTransaction();
    return res.json({ ok: true, message: "Sale bekor qilindi" });
  } catch (e) {
    await session.abortTransaction();
    return res.status(400).json({ ok: false, message: e.message });
  } finally {
    session.endSession();
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

    /* =====================
       FILTER
    ===================== */
    const filter = {
      status: "COMPLETED",
      "items.productSnapshot.name": rx,
      "items.qty": { $gt: 0 }, // 🔥 faqat qaytariladiganlar
    };

    if (
      req.query.customerId &&
      mongoose.isValidObjectId(req.query.customerId)
    ) {
      filter.customerId = new mongoose.Types.ObjectId(req.query.customerId);
    }

    if (
      req.query.warehouseId &&
      mongoose.isValidObjectId(req.query.warehouseId)
    ) {
      filter["items.warehouseId"] = new mongoose.Types.ObjectId(
        req.query.warehouseId
      );
    }

    /* =====================
       QUERY
    ===================== */
    const rows = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .select(
        "invoiceNo createdAt status customerSnapshot customerId items totals currencyTotals"
      )
      .lean();

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows
      .map((s) => {
        const matchedItems = (s.items || []).filter(
          (it) =>
            rx.test(String(it.productSnapshot?.name || "")) &&
            safeNum(it.qty) > 0 &&
            (!req.query.warehouseId ||
              String(it.warehouseId) === String(req.query.warehouseId))
        );

        if (matchedItems.length === 0) return null;

        return {
          _id: s._id,
          invoiceNo: s.invoiceNo,
          createdAt: s.createdAt,
          status: s.status,
          customer: s.customerId || s.customerSnapshot,
          totals: s.totals,
          currencyTotals: s.currencyTotals,
          matchedItems,
        };
      })
      .filter(Boolean);

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