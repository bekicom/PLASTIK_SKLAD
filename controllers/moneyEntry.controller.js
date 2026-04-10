const mongoose = require("mongoose");
const MoneyEntry = require("../modules/moneyEntries/MoneyEntry");

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

function applySummary(summary, row) {
  const cur = row.currency;
  if (!summary[cur]) return;
  const amt = Number(row.amount || 0);

  if (row.entry_type === "INCOME") {
    summary[cur].income += amt;
  } else if (row.entry_type === "EXPENSE") {
    summary[cur].expense += amt;
  }

  summary[cur].net = summary[cur].income - summary[cur].expense;

  if (row.payment_method === "CASH" || row.payment_method === "CARD") {
    summary[cur].by_method[row.payment_method] +=
      row.entry_type === "INCOME" ? amt : -amt;
  }
}

exports.createMoneyEntry = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const {
      entry_type,
      amount,
      currency = "UZS",
      payment_method = "CASH",
      note = "",
      entry_date,
    } = req.body || {};

    const type = String(entry_type || "").toUpperCase();
    if (!MoneyEntry.TYPES.includes(type)) {
      return res.status(400).json({
        ok: false,
        message: "entry_type INCOME yoki EXPENSE bo'lishi kerak",
      });
    }

    const amt = safeNum(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 dan katta bo'lishi kerak",
      });
    }

    if (!MoneyEntry.CUR.includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto'g'ri (UZS/USD)",
      });
    }

    if (!MoneyEntry.METHODS.includes(payment_method)) {
      return res.status(400).json({
        ok: false,
        message: "payment_method noto'g'ri (CASH/CARD)",
      });
    }

    const parsedDate = entry_date ? new Date(entry_date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        ok: false,
        message: "entry_date noto'g'ri",
      });
    }

    const doc = await MoneyEntry.create({
      entry_type: type,
      amount: amt,
      currency,
      payment_method,
      note: String(note || "").trim(),
      entry_date: parsedDate,
      createdBy: userId,
      updatedBy: userId,
    });

    return res.status(201).json({
      ok: true,
      message: "Pul yozuvi qo'shildi",
      data: doc,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.getMoneyEntries = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.q) {
      const r = new RegExp(String(req.query.q).trim(), "i");
      filter.$or = [{ note: r }];
    }

    const type = String(req.query.entry_type || "").toUpperCase();
    if (MoneyEntry.TYPES.includes(type)) filter.entry_type = type;

    const cur = String(req.query.currency || "").toUpperCase();
    if (MoneyEntry.CUR.includes(cur)) filter.currency = cur;

    const method = String(req.query.payment_method || "").toUpperCase();
    if (MoneyEntry.METHODS.includes(method)) filter.payment_method = method;

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    if (from || to) {
      filter.entry_date = {};
      if (from) filter.entry_date.$gte = from;
      if (to) filter.entry_date.$lte = to;
    }

    const [items, total, summaryRows] = await Promise.all([
      MoneyEntry.find(filter)
        .sort({ entry_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name role")
        .populate("updatedBy", "name role")
        .lean(),
      MoneyEntry.countDocuments(filter),
      MoneyEntry.find(filter).select("entry_type amount currency payment_method").lean(),
    ]);

    const summary = {
      UZS: { income: 0, expense: 0, net: 0, by_method: { CASH: 0, CARD: 0 } },
      USD: { income: 0, expense: 0, net: 0, by_method: { CASH: 0, CARD: 0 } },
    };

    for (const row of summaryRows) {
      applySummary(summary, row);
    }

    return res.json({
      ok: true,
      page,
      limit,
      total,
      summary,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Pul yozuvlarini olishda xato",
      error: error.message,
    });
  }
};

exports.getMoneyEntryById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto'g'ri",
      });
    }

    const doc = await MoneyEntry.findById(id)
      .populate("createdBy", "name role")
      .populate("updatedBy", "name role")
      .lean();

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Yozuv topilmadi",
      });
    }

    return res.json({ ok: true, data: doc });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.updateMoneyEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto'g'ri",
      });
    }

    const doc = await MoneyEntry.findById(id);
    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Yozuv topilmadi",
      });
    }

    if (req.body.entry_type !== undefined) {
      const type = String(req.body.entry_type || "").toUpperCase();
      if (!MoneyEntry.TYPES.includes(type)) {
        return res.status(400).json({
          ok: false,
          message: "entry_type INCOME yoki EXPENSE bo'lishi kerak",
        });
      }
      doc.entry_type = type;
    }

    if (req.body.amount !== undefined) {
      const amt = safeNum(req.body.amount);
      if (!amt || amt <= 0) {
        return res.status(400).json({
          ok: false,
          message: "amount noto'g'ri",
        });
      }
      doc.amount = amt;
    }

    if (req.body.currency !== undefined) {
      const cur = String(req.body.currency || "").toUpperCase();
      if (!MoneyEntry.CUR.includes(cur)) {
        return res.status(400).json({
          ok: false,
          message: "currency noto'g'ri",
        });
      }
      doc.currency = cur;
    }

    if (req.body.payment_method !== undefined) {
      const method = String(req.body.payment_method || "").toUpperCase();
      if (!MoneyEntry.METHODS.includes(method)) {
        return res.status(400).json({
          ok: false,
          message: "payment_method noto'g'ri",
        });
      }
      doc.payment_method = method;
    }

    if (req.body.entry_date !== undefined) {
      const d = new Date(req.body.entry_date);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({
          ok: false,
          message: "entry_date noto'g'ri",
        });
      }
      doc.entry_date = d;
    }

    if (req.body.note !== undefined) {
      doc.note = String(req.body.note || "").trim();
    }

    doc.updatedBy = userId || doc.updatedBy;
    await doc.save();

    return res.json({
      ok: true,
      message: "Pul yozuvi yangilandi",
      data: doc,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

exports.deleteMoneyEntry = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "id noto'g'ri",
      });
    }

    const doc = await MoneyEntry.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Yozuv topilmadi",
      });
    }

    return res.json({
      ok: true,
      message: "Pul yozuvi o'chirildi",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
