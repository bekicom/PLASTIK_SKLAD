const Supplier = require("../modules/suppliers/Supplier");
const mongoose = require("mongoose");
const Purchase = require("../modules/purchases/Purchase");
const CashIn = require("../modules/cashIn/CashIn");
const CUR = ["UZS", "USD"];
const Product = require("../modules/products/Product");

function buildFlexibleIdFilter(id, field = "_id") {
  const raw = String(id || "").trim();
  if (!raw) return null;

  const or = [{ [field]: raw }];
  if (mongoose.isValidObjectId(raw)) {
    or.push({ [field]: new mongoose.Types.ObjectId(raw) });
  }

  return { $or: or };
}

async function findSupplierByIdFlexible(id) {
  const filter = buildFlexibleIdFilter(id);
  if (!filter) return null;

  return Supplier.findOne(filter);
}

function serializeSupplierBase(supplier) {
  if (!supplier) return supplier;

  const plain =
    typeof supplier.toObject === "function" ? supplier.toObject() : { ...supplier };
  const id = String(plain._id || plain.id || "");

  return {
    ...plain,
    _id: plain._id ?? id,
    id,
  };
}

function normalizeSupplierUpdateBody(body) {
  if (!body || typeof body !== "object") return {};

  const nested = body.supplier && typeof body.supplier === "object" ? body.supplier : null;
  const data = body.data && typeof body.data === "object" ? body.data : null;

  return nested || data || body;
}

function maybeInitOpeningBalance(entity, currency, prevBalance, nextBalance) {
  if (!entity.opening_balance) entity.opening_balance = { UZS: 0, USD: 0 };

  const prevOpening = Number(entity.opening_balance?.[currency] || 0);
  const pb = Number(prevBalance || 0);
  const nb = Number(nextBalance || 0);

  // Birinchi marta qarz kiritilganda opening_balancega yozamiz
  if (prevOpening === 0 && pb === 0 && nb > 0) {
    entity.opening_balance[currency] = nb;
    return true;
  }
  return false;
}

function parseDate(val, endOfDay = false) {
  if (!val) return null;

  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;

  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}
function calcPurchaseTotals(p) {
  const items = Array.isArray(p.items) ? p.items : [];
  let totalUzs = 0;
  let totalUsd = 0;

  for (const it of items) {
    const Q = Number(it.qty || 0);
    const BP = Number(it.buy_price || 0);
    const row = Q * BP;

    if (it.currency === "UZS") totalUzs += row;
    if (it.currency === "USD") totalUsd += row;
  }

  const paidUzs = Number(p.paid_amount_uzs || 0);
  const paidUsd = Number(p.paid_amount_usd || 0);

  return {
    uzs: {
      total: totalUzs,
      paid: paidUzs,
      debt: Math.max(0, totalUzs - paidUzs),
    },
    usd: {
      total: totalUsd,
      paid: paidUsd,
      debt: Math.max(0, totalUsd - paidUsd),
    },
  };
}
function calcPurchaseTotals(p) {
  const items = Array.isArray(p.items) ? p.items : [];
  let totalUzs = 0;
  let totalUsd = 0;

  for (const it of items) {
    const Q = Number(it.qty || 0);
    const BP = Number(it.buy_price || 0);
    const row = Q * BP;

    if (it.currency === "UZS") totalUzs += row;
    if (it.currency === "USD") totalUsd += row;
  }

  const paidUzs = Number(p.paid_amount_uzs || 0);
  const paidUsd = Number(p.paid_amount_usd || 0);

  return {
    uzs: {
      total: totalUzs,
      paid: paidUzs,
      debt: Math.max(0, totalUzs - paidUzs),
    },
    usd: {
      total: totalUsd,
      paid: paidUsd,
      debt: Math.max(0, totalUsd - paidUsd),
    },
  };
}

