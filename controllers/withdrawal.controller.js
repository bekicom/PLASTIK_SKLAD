const mongoose = require("mongoose");
const Withdrawal = require("../modules/withdrawals/Withdrawal");

/* =========================
   UTILS
========================= */
function safeNum(n, def = null) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function parseDate(d, endOfDay = false) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;

  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else dt.setHours(0, 0, 0, 0);

  return dt;
}

/* =========================
   CREATE WITHDRAWAL
   POST /api/withdrawals
========================= */
exports.createWithdrawal = async (req, res) => {
  try {
    const {
      investor_name,
      amount,
      currency,
      payment_method,
      purpose,
      takenAt,
    } = req.body || {};

    if (!investor_name || !investor_name.trim()) {
      return res.status(400).json({
        ok: false,
        message: "investor_name majburiy",
      });
    }

    const amt = safeNum(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 dan katta bo‘lishi kerak",
      });
    }

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto‘g‘ri (UZS / USD)",
      });
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      return res.status(400).json({
        ok: false,
        message: "payment_method noto‘g‘ri (CASH / CARD)",
      });
    }

    if (!purpose || !purpose.trim()) {
      return res.status(400).json({
        ok: false,
        message: "purpose majburiy",
      });
    }

    const parsedDate = takenAt ? new Date(takenAt) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        ok: false,
        message: "takenAt noto‘g‘ri formatda",
      });
    }

    const doc = await Withdrawal.create({
      investor_name: investor_name.trim(),
      amount: amt,
      currency,
      payment_method,
      purpose: purpose.trim(),
      type: "INVESTOR_WITHDRAWAL",
      takenAt: parsedDate,
    });

    return res.status(201).json({
      ok: true,
      message: "Investor puli yechildi",
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Withdrawal yaratishda xato",
      error: err.message,
    });
  }
};

/* =========================
   GET WITHDRAWALS
   GET /api/withdrawals
========================= */
exports.getWithdrawals = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const { investor_name, currency, payment_method, from, to } = req.query;

    const filter = { type: "INVESTOR_WITHDRAWAL" };

    // 👤 Investor name (case-insensitive)
    if (investor_name) {
      filter.investor_name = new RegExp(investor_name.trim(), "i");
    }

    // 💱 Currency
    if (currency && ["UZS", "USD"].includes(currency)) {
      filter.currency = currency;
    }

    // 💳 Payment method
    if (payment_method && ["CASH", "CARD"].includes(payment_method)) {
      filter.payment_method = payment_method;
    }

    // 📆 Date filter (takenAt)
    const fromDate = parseDate(from);
    const toDate = parseDate(to, true);

    if (fromDate || toDate) {
      filter.takenAt = {};
      if (fromDate) filter.takenAt.$gte = fromDate;
      if (toDate) filter.takenAt.$lte = toDate;
    }

    const [items, total, totals] = await Promise.all([
      Withdrawal.find(filter)
        .sort({ takenAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Withdrawal.countDocuments(filter),

      Withdrawal.aggregate([
        { $match: filter },
        {
          $group: {
            _id: "$currency",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const summary = {
      UZS: { total: 0, count: 0 },
      USD: { total: 0, count: 0 },
    };

    for (const t of totals) {
      if (summary[t._id]) {
        summary[t._id] = {
          total: t.total,
          count: t.count,
        };
      }
    }

    return res.json({
      ok: true,
      page,
      limit,
      total,
      summary,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Withdrawal olishda xato",
      error: err.message,
    });
  }
};

/* =========================
   GET WITHDRAWAL BY ID
   GET /api/withdrawals/:id
========================= */
exports.getWithdrawalById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto‘g‘ri",
      });
    }

    const item = await Withdrawal.findById(id).lean();
    if (!item) {
      return res.status(404).json({
        ok: false,
        message: "Withdrawal topilmadi",
      });
    }

    return res.json({
      ok: true,
      item,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Withdrawal bitta yozuvini olishda xato",
      error: err.message,
    });
  }
};

/* =========================
   UPDATE WITHDRAWAL
   PUT /api/withdrawals/:id
========================= */
exports.updateWithdrawal = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto‘g‘ri",
      });
    }

    const doc = await Withdrawal.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Withdrawal topilmadi",
      });
    }

    const before = {
      investor_name: doc.investor_name,
      amount: doc.amount,
      currency: doc.currency,
      payment_method: doc.payment_method,
      purpose: doc.purpose,
      takenAt: doc.takenAt,
    };

    const {
      investor_name,
      amount,
      currency,
      payment_method,
      purpose,
      takenAt,
    } = req.body || {};

    if (investor_name !== undefined) {
      if (typeof investor_name !== "string" || !investor_name.trim()) {
        return res.status(400).json({
          ok: false,
          message: "investor_name noto‘g‘ri",
        });
      }
      doc.investor_name = investor_name.trim();
    }

    if (amount !== undefined) {
      const amt = safeNum(amount);
      if (!amt || amt <= 0) {
        return res.status(400).json({
          ok: false,
          message: "amount noto‘g‘ri",
        });
      }
      doc.amount = amt;
    }

    if (currency !== undefined) {
      if (!["UZS", "USD"].includes(currency)) {
        return res.status(400).json({
          ok: false,
          message: "currency noto‘g‘ri (UZS / USD)",
        });
      }
      doc.currency = currency;
    }

    if (payment_method !== undefined) {
      if (!["CASH", "CARD"].includes(payment_method)) {
        return res.status(400).json({
          ok: false,
          message: "payment_method noto‘g‘ri (CASH / CARD)",
        });
      }
      doc.payment_method = payment_method;
    }

    if (purpose !== undefined) {
      if (typeof purpose !== "string" || !purpose.trim()) {
        return res.status(400).json({
          ok: false,
          message: "purpose noto‘g‘ri",
        });
      }
      doc.purpose = purpose.trim();
    }

    if (takenAt !== undefined) {
      const d = new Date(takenAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({
          ok: false,
          message: "takenAt noto‘g‘ri",
        });
      }
      doc.takenAt = d;
    }

    await doc.save();

    const after = {
      investor_name: doc.investor_name,
      amount: doc.amount,
      currency: doc.currency,
      payment_method: doc.payment_method,
      purpose: doc.purpose,
      takenAt: doc.takenAt,
    };

    const changedFields = Object.keys(after).filter((k) => {
      if (k === "takenAt") {
        return new Date(before.takenAt).getTime() !== new Date(after.takenAt).getTime();
      }
      return String(before[k]) !== String(after[k]);
    });

    return res.json({
      ok: true,
      message: "Withdrawal yangilandi",
      changedFields,
      before,
      after,
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Withdrawal editda xato",
      error: err.message,
    });
  }
};

/* =========================
   DELETE WITHDRAWAL
========================= */
exports.deleteWithdrawal = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto‘g‘ri",
      });
    }

    const doc = await Withdrawal.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Withdrawal topilmadi",
      });
    }

    return res.json({
      ok: true,
      message: "Withdrawal o‘chirildi",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Withdrawal delete xato",
      error: err.message,
    });
  }
};
