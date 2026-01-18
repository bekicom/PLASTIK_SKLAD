const mongoose = require("mongoose");
const Expense = require("../modules/expenses/Expense");

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

function getUserId(req) {
  return req.user?._id || req.user?.id || req.userId || null;
}

/* =========================
   CREATE EXPENSE
   POST /api/expenses
========================= */
exports.createExpense = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const {
      category,
      amount,
      currency = "UZS",
      payment_method = "CASH",
      note,
      expense_date,
    } = req.body || {};

    if (!category || !String(category).trim()) {
      return res.status(400).json({
        ok: false,
        message: "category majburiy",
      });
    }

    const amt = safeNum(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 dan katta bo‘lishi kerak",
      });
    }

    if (!Expense.CUR.includes(currency)) {
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

    const parsedDate = expense_date ? new Date(expense_date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        ok: false,
        message: "expense_date noto‘g‘ri formatda",
      });
    }

    const doc = await Expense.create({
      category: category.trim(),
      amount: amt,
      currency,
      payment_method,
      note: note?.trim() || "",
      expense_date: parsedDate,
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

/* =========================
   GET EXPENSES
   GET /api/expenses
========================= */
exports.getExpenses = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const skip = (page - 1) * limit;

    /* =========================
       FILTER
    ========================= */
    const filter = {};

    // 🔍 Search
    if (req.query.q) {
      const r = new RegExp(req.query.q.trim(), "i");
      filter.$or = [{ category: r }, { note: r }];
    }

    // 📂 Category
    if (req.query.category) {
      filter.category = req.query.category.trim();
    }

    // 💱 Currency
    if (req.query.currency && Expense.CUR.includes(req.query.currency)) {
      filter.currency = req.query.currency;
    }

    // 💳 Payment method
    if (["CASH", "CARD"].includes(req.query.payment_method)) {
      filter.payment_method = req.query.payment_method;
    }

    // 👤 Created by
    if (req.query.createdBy) {
      if (!mongoose.isValidObjectId(req.query.createdBy)) {
        return res.status(400).json({
          ok: false,
          message: "createdBy noto‘g‘ri",
        });
      }
      filter.createdBy = new mongoose.Types.ObjectId(req.query.createdBy);
    }

    // 📆 DATE FILTER (expense_date)
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);

    if (from || to) {
      filter.expense_date = {};
      if (from) filter.expense_date.$gte = from;
      if (to) filter.expense_date.$lte = to;
    }

    /* =========================
       QUERY
    ========================= */
    const [items, total, totals] = await Promise.all([
      Expense.find(filter)
        .sort({ expense_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name role")
        .lean(),

      Expense.countDocuments(filter),

      Expense.aggregate([
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

    /* =========================
       FORMAT TOTALS
    ========================= */
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
      message: "Server xatoligi",
      error: err.message,
    });
  }
};

/* =========================
   GET EXPENSE BY ID
========================= */
exports.getExpenseById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto‘g‘ri",
      });
    }

    const doc = await Expense.findById(req.params.id)
      .populate("createdBy", "name role")
      .lean();

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Xarajat topilmadi",
      });
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

/* =========================
   UPDATE EXPENSE
========================= */
exports.updateExpense = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto‘g‘ri",
      });
    }

    const doc = await Expense.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Xarajat topilmadi",
      });
    }

    const { category, amount, currency, payment_method, note, expense_date } =
      req.body || {};

    if (category !== undefined && category.trim()) {
      doc.category = category.trim();
    }

    if (currency !== undefined && Expense.CUR.includes(currency)) {
      doc.currency = currency;
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

    if (
      payment_method !== undefined &&
      ["CASH", "CARD"].includes(payment_method)
    ) {
      doc.payment_method = payment_method;
    }

    if (note !== undefined) {
      doc.note = note?.trim() || "";
    }

    if (expense_date !== undefined) {
      const d = new Date(expense_date);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({
          ok: false,
          message: "expense_date noto‘g‘ri",
        });
      }
      doc.expense_date = d;
    }

    await doc.save();

    return res.json({
      ok: true,
      message: "Xarajat yangilandi",
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

/* =========================
   DELETE EXPENSE
========================= */
exports.deleteExpense = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto‘g‘ri",
      });
    }

    const doc = await Expense.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Xarajat topilmadi",
      });
    }

    return res.json({
      ok: true,
      message: "Xarajat o‘chirildi",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};