exports.createSupplier = async (req, res) => {
  try {
    const { name, phone, address = "", note = "", balance = {} } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        ok: false,
        message: "name va phone majburiy",
      });
    }

    const exists = await Supplier.findOne({ phone });
    if (exists) {
      return res.status(409).json({
        ok: false,
        message: "Bu telefon band",
      });
    }

    const balUZS = Number(balance.UZS || 0);
    const balUSD = Number(balance.USD || 0);

    const supplier = await Supplier.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      address: String(address).trim(),
      note: String(note).trim(),

      // 🔥 FAFAQAT OPENING BALANCE
      balance: {
        UZS: balUZS,
        USD: balUSD,
      },
      opening_balance: {
        UZS: balUZS,
        USD: balUSD,
      },

      // 🔥 MUHIM: BOSHLANG‘ICHDA BO‘SH
      payment_history: [],
    });

    return res.status(201).json({
      ok: true,
      message: "Zavod yaratildi",
      supplier,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.getSuppliers = async (req, res) => {
  try {
    const { q } = req.query;

    const filter = {};
    if (q && q.trim()) {
      const r = new RegExp(q.trim(), "i");
      filter.$or = [{ name: r }, { phone: r }];
    }

    const suppliers = await Supplier.find(filter)
      .select(
        "name phone balance opening_balance payment_history createdAt updatedAt",
      )
      .sort({ createdAt: -1 })
      .lean();

    const items = suppliers.map((s) => {
      const uzs = Number(s.balance?.UZS || 0);
      const usd = Number(s.balance?.USD || 0);

      return {
        id: String(s._id),
        _id: s._id,
        name: s.name,
        phone: s.phone,

        // 🔥 REAL BALANCE
        balance: {
          UZS: uzs,
          USD: usd,
        },
        opening_balance: {
          UZS: Number(s.opening_balance?.UZS || 0),
          USD: Number(s.opening_balance?.USD || 0),
        },

        // 🔥 FRONTEND STATUS
        status: {
          UZS: uzs > 0 ? "DEBT" : uzs < 0 ? "PREPAID" : "CLEAR",
          USD: usd > 0 ? "DEBT" : usd < 0 ? "PREPAID" : "CLEAR",
        },

        // 🔥 MUHIM — TO‘LOVLAR TARIXI
        payment_history: (s.payment_history || []).map((p) => ({
          currency: p.currency,
          amount: Number(p.amount),
          direction: p.direction, // DEBT | PAYMENT | PREPAYMENT
          method: p.method || null,
          note: p.note || "",
          date: p.date,
        })),

        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Supplier list olishda xato",
      error: error.message,
    });
  }
};

exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await findSupplierByIdFlexible(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    return res.json({ ok: true, supplier: serializeSupplierBase(supplier) });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};
exports.updateSupplier = async (req, res) => {
  try {
    const payload = normalizeSupplierUpdateBody(req.body);
    const name = payload?.name;
    const phone = payload?.phone;
    const address = payload?.address;
    const note = payload?.note;

    const supplier = await findSupplierByIdFlexible(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    if (phone !== undefined && String(phone).trim() && String(phone).trim() !== supplier.phone) {
      const nextPhone = String(phone).trim();
      const phoneExists = await Supplier.findOne({
        phone: nextPhone,
        _id: { $ne: supplier._id },
      });
      if (phoneExists)
        return res.status(409).json({ ok: false, message: "Bu telefon band" });
      supplier.phone = nextPhone;
    }

    if (name !== undefined) supplier.name = String(name).trim();
    if (address !== undefined) supplier.address = String(address).trim();
    if (note !== undefined) supplier.note = String(note).trim();

    await supplier.save();

    return res.json({
      ok: true,
      message: "Zavod yangilandi",
      supplier: serializeSupplierBase(supplier),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

exports.deleteSupplierHard = async (req, res) => {
  try {
    const { id } = req.params;

    const filter = buildFlexibleIdFilter(id);
    if (!filter) {
      return res.status(400).json({
        ok: false,
        message: "supplier id noto‘g‘ri",
      });
    }

    // 1️⃣ ZAVOD BORLIGINI TEKSHIRAMIZ
    const supplier = await Supplier.findOne(filter);
    if (!supplier) {
      return res.status(404).json({
        ok: false,
        message: "Zavod topilmadi",
      });
    }

    // 2️⃣ SHU ZAVODGA TEGISHLI PRODUCTLARNI O‘CHIRAMIZ
    await Product.deleteMany(buildFlexibleIdFilter(id, "supplier_id"));

    // 3️⃣ AGAR TEST BO‘LSA — PURCHASELARNI HAM O‘CHIRAMIZ
    await Purchase.deleteMany(buildFlexibleIdFilter(id, "supplier_id"));

    // 4️⃣ OXIRIDA ZAVODNI O‘CHIRAMIZ
    await Supplier.deleteOne(filter);

    return res.json({
      ok: true,
      message: "Zavod va unga tegishli barcha mahsulotlar to‘liq o‘chirildi",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.getSuppliersDashboard = async (req, res) => {
  try {
    const { q } = req.query;

    const filter = {};
    if (q && q.trim()) {
      const r = new RegExp(q.trim(), "i");
      filter.$or = [{ name: r }, { phone: r }];
    }

    // 1️⃣ Supplierlarni olamiz
    const suppliers = await Supplier.find(filter, {
      name: 1,
      phone: 1,
      balance: 1,
      createdAt: 1,
    }).sort({ createdAt: -1 });

    const total_suppliers = await Supplier.countDocuments(filter);

    // 2️⃣ JAMI QARZ / AVANS HISOBI
    let total_debt_uzs = 0;
    let total_debt_usd = 0;
    let total_prepaid_uzs = 0;
    let total_prepaid_usd = 0;

    for (const s of suppliers) {
      const uzs = Number(s.balance?.UZS || 0);
      const usd = Number(s.balance?.USD || 0);

      if (uzs > 0) total_debt_uzs += uzs;
      if (uzs < 0) total_prepaid_uzs += Math.abs(uzs);

      if (usd > 0) total_debt_usd += usd;
      if (usd < 0) total_prepaid_usd += Math.abs(usd);
    }

    // 3️⃣ Purchase statistikasi (oldingi logika saqlanadi)
    const ids = suppliers.map((s) => s._id);

    const stats = await Purchase.aggregate([
      { $match: { supplier_id: { $in: ids } } },
      {
        $group: {
          _id: "$supplier_id",
          purchases_count: { $sum: 1 },
          last_purchase_at: { $max: "$createdAt" },
        },
      },
    ]);

    const map = {};
    stats.forEach((x) => {
      map[String(x._id)] = {
        purchases_count: x.purchases_count,
        last_purchase_at: x.last_purchase_at,
      };
    });

    // 4️⃣ HAR BIR SUPPLIER UCHUN ITEM
    const items = suppliers.map((s) => {
      const uzs = Number(s.balance?.UZS || 0);
      const usd = Number(s.balance?.USD || 0);

      return {
        id: String(s._id),
        _id: s._id,
        name: s.name,
        phone: s.phone,

        balance: {
          UZS: uzs,
          USD: usd,
        },

        // qulay frontend uchun
        status: {
          UZS: uzs > 0 ? "DEBT" : uzs < 0 ? "PREPAID" : "CLEAR",
          USD: usd > 0 ? "DEBT" : usd < 0 ? "PREPAID" : "CLEAR",
        },

        purchases_count: map[String(s._id)]?.purchases_count || 0,
        last_purchase_at: map[String(s._id)]?.last_purchase_at || null,
        createdAt: s.createdAt,
      };
    });

    return res.json({
      ok: true,
      total_suppliers,

      summary: {
        debt: {
          UZS: total_debt_uzs,
          USD: total_debt_usd,
        },
        prepaid: {
          UZS: total_prepaid_uzs,
          USD: total_prepaid_usd,
        },
      },

      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.getSupplierDetail = async (req, res) => {
  try {
    const { id } = req.params;

    /* =========================
       VALIDATION
    ========================= */
    const supplierFilter = buildFlexibleIdFilter(id);
    if (!supplierFilter) {
      return res.status(400).json({
        ok: false,
        message: "supplier id noto‘g‘ri",
      });
    }

    /* =========================
       SUPPLIER
    ========================= */
    const supplier = await Supplier.findOne(supplierFilter)
      .select("_id name phone balance createdAt")
      .lean();

    if (!supplier) {
      return res.status(404).json({
        ok: false,
        message: "Zavod topilmadi",
      });
    }

    /* =========================
       DATE FILTER (purchase_date)
       DEFAULT = joriy yil
    ========================= */
    const currentYear = new Date().getUTCFullYear();
    const defaultFrom = new Date(`${currentYear}-01-01T00:00:00.000Z`);
    const defaultTo = new Date(`${currentYear}-12-31T23:59:59.999Z`);

    const fromDate = parseDate(req.query.from, false) || defaultFrom;
    const toDate = parseDate(req.query.to, true) || defaultTo;

    const purchaseFilter = {
      ...buildFlexibleIdFilter(id, "supplier_id"),
      purchase_date: {
        $gte: fromDate,
        $lte: toDate,
      },
    };

    /* =========================
       PURCHASES (PARTIYALAR)
    ========================= */
    const purchases = await Purchase.find(purchaseFilter)
      .sort({ purchase_date: -1 }) // 🔥 asosiy sana
      .select("_id batch_no purchase_date totals paid remaining status items")
      .lean();

    /* =========================
       REAL DEBT (HISOBLAB)
    ========================= */
    const debt = purchases.reduce(
      (acc, p) => {
        acc.UZS += Number(p.remaining?.UZS || 0);
        acc.USD += Number(p.remaining?.USD || 0);
        return acc;
      },
      { UZS: 0, USD: 0 },
    );

    /* =========================
       RESPONSE
    ========================= */
    return res.json({
      ok: true,

      supplier: {
        id: String(supplier._id),
        _id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        balance: supplier.balance, // ⚠️ faqat advance / prepayment
        createdAt: supplier.createdAt,
      },

      period: {
        from: fromDate,
        to: toDate,
      },

      debt, // 🔥 faqat 2026 (yoki berilgan oraliq)

      purchases, // 🔹 partiyalar (purchase_date bo‘yicha)
    });
  } catch (error) {
    console.error("getSupplierDetail error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
    });
  }
};

exports.paySupplierDebt = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency = "UZS", note } = req.body || {};

    const supplierFilter = buildFlexibleIdFilter(id);
    if (!supplierFilter) {
      return res.status(400).json({
        ok: false,
        message: "supplier id noto‘g‘ri",
      });
    }

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto‘g‘ri (UZS/USD)",
      });
    }

    const delta = Number(amount);

    // 🔥 FAQAT 0 BO‘LMASIN
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 ga teng bo‘lmasin",
      });
    }

    const supplier = await findSupplierByIdFlexible(id);
    if (!supplier) {
      return res.status(404).json({
        ok: false,
        message: "Zavod topilmadi",
      });
    }

    /* =========================
       1. OLDINGI BALANCE
       + → qarz
       - → avans
    ========================= */
    const prevBalance = Number(supplier.balance?.[currency] || 0);

    /* =========================
       2. YANGI BALANCE (ASOSIY FORMULA 🔥)
       amount > 0  → balance kamayadi
       amount < 0  → balance oshadi
    ========================= */
    const newBalance = prevBalance - delta;
    supplier.balance[currency] = newBalance;
    const openingInitialized = maybeInitOpeningBalance(
      supplier,
      currency,
      prevBalance,
      newBalance,
    );

    /* =========================
       3. PAYMENT HISTORY
    ========================= */
    supplier.payment_history.push({
      currency,
      amount: Math.abs(delta),
      direction: delta > 0 ? "PREPAYMENT" : "DEBT",
      note:
        note ||
        (delta > 0 ? "Zavodga to‘lov / avans" : "Zavoddan qarz yozildi"),
      date: new Date(),
    });

    await supplier.save();

    return res.json({
      ok: true,
      message: "Supplier balance yangilandi",
      supplier: {
        id: String(supplier._id),
        _id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        balance: supplier.balance,
        opening_balance: supplier.opening_balance || { UZS: 0, USD: 0 },
      },
      change: {
        currency,
        amount: delta,
        previous_balance: prevBalance,
        current_balance: newBalance,
        opening_balance_initialized: openingInitialized,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

// controllers/supplier.controller.js

exports.getSupplierPurchases = async (req, res) => {
  try {
    const { id } = req.params;
    const { from, to } = req.query;

    const supplierFilter = buildFlexibleIdFilter(id);
    if (!supplierFilter) {
      return res.status(400).json({
        ok: false,
        message: "supplier id noto‘g‘ri",
      });
    }

    const fromDate = parseDate(from, false);
    const toDate = parseDate(to, true);

    const filter = {
      ...buildFlexibleIdFilter(id, "supplier_id"), // 🔒 NULL LAR O‘TMAYDI
      status: { $ne: "PAID" },
      $or: [{ "remaining.UZS": { $gt: 0 } }, { "remaining.USD": { $gt: 0 } }],
    };

    if (fromDate || toDate) {
      filter.purchase_date = {};
      if (fromDate) filter.purchase_date.$gte = fromDate;
      if (toDate) filter.purchase_date.$lte = toDate;
    }

    const purchases = await Purchase.find(filter)
      .sort({ purchase_date: -1 })
      .select(
        "supplier_id batch_no purchase_date totals paid remaining status items createdAt",
      )
      .lean();

    return res.json({
      ok: true,
      count: purchases.length,
      data: purchases,
    });
  } catch (error) {
    console.error("getSupplierPurchases error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.updateSupplierBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { currency, amount, note } = req.body;

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({ message: "currency noto‘g‘ri" });
    }

    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ message: "amount noto‘g‘ri" });
    }

    const supplierFilter = buildFlexibleIdFilter(id);
    if (!supplierFilter) {
      return res.status(400).json({ message: "supplier id noto‘g‘ri" });
    }

    const supplier = await Supplier.findOne(supplierFilter);
    if (!supplier) {
      return res.status(404).json({ message: "Zavod topilmadi" });
    }

    // 🔥 ASOSIY QATOR
    const prevBalance = Number(supplier.balance?.[currency] || 0);
    supplier.balance[currency] += delta;
    const nextBalance = Number(supplier.balance?.[currency] || 0);
    const openingInitialized = maybeInitOpeningBalance(
      supplier,
      currency,
      prevBalance,
      nextBalance,
    );

    supplier.payment_history.push({
      currency,
      amount: Math.abs(delta),
      direction: delta > 0 ? "DEBT" : "PREPAYMENT",
      note: note || "Balance o‘zgartirildi",
      date: new Date(),
    });

    await supplier.save();

    return res.json({
      ok: true,
      message: "Balance yangilandi",
      balance: supplier.balance,
      opening_balance: supplier.opening_balance || { UZS: 0, USD: 0 },
      opening_balance_initialized: openingInitialized,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server xato",
      error: err.message,
    });
  }
};

exports.updateSupplierOpeningBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { opening_balance = {}, note, set_as_baseline = false } = req.body || {};

    const supplierFilter = buildFlexibleIdFilter(id);
    if (!supplierFilter) {
      return res.status(400).json({
        ok: false,
        message: "supplier id noto‘g‘ri",
      });
    }

    const hasUZS = Object.prototype.hasOwnProperty.call(opening_balance, "UZS");
    const hasUSD = Object.prototype.hasOwnProperty.call(opening_balance, "USD");

    if (!hasUZS && !hasUSD) {
      return res.status(400).json({
        ok: false,
        message: "opening_balance.UZS yoki opening_balance.USD yuboring",
      });
    }

    const supplier = await Supplier.findOne(supplierFilter);
    if (!supplier) {
      return res.status(404).json({
        ok: false,
        message: "Zavod topilmadi",
      });
    }

    if (!supplier.opening_balance) supplier.opening_balance = { UZS: 0, USD: 0 };

    const currencies = ["UZS", "USD"];
    const changes = [];

    for (const cur of currencies) {
      if (!Object.prototype.hasOwnProperty.call(opening_balance, cur)) continue;

      const nextOpening = Number(opening_balance[cur]);
      if (!Number.isFinite(nextOpening)) {
        return res.status(400).json({
          ok: false,
          message: `${cur} opening balance noto‘g‘ri`,
        });
      }

      const prevOpening = Number(supplier.opening_balance?.[cur] || 0);
      const currentBalance = Number(supplier.balance?.[cur] || 0);
      const operationalBalance = currentBalance - prevOpening; // opening'dan tashqari qism

      let nextBalance = currentBalance;
      let delta = 0;
      if (!set_as_baseline) {
        nextBalance = operationalBalance + nextOpening;
        delta = nextBalance - currentBalance;
      }

      supplier.opening_balance[cur] = nextOpening;
      supplier.balance[cur] = nextBalance;

      // Opening balance tahriri payment_historyga yozilmaydi.

      changes.push({
        currency: cur,
        previous_opening_balance: prevOpening,
        current_opening_balance: nextOpening,
        set_as_baseline: !!set_as_baseline,
        operational_balance: operationalBalance,
        delta,
        current_balance: nextBalance,
      });
    }

    await supplier.save();

    return res.json({
      ok: true,
      message: "Zavod boshlang‘ich balansi yangilandi",
      supplier: {
        id: String(supplier._id),
        _id: supplier._id,
        name: supplier.name,
        opening_balance: supplier.opening_balance,
        balance: supplier.balance,
      },
      changes,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Zavod boshlang‘ich balansini tahrirlashda xato",
      error: error.message,
    });
  }
};

exports.getSupplierTimeline = async (req, res) => {
  try {
    const { id } = req.params;

    const supplierFilter = buildFlexibleIdFilter(id);
    if (!supplierFilter) {
      return res.status(400).json({
        ok: false,
        message: "supplier id noto‘g‘ri",
      });
    }

    /* =========================
       1️⃣ PURCHASES (YUKLAR)
    ========================= */
    const purchases = await Purchase.find(buildFlexibleIdFilter(id, "supplier_id"))
      .select("batch_no totals remaining status createdAt")
      .lean();

    const purchaseItems = purchases.map((p) => ({
      type: "PURCHASE",
      date: p.createdAt,
      title: `Yuk olindi (${p.batch_no})`,
      amount: {
        UZS: p.totals?.UZS || 0,
        USD: p.totals?.USD || 0,
      },
      remaining: p.remaining,
      status: p.status,
      ref_id: p._id,
    }));

    /* =========================
       2️⃣ CASH-IN (TO‘LOVLAR)
    ========================= */
    const cashIns = await CashIn.find({
      target_type: "SUPPLIER",
      ...buildFlexibleIdFilter(id, "supplier_id"),
    })
      .select("amount currency payment_method note createdAt")
      .lean();

    const cashInItems = cashIns.map((c) => ({
      type: "CASH_IN",
      date: c.createdAt,
      title: "Zavodga to‘lov",
      amount: {
        UZS: c.currency === "UZS" ? c.amount : 0,
        USD: c.currency === "USD" ? c.amount : 0,
      },
      payment_method: c.payment_method,
      note: c.note || "",
      ref_id: c._id,
    }));

    /* =========================
       3️⃣ ARALASHTIRIB SORT QILAMIZ
    ========================= */
    const timeline = [...purchaseItems, ...cashInItems].sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );

    return res.json({
      ok: true,
      supplier_id: id,
      total: timeline.length,
      timeline,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Supplier timeline olishda xato",
      error: error.message,
    });
  }
};
