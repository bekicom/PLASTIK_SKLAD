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

    if (!investor_name || !String(investor_name).trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "investor_name majburiy" });
    }

    const amt = safeNum(amount);
    if (amt <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "amount 0 dan katta bo‘lishi kerak" });
    }

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({ ok: false, message: "currency noto‘g‘ri" });
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      return res
        .status(400)
        .json({ ok: false, message: "payment_method noto‘g‘ri (CASH | CARD)" });
    }

    if (!purpose || !String(purpose).trim()) {
      return res.status(400).json({ ok: false, message: "purpose majburiy" });
    }

    const doc = await Withdrawal.create({
      investor_name: investor_name.trim(),
      amount: amt,
      currency,
      payment_method,
      purpose: purpose.trim(),
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
      message: "Withdrawal yaratishda xato",
      error: err.message,
    });
  }
};

/* =========================
   EDIT WITHDRAWAL
========================= */
exports.editWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      investor_name,
      amount,
      currency,
      payment_method,
      purpose,
      takenAt,
    } = req.body || {};

    const doc = await Withdrawal.findById(id);
    if (!doc) {
      return res
        .status(404)
        .json({ ok: false, message: "Withdrawal topilmadi" });
    }

    if (investor_name) doc.investor_name = investor_name.trim();
    if (amount !== undefined) doc.amount = safeNum(amount);
    if (currency && ["UZS", "USD"].includes(currency)) doc.currency = currency;
    if (payment_method && ["CASH", "CARD"].includes(payment_method)) {
      doc.payment_method = payment_method;
    }
    if (purpose) doc.purpose = purpose.trim();
    if (takenAt) doc.takenAt = new Date(takenAt);

    await doc.save();

    return res.json({
      ok: true,
      message: "Withdrawal yangilandi",
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
   GET WITHDRAWALS
========================= */
exports.getWithdrawals = async (req, res) => {
  try {
    const { investor_name, currency, payment_method, from, to } = req.query;

    const filter = { type: "INVESTOR_WITHDRAWAL" };

    if (investor_name) {
      filter.investor_name = new RegExp(`^${investor_name}$`, "i");
    }

    if (currency && ["UZS", "USD"].includes(currency)) {
      filter.currency = currency;
    }

    if (payment_method && ["CASH", "CARD"].includes(payment_method)) {
      filter.payment_method = payment_method;
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
      message: "Withdrawal olishda xato",
      error: err.message,
    });
  }
};
