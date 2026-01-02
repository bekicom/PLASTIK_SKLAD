const Withdrawal = require("../modules/withdrawals/Withdrawal");

function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

/**
 * POST /api/withdrawals/create
 * Body: { investor_name, amount, currency, purpose, takenAt? }
 */
exports.createWithdrawal = async (req, res) => {
  try {
    const { investor_name, amount, currency, purpose, takenAt } =
      req.body || {};

    if (!investor_name || !String(investor_name).trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "investor_name majburiy" });
    }

    const amt = safeNum(amount, 0);
    if (amt <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "amount 0 dan katta bo‘lsin" });
    }

    if (!["UZS", "USD"].includes(currency)) {
      return res
        .status(400)
        .json({ ok: false, message: "currency noto‘g‘ri (UZS/USD)" });
    }

    if (!purpose || !String(purpose).trim()) {
      return res.status(400).json({ ok: false, message: "purpose majburiy" });
    }

    const doc = await Withdrawal.create({
      investor_name: String(investor_name).trim(),
      amount: amt,
      currency,
      purpose: String(purpose).trim(),
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
      message: "Server xatoligi",
      error: err.message,
    });
  }
};

/**
 * GET /api/withdrawals
 * Query: investor_name?, currency?, from?, to?
 */
exports.getWithdrawals = async (req, res) => {
  try {
    const filter = {};

    if (req.query.investor_name) {
      filter.investor_name = new RegExp(`^${req.query.investor_name}$`, "i");
    }

    if (req.query.currency) {
      filter.currency = req.query.currency;
    }

    const items = await Withdrawal.find(filter).sort({ takenAt: -1 }).lean();

    return res.json({ ok: true, total: items.length, items });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};
