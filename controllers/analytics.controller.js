const service = require("../modules/analytics/analytics.service");
const StartingBalance = require("../modules/analytics/StartingBalance");

function parseDate(s, endOfDay = false) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function asMoneyBucket() {
  return {
    UZS: { CASH: 0, CARD: 0, total: 0 },
    USD: { CASH: 0, CARD: 0, total: 0 },
  };
}

function applyRowToSummary(summary, row) {
  const cur = row?.currency;
  const method = row?.payment_method;
  const amount = Number(row?.amount || 0);

  if (!summary[cur]) return;
  if (method !== "CASH" && method !== "CARD") return;

  summary[cur][method] += amount;
  summary[cur].total = summary[cur].CASH + summary[cur].CARD;
}

/**
 * DASHBOARD OVERVIEW
 * - supplier / customer balance (qarz & avans)
 * - sales / profit / expenses / orders
 */
exports.overview = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const warehouseId = req.query.warehouseId || null;

    const startingBalance = await service.getStartingBalanceSummary({
      beforeDate: from || null,
    });

    const data = await service.getOverview({
      from,
      to,
      tz,
      warehouseId,
      startingBalance,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "overview xatolik",
      error: e.message,
    });
  }
};

/**
 * TIME SERIES (grafiklar)
 */
exports.timeseries = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const group = req.query.group === "month" ? "month" : "day";

    const data = await service.getTimeSeries({
      from,
      to,
      tz,
      group,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "timeseries xatolik",
      error: e.message,
    });
  }
};

/**
 * TOP LISTS
 * type:
 *  - customers  (eng katta qarzdor customerlar)
 *  - products
 */
exports.top = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const type = req.query.type || "products";

    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50,
    );

    const data = await service.getTop({
      from,
      to,
      tz,
      type,
      limit,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "top xatolik",
      error: e.message,
    });
  }
};

/**
 * STOCK
 */
exports.stock = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";

    const data = await service.getStock({
      from,
      to,
      tz,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "stock xatolik",
      error: e.message,
    });
  }
};

exports.createStartingBalance = async (req, res) => {
  try {
    const amount = Number(req.body?.amount || 0);
    const currency = String(req.body?.currency || "").toUpperCase();
    const payment_method = String(req.body?.payment_method || "CASH").toUpperCase();
    const note = req.body?.note ? String(req.body.note).trim() : "";
    const date = parseDate(req.body?.date) || new Date();
    const userId = req.user?._id || req.user?.id || null;

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency UZS yoki USD bo'lishi kerak",
      });
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      return res.status(400).json({
        ok: false,
        message: "payment_method CASH yoki CARD bo'lishi kerak",
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 dan katta bo'lishi kerak",
      });
    }

    const row = await StartingBalance.create({
      date,
      currency,
      payment_method,
      amount,
      note,
      createdBy: userId || null,
      updatedBy: userId || null,
    });

    return res.status(201).json({
      ok: true,
      message: "Boshlang'ich balans qo'shildi",
      item: row,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "Boshlang'ich balans qo'shishda xato",
      error: e.message,
    });
  }
};

exports.getStartingBalanceList = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const currency = String(req.query.currency || "").toUpperCase();
    const payment_method = String(req.query.payment_method || "").toUpperCase();
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (["UZS", "USD"].includes(currency)) filter.currency = currency;
    if (["CASH", "CARD"].includes(payment_method)) filter.payment_method = payment_method;

    const [items, total] = await Promise.all([
      StartingBalance.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StartingBalance.countDocuments(filter),
    ]);

    const summary = asMoneyBucket();
    for (const row of items) applyRowToSummary(summary, row);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      summary,
      items,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "Boshlang'ich balans list olishda xato",
      error: e.message,
    });
  }
};

exports.updateStartingBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id || null;

    const row = await StartingBalance.findById(id);
    if (!row) {
      return res.status(404).json({
        ok: false,
        message: "Boshlang'ich balans yozuvi topilmadi",
      });
    }

    if (req.body.amount !== undefined) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
          ok: false,
          message: "amount 0 dan katta bo'lishi kerak",
        });
      }
      row.amount = amount;
    }

    if (req.body.currency !== undefined) {
      const currency = String(req.body.currency || "").toUpperCase();
      if (!["UZS", "USD"].includes(currency)) {
        return res.status(400).json({
          ok: false,
          message: "currency UZS yoki USD bo'lishi kerak",
        });
      }
      row.currency = currency;
    }

    if (req.body.payment_method !== undefined) {
      const method = String(req.body.payment_method || "").toUpperCase();
      if (!["CASH", "CARD"].includes(method)) {
        return res.status(400).json({
          ok: false,
          message: "payment_method CASH yoki CARD bo'lishi kerak",
        });
      }
      row.payment_method = method;
    }

    if (req.body.date !== undefined) {
      const d = parseDate(req.body.date);
      if (!d) {
        return res.status(400).json({
          ok: false,
          message: "date noto'g'ri formatda",
        });
      }
      row.date = d;
    }

    if (req.body.note !== undefined) {
      row.note = String(req.body.note || "").trim();
    }

    row.updatedBy = userId || null;
    await row.save();

    return res.json({
      ok: true,
      message: "Boshlang'ich balans yangilandi",
      item: row,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "Boshlang'ich balans update xato",
      error: e.message,
    });
  }
};

exports.deleteStartingBalance = async (req, res) => {
  try {
    const { id } = req.params;

    const row = await StartingBalance.findByIdAndDelete(id);
    if (!row) {
      return res.status(404).json({
        ok: false,
        message: "Boshlang'ich balans yozuvi topilmadi",
      });
    }

    return res.json({
      ok: true,
      message: "Boshlang'ich balans o'chirildi",
      deleted: {
        _id: row._id,
        amount: row.amount,
        currency: row.currency,
        payment_method: row.payment_method,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "Boshlang'ich balans delete xato",
      error: e.message,
    });
  }
};

/**
 * PROFIT DETAILS (card eye)
 * - qaysi tovardan foyda kelgani
 * - tranzaksiya darajasida ro'yxat
 */
exports.profitDetails = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const currency = String(req.query.currency || "ALL").toUpperCase();
    const productId = req.query.productId || null;
    const customerId = req.query.customerId || null;
    const limit = Math.min(
      1000,
      Math.max(parseInt(req.query.limit || "500", 10), 1),
    );

    const data = await service.getProfitDetails({
      from,
      to,
      currency,
      productId,
      customerId,
      limit,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "profit details xatolik",
      error: e.message,
    });
  }
};

/**
 * BUSINESS ANALYSIS
 * - top/bottom customer, product, supplier by profit
 * - full tables
 */
exports.businessAnalysis = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const currency = String(req.query.currency || "ALL").toUpperCase();
    const limit = Math.min(
      50,
      Math.max(parseInt(req.query.limit || "10", 10), 1),
    );

    const data = await service.getBusinessAnalysis({
      from,
      to,
      currency,
      limit,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: "business analysis xatolik",
      error: e.message,
    });
  }
};
