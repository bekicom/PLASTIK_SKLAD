const Supplier = require("../modules/suppliers/Supplier");
const mongoose = require("mongoose");
const Purchase = require("../modules/purchases/Purchase");

const CUR = ["UZS", "USD"];
function parseDate(d, endOfDay = false) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else dt.setHours(0, 0, 0, 0);
  return dt;
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
    const {
      name,
      phone,
      opening_balance_uzs = 0,
      opening_balance_usd = 0,
    } = req.body;

    if (!name || !phone) {
      return res
        .status(400)
        .json({ ok: false, message: "name va phone majburiy" });
    }

    const exists = await Supplier.findOne({ phone });
    if (exists) {
      return res.status(409).json({ ok: false, message: "Bu telefon band" });
    }

    const balUzs = Number(opening_balance_uzs) || 0;
    const balUsd = Number(opening_balance_usd) || 0;

    const payment_history = [];

    if (balUzs !== 0) {
      payment_history.push({
        currency: "UZS",
        amount: Math.abs(balUzs),
        direction: balUzs > 0 ? "DEBT" : "PREPAYMENT",
        note:
          balUzs > 0 ? "Boshlang‘ich qarz (UZS)" : "Boshlang‘ich avans (UZS)",
      });
    }

    if (balUsd !== 0) {
      payment_history.push({
        currency: "USD",
        amount: Math.abs(balUsd),
        direction: balUsd > 0 ? "DEBT" : "PREPAYMENT",
        note:
          balUsd > 0 ? "Boshlang‘ich qarz (USD)" : "Boshlang‘ich avans (USD)",
      });
    }

    const supplier = await Supplier.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      balance: { UZS: balUzs, USD: balUsd },
      payment_history,
    });

    return res.status(201).json({
      ok: true,
      message: "Zavod yaratildi",
      supplier,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

exports.getSuppliers = async (req, res) => {
  try {
    const { q } = req.query;

    const match = {};
    if (q && q.trim()) {
      const r = new RegExp(q.trim(), "i");
      match.$or = [{ name: r }, { phone: r }];
    }

    const items = await Supplier.aggregate([
      { $match: match },

      // 🔗 PURCHASE JOIN
      {
        $lookup: {
          from: "purchases",
          localField: "_id",
          foreignField: "supplier_id",
          as: "purchases",
        },
      },

      // 🔥 JAMI QARZNI HISOBLASH
      {
        $addFields: {
          debt: {
            UZS: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: "$purchases",
                      as: "p",
                      cond: { $ne: ["$$p.status", "PAID"] },
                    },
                  },
                  as: "p",
                  in: { $ifNull: ["$$p.remaining.UZS", 0] },
                },
              },
            },
            USD: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: "$purchases",
                      as: "p",
                      cond: { $ne: ["$$p.status", "PAID"] },
                    },
                  },
                  as: "p",
                  in: { $ifNull: ["$$p.remaining.USD", 0] },
                },
              },
            },
          },
        },
      },

      // 🧹 ORTIQCHA FIELDLARNI OLIB TASHLAYMIZ
      {
        $project: {
          purchases: 0,
          __v: 0,
        },
      },

      { $sort: { createdAt: -1 } },
    ]);

    return res.json({
      ok: true,
      total: items.length,
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
exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    return res.json({ ok: true, supplier });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};
exports.updateSupplier = async (req, res) => {
  try {
    const { name, phone } = req.body;

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    if (phone && phone !== supplier.phone) {
      const phoneExists = await Supplier.findOne({
        phone,
        _id: { $ne: supplier._id },
      });
      if (phoneExists)
        return res.status(409).json({ ok: false, message: "Bu telefon band" });
      supplier.phone = String(phone).trim();
    }

    if (name !== undefined) supplier.name = String(name).trim();

    await supplier.save();

    return res.json({ ok: true, message: "Zavod yangilandi", supplier });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    return res.json({ ok: true, message: "Zavod o‘chirildi" });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
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
        id: s._id,
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
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ ok: false, message: "supplier id noto‘g‘ri" });
    }

    const supplier = await Supplier.findById(id).lean();
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    const fromDate = parseDate(req.query.from, false);
    const toDate = parseDate(req.query.to, true);

    const filter = { supplier_id: new mongoose.Types.ObjectId(id) };
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate) filter.createdAt.$lte = toDate;
    }

    const purchases = await Purchase.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      supplier: {
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        balance: supplier.balance, // 🔥 ASOSIY HAQIQIY HOLAT
        createdAt: supplier.createdAt,
      },
      purchases,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.paySupplierDebt = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency = "UZS", note } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
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

    const supplier = await Supplier.findById(id);
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
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        balance: supplier.balance,
      },
      change: {
        currency,
        amount: delta,
        previous_balance: prevBalance,
        current_balance: newBalance,
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

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ message: "Zavod topilmadi" });
    }

    // 🔥 ASOSIY QATOR
    supplier.balance[currency] += delta;

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
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server xato",
      error: err.message,
    });
  }
};
