const mongoose = require("mongoose");
const Expense = require("../modules/expenses/Expense");

/* ================= utils ================= */
function safeNum(n, def = 0) {
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

/* ================= CREATE ================= */
/**
 * POST /api/expenses/create
 */
exports.createExpense = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const {
      category,
      amount,
      currency = "UZS",
      note,
      expense_date,
    } = req.body || {};

    if (!category || !String(category).trim()) {
      return res.status(400).json({ ok: false, message: "category majburiy" });
    }

    const amt = safeNum(amount);
    if (amt <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "amount 0 dan katta bo‘lsin" });
    }

    if (!Expense.CUR.includes(currency)) {
      return res
        .status(400)
        .json({ ok: false, message: "currency noto‘g‘ri (UZS/USD)" });
    }

    const doc = await Expense.create({
      category: category.trim(),
      amount: amt,
      currency,
      note: note?.trim(),
      expense_date: expense_date ? new Date(expense_date) : new Date(),
      createdBy: userId,
    });

    return res.status(201).json({
      ok: true,
      message: "Xarajat qo‘shildi",
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

/* ================= LIST ================= */
/**
 * GET /api/expenses
 */
exports.getExpenses = async (req, res) => {
  try {
    const page = Math.max(+req.query.page || 1, 1);
    const limit = Math.min(Math.max(+req.query.limit || 20, 1), 200);
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.q) {
      const r = new RegExp(req.query.q.trim(), "i");
      filter.$or = [{ category: r }, { note: r }];
    }

    if (req.query.category) filter.category = req.query.category.trim();
    if (req.query.currency) filter.currency = req.query.currency;

    if (req.query.createdBy) {
      if (!mongoose.isValidObjectId(req.query.createdBy)) {
        return res
          .status(400)
          .json({ ok: false, message: "createdBy noto‘g‘ri" });
      }
      filter.createdBy = req.query.createdBy;
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    if (from || to) {
      filter.expense_date = {};
      if (from) filter.expense_date.$gte = from;
      if (to) filter.expense_date.$lte = to;
    }

    const [items, total] = await Promise.all([
      Expense.find(filter)
        .sort({ expense_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name role")
        .lean(),
      Expense.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};

/* ================= GET BY ID ================= */
exports.getExpenseById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, message: "id noto‘g‘ri" });
    }

    const doc = await Expense.findById(req.params.id)
      .populate("createdBy", "name role")
      .lean();

    if (!doc) {
      return res.status(404).json({ ok: false, message: "Xarajat topilmadi" });
    }

    return res.json({ ok: true, data: doc });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};

/* ================= UPDATE ================= */
exports.updateExpense = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, message: "id noto‘g‘ri" });
    }

    const doc = await Expense.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, message: "Xarajat topilmadi" });
    }

    const { category, amount, currency, note, expense_date } = req.body || {};

    if (category !== undefined) doc.category = category.trim();
    if (currency !== undefined && Expense.CUR.includes(currency))
      doc.currency = currency;
    if (amount !== undefined && safeNum(amount) > 0)
      doc.amount = safeNum(amount);
    if (note !== undefined) doc.note = note?.trim();
    if (expense_date !== undefined) doc.expense_date = new Date(expense_date);

    await doc.save();

    return res.json({ ok: true, message: "Xarajat yangilandi", data: doc });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};

/* ================= DELETE ================= */
exports.deleteExpense = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, message: "id noto‘g‘ri" });
    }

    const doc = await Expense.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, message: "Xarajat topilmadi" });
    }

    return res.json({ ok: true, message: "Xarajat o‘chirildi" });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};

/* ================= SUMMARY ================= */
/**
 * GET /api/expenses/stats/summary
 */
exports.getExpenseSummary = async (req, res) => {
  try {
    const filter = {};

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    if (from || to) {
      filter.expense_date = {};
      if (from) filter.expense_date.$gte = from;
      if (to) filter.expense_date.$lte = to;
    }

    const rows = await Expense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { currency: "$currency", category: "$category" },
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totals = { UZS: 0, USD: 0 };
    const byCurrency = { UZS: [], USD: [] };

    for (const r of rows) {
      totals[r._id.currency] += r.totalAmount;
      byCurrency[r._id.currency].push({
        category: r._id.category,
        totalAmount: r.totalAmount,
        count: r.count,
      });
    }

    return res.json({ ok: true, totals, byCurrency });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};
