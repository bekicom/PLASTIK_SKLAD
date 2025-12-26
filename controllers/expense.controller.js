const mongoose = require("mongoose");
const Expense = require("../modules/expenses/Expense");

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

/**
 * POST /api/expenses/create
 * Body: { category, amount, currency, note?, expense_date? }
 */
exports.createExpense = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.userId;
    if (!userId)
      return res.status(401).json({ ok: false, message: "Unauthorized" });

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

    const amt = safeNum(amount, 0);
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
      category: String(category).trim(),
      amount: amt,
      currency,
      note: note ? String(note).trim() : undefined,
      expense_date: expense_date ? new Date(expense_date) : new Date(),
      createdBy: userId,
    });

    return res
      .status(201)
      .json({ ok: true, message: "Xarajat qo‘shildi", data: doc });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: err.message });
  }
};

/**
 * GET /api/expenses
 * Query: q, category, currency, createdBy, from, to, page, limit
 */
exports.getExpenses = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      200
    );
    const skip = (page - 1) * limit;

    const filter = {};

    const q = (req.query.q || "").trim();
    if (q) {
      const r = new RegExp(q, "i");
      filter.$or = [{ category: r }, { note: r }];
    }

    if (req.query.category) filter.category = String(req.query.category).trim();
    if (req.query.currency) filter.currency = req.query.currency;

    if (req.query.createdBy) {
      if (!mongoose.isValidObjectId(req.query.createdBy)) {
        return res
          .status(400)
          .json({ ok: false, message: "createdBy noto‘g‘ri" });
      }
      filter.createdBy = req.query.createdBy;
    }

    const fromDate = parseDate(req.query.from, false);
    const toDate = parseDate(req.query.to, true);
    if (fromDate || toDate) {
      filter.expense_date = {};
      if (fromDate) filter.expense_date.$gte = fromDate;
      if (toDate) filter.expense_date.$lte = toDate;
    }

    const [items, total] = await Promise.all([
      Expense.find(filter)
        .sort({ expense_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name phone role"),
      Expense.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: err.message });
  }
};

/**
 * GET /api/expenses/:id
 */
exports.getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "id noto‘g‘ri" });
    }

    const doc = await Expense.findById(id).populate(
      "createdBy",
      "name phone role"
    );
    if (!doc)
      return res.status(404).json({ ok: false, message: "Xarajat topilmadi" });

    return res.json({ ok: true, data: doc });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: err.message });
  }
};

/**
 * PUT /api/expenses/:id
 * Body: category?, amount?, currency?, note?, expense_date?
 */
exports.updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "id noto‘g‘ri" });
    }

    const doc = await Expense.findById(id);
    if (!doc)
      return res.status(404).json({ ok: false, message: "Xarajat topilmadi" });

    const { category, amount, currency, note, expense_date } = req.body || {};

    if (category !== undefined) {
      if (!String(category).trim())
        return res
          .status(400)
          .json({ ok: false, message: "category bo‘sh bo‘lmasin" });
      doc.category = String(category).trim();
    }

    if (currency !== undefined) {
      if (!Expense.CUR.includes(currency)) {
        return res
          .status(400)
          .json({ ok: false, message: "currency noto‘g‘ri (UZS/USD)" });
      }
      doc.currency = currency;
    }

    if (amount !== undefined) {
      const amt = safeNum(amount, 0);
      if (amt <= 0)
        return res
          .status(400)
          .json({ ok: false, message: "amount 0 dan katta bo‘lsin" });
      doc.amount = amt;
    }

    if (note !== undefined) doc.note = note ? String(note).trim() : undefined;
    if (expense_date !== undefined)
      doc.expense_date = expense_date
        ? new Date(expense_date)
        : doc.expense_date;

    await doc.save();

    return res.json({ ok: true, message: "Xarajat yangilandi", data: doc });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: err.message });
  }
};

/**
 * DELETE /api/expenses/:id
 */
exports.deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "id noto‘g‘ri" });
    }

    const doc = await Expense.findByIdAndDelete(id);
    if (!doc)
      return res.status(404).json({ ok: false, message: "Xarajat topilmadi" });

    return res.json({ ok: true, message: "Xarajat o‘chirildi", data: doc });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: err.message });
  }
};

/**
 * GET /api/expenses/stats/summary
 * Query: from, to, createdBy?
 * ✅ UZS/USD totals + category breakdown
 */
exports.getExpenseSummary = async (req, res) => {
  try {
    const filter = {};

    if (req.query.createdBy) {
      if (!mongoose.isValidObjectId(req.query.createdBy)) {
        return res
          .status(400)
          .json({ ok: false, message: "createdBy noto‘g‘ri" });
      }
      filter.createdBy = new mongoose.Types.ObjectId(req.query.createdBy);
    }

    const fromDate = parseDate(req.query.from, false);
    const toDate = parseDate(req.query.to, true);
    if (fromDate || toDate) {
      filter.expense_date = {};
      if (fromDate) filter.expense_date.$gte = fromDate;
      if (toDate) filter.expense_date.$lte = toDate;
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
      { $sort: { "_id.currency": 1, totalAmount: -1 } },
    ]);

    const totals = { UZS: 0, USD: 0 };
    const byCurrency = { UZS: [], USD: [] };

    for (const r of rows) {
      const cur = r._id.currency;
      totals[cur] += r.totalAmount;
      byCurrency[cur].push({
        category: r._id.category,
        totalAmount: r.totalAmount,
        count: r.count,
      });
    }

    return res.json({ ok: true, totals, byCurrency });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: err.message });
  }
};
