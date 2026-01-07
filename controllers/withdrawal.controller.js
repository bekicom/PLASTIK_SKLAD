const Withdrawal = require("../modules/withdrawals/Withdrawal");

/* =====================
   HELPERS
===================== */
function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

/* =========================
   CREATE WITHDRAWAL
   Investor pul yechishi
========================= */
exports.createWithdrawal = async (req, res) => {
  try {
    const { investor_name, amount, currency, purpose, takenAt } =
      req.body || {};

    /* =====================
       VALIDATION
    ===================== */
    if (!investor_name || !String(investor_name).trim()) {
      return res.status(400).json({
        ok: false,
        message: "investor_name majburiy",
      });
    }

    const amt = safeNum(amount);
    if (amt <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 dan katta bo‘lishi kerak",
      });
    }

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto‘g‘ri (UZS yoki USD)",
      });
    }

    if (!purpose || !String(purpose).trim()) {
      return res.status(400).json({
        ok: false,
        message: "purpose majburiy",
      });
    }

    /* =====================
       CREATE DOCUMENT
    ===================== */
    const doc = await Withdrawal.create({
      investor_name: String(investor_name).trim(),
      amount: amt,
      currency,
      purpose: String(purpose).trim(),

      // 🔥 MUHIM: Expense bilan aralashmasin
      type: "INVESTOR_WITHDRAWAL",

      takenAt: takenAt ? new Date(takenAt) : new Date(),
    });

    return res.status(201).json({
      ok: true,
      message: "Investor pul oldi",
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Withdrawal yaratishda server xatosi",
      error: err.message,
    });
  }
};

/* =========================
   GET WITHDRAWALS
   Filter + date range
========================= */
exports.getWithdrawals = async (req, res) => {
  try {
    const { investor_name, currency, from, to } = req.query;
    const filter = {
      type: "INVESTOR_WITHDRAWAL", // 🔥 faqat investor pullari
    };

    if (investor_name) {
      filter.investor_name = new RegExp(
        `^${String(investor_name).trim()}$`,
        "i"
      );
    }

    if (currency && ["UZS", "USD"].includes(currency)) {
      filter.currency = currency;
    }

    if (from || to) {
      filter.takenAt = {};
      if (from) filter.takenAt.$gte = new Date(from);
      if (to) filter.takenAt.$lte = new Date(to);
    }

    const items = await Withdrawal.find(filter).sort({ takenAt: -1 }).lean();

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Withdrawal olishda server xatosi",
      error: err.message,
    });
  }
};
