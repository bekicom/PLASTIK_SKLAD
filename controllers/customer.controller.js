const mongoose = require("mongoose");
const Customer = require("../modules/Customer/Customer");
const Sale = require("../modules/sales/Sale");
const Order = require("../modules/orders/Order");
function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/\s+/g, "").trim();
}

function safeTrim(v, maxLen) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return "";
  return maxLen ? s.slice(0, maxLen) : s;
}

function asObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

/**
 * POST /customers/create (ADMIN or CASHIER)
 */
exports.createCustomer = async (req, res) => {
  try {
    const { name, phone, address, note } = req.body || {};

    const n = safeTrim(name, 120);
    if (!n) {
      return res.status(400).json({ ok: false, message: "name majburiy" });
    }

    const p = normalizePhone(phone);
    const doc = await Customer.create({
      name: n,
      phone: p || undefined,
      address: safeTrim(address, 250) || undefined,
      note: safeTrim(note, 300) || undefined,
    });

    return res
      .status(201)
      .json({ ok: true, message: "Customer yaratildi", data: doc });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: "Customer create xato", error: err.message });
  }
};

/**
 * GET /customers?search=&page=&limit=&isActive=
 * (ADMIN or CASHIER)
 */
exports.getCustomers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "20", 10))
    );
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.isActive === "true") filter.isActive = true;
    if (req.query.isActive === "false") filter.isActive = false;

    const search = (req.query.search || "").trim();
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const [customers, total] = await Promise.all([
      Customer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    const ids = customers.map((c) => c._id);

    // ✅ har bir customer bo'yicha debtlarni yig'amiz (COMPLETED sales)
    const debts = await Sale.aggregate([
      {
        $match: {
          customerId: { $in: ids },
          status: "COMPLETED",
        },
      },
      {
        $group: {
          _id: "$customerId",
          uzsDebt: { $sum: { $ifNull: ["$currencyTotals.UZS.debtAmount", 0] } },
          usdDebt: { $sum: { $ifNull: ["$currencyTotals.USD.debtAmount", 0] } },
          uzsPaid: { $sum: { $ifNull: ["$currencyTotals.UZS.paidAmount", 0] } },
          usdPaid: { $sum: { $ifNull: ["$currencyTotals.USD.paidAmount", 0] } },
          uzsGrand: {
            $sum: { $ifNull: ["$currencyTotals.UZS.grandTotal", 0] },
          },
          usdGrand: {
            $sum: { $ifNull: ["$currencyTotals.USD.grandTotal", 0] },
          },
          salesCount: { $sum: 1 },
        },
      },
    ]);

    const debtMap = {};
    for (const d of debts) {
      debtMap[String(d._id)] = {
        salesCount: Number(d.salesCount || 0),
        UZS: {
          grandTotal: Number(d.uzsGrand || 0),
          paidAmount: Number(d.uzsPaid || 0),
          debtAmount: Number(d.uzsDebt || 0),
        },
        USD: {
          grandTotal: Number(d.usdGrand || 0),
          paidAmount: Number(d.usdPaid || 0),
          debtAmount: Number(d.usdDebt || 0),
        },
      };
    }

    const items = customers.map((c) => ({
      ...c,
      summary: debtMap[String(c._id)] || {
        salesCount: 0,
        UZS: { grandTotal: 0, paidAmount: 0, debtAmount: 0 },
        USD: { grandTotal: 0, paidAmount: 0, debtAmount: 0 },
      },
    }));

    // umumiy totals (list uchun foydali)
    const totals = items.reduce(
      (acc, c) => {
        acc.UZS.debt += c.summary.UZS.debtAmount;
        acc.USD.debt += c.summary.USD.debtAmount;
        acc.salesCount += c.summary.salesCount;
        return acc;
      },
      { salesCount: 0, UZS: { debt: 0 }, USD: { debt: 0 } }
    );

    return res.json({ ok: true, page, limit, total, totals, items });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customers olishda xato",
      error: err.message,
    });
  }
};

/**
 * GET /customers/:id
 * Customer detail + summary (COMPLETED sales only)
 */
exports.getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const customer = await Customer.findById(id).lean();
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    const cid = asObjectId(id);

    // ✅ Safe aggregation: field bo'lmasa 0
    const summaryAgg = await Sale.aggregate([
      { $match: { customerId: cid, status: "COMPLETED" } },
      {
        $group: {
          _id: null,

          uzsGrand: {
            $sum: { $ifNull: ["$currencyTotals.UZS.grandTotal", 0] },
          },
          uzsPaid: { $sum: { $ifNull: ["$currencyTotals.UZS.paidAmount", 0] } },
          uzsDebt: { $sum: { $ifNull: ["$currencyTotals.UZS.debtAmount", 0] } },

          usdGrand: {
            $sum: { $ifNull: ["$currencyTotals.USD.grandTotal", 0] },
          },
          usdPaid: { $sum: { $ifNull: ["$currencyTotals.USD.paidAmount", 0] } },
          usdDebt: { $sum: { $ifNull: ["$currencyTotals.USD.debtAmount", 0] } },

          salesCount: { $sum: 1 },
        },
      },
    ]);

    const s = summaryAgg[0] || {
      uzsGrand: 0,
      uzsPaid: 0,
      uzsDebt: 0,
      usdGrand: 0,
      usdPaid: 0,
      usdDebt: 0,
      salesCount: 0,
    };

    return res.json({
      ok: true,
      data: customer,
      summary: {
        salesCount: Number(s.salesCount || 0),
        UZS: {
          grandTotal: Number(s.uzsGrand || 0),
          paidAmount: Number(s.uzsPaid || 0),
          debtAmount: Number(s.uzsDebt || 0),
        },
        USD: {
          grandTotal: Number(s.usdGrand || 0),
          paidAmount: Number(s.usdPaid || 0),
          debtAmount: Number(s.usdDebt || 0),
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer detail xato",
      error: err.message,
    });
  }
};

/**
 * PUT /customers/:id
 */
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const patch = {};
    if (req.body?.name !== undefined) patch.name = safeTrim(req.body.name, 120);
    if (req.body?.phone !== undefined) {
      const p = normalizePhone(req.body.phone);
      patch.phone = p || undefined;
    }
    if (req.body?.address !== undefined)
      patch.address = safeTrim(req.body.address, 250) || undefined;
    if (req.body?.note !== undefined)
      patch.note = safeTrim(req.body.note, 300) || undefined;
    if (req.body?.isActive !== undefined) patch.isActive = !!req.body.isActive;

    const updated = await Customer.findByIdAndUpdate(id, patch, {
      new: true,
    }).lean();
    if (!updated) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    return res.json({
      ok: true,
      message: "Customer yangilandi",
      data: updated,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer update xato",
      error: err.message,
    });
  }
};

/**
 * DELETE /customers/:id  (soft delete)
 */
exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const updated = await Customer.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    return res.json({
      ok: true,
      message: "Customer o'chirildi (inactive)",
      data: updated,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer delete xato",
      error: err.message,
    });
  }
};

/**
 * GET /customers/:id/sales?page=&limit=
 * Customer sotuvlari (history list)
 */
exports.getCustomerSales = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "20", 10))
    );
    const skip = (page - 1) * limit;

    const cid = asObjectId(id);

    const filter = { customerId: cid };

    const [rows, total] = await Promise.all([
      Sale.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items: rows });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer sales xato",
      error: err.message,
    });
  }
};

/**
 * GET /customers/:id/statement?dateFrom=&dateTo=
 * Kunma-kun: total, paid, debt (UZS/USD)
 */
exports.getCustomerStatement = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const match = {
      customerId: asObjectId(id),
      status: "COMPLETED",
    };

    if (req.query.dateFrom || req.query.dateTo) {
      match.createdAt = {};
      if (req.query.dateFrom)
        match.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) match.createdAt.$lte = new Date(req.query.dateTo);
    }

    const rows = await Sale.aggregate([
      { $match: match },
      {
        $addFields: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        },
      },
      {
        $group: {
          _id: "$day",

          uzsGrand: {
            $sum: { $ifNull: ["$currencyTotals.UZS.grandTotal", 0] },
          },
          uzsPaid: { $sum: { $ifNull: ["$currencyTotals.UZS.paidAmount", 0] } },
          uzsDebt: { $sum: { $ifNull: ["$currencyTotals.UZS.debtAmount", 0] } },

          usdGrand: {
            $sum: { $ifNull: ["$currencyTotals.USD.grandTotal", 0] },
          },
          usdPaid: { $sum: { $ifNull: ["$currencyTotals.USD.paidAmount", 0] } },
          usdDebt: { $sum: { $ifNull: ["$currencyTotals.USD.debtAmount", 0] } },

          salesCount: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    // outputni chiroyliroq qilish
    const items = rows.map((r) => ({
      day: r._id,
      salesCount: Number(r.salesCount || 0),
      UZS: {
        grandTotal: Number(r.uzsGrand || 0),
        paidAmount: Number(r.uzsPaid || 0),
        debtAmount: Number(r.uzsDebt || 0),
      },
      USD: {
        grandTotal: Number(r.usdGrand || 0),
        paidAmount: Number(r.usdPaid || 0),
        debtAmount: Number(r.usdDebt || 0),
      },
    }));

    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Statement xato",
      error: err.message,
    });
  }
};

exports.getCustomerSummary = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ ok: false, message: "customer id noto‘g‘ri" });
    }

    const customer = await Customer.findById(id).select(
      "name phone address note createdAt"
    );
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    // 1) Agent orderlar bo‘yicha summary
    const [orderAgg] = await Order.aggregate([
      { $match: { customer_id: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$customer_id",
          ordersCount: { $sum: 1 },
          newCount: { $sum: { $cond: [{ $eq: ["$status", "NEW"] }, 1, 0] } },
          confirmedCount: {
            $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] },
          },
          canceledCount: {
            $sum: { $cond: [{ $eq: ["$status", "CANCELED"] }, 1, 0] },
          },

          totalUZS: { $sum: { $ifNull: ["$total_uzs", 0] } },
          totalUSD: { $sum: { $ifNull: ["$total_usd", 0] } },

          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ]);

    // 2) Sales bo‘yicha summary (agar Sale modelda customer_id bo‘lsa)
    const [saleAgg] = await Sale.aggregate([
      { $match: { customer_id: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$customer_id",
          salesCount: { $sum: 1 },
          // ⚠️ Sale modelingizda total field nomi boshqacha bo‘lsa o‘zgartiring
          salesTotalSum: { $sum: { $ifNull: ["$total", 0] } },
          lastSaleAt: { $max: "$createdAt" },
        },
      },
    ]);

    // 3) Oxirgi orderlar ro‘yxati (history)
    const lastOrders = await Order.find({ customer_id: id })
      .populate("agent_id", "name phone login")
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({
      ok: true,
      data: {
        customer,
        orders: {
          ordersCount: orderAgg?.ordersCount || 0,
          newCount: orderAgg?.newCount || 0,
          confirmedCount: orderAgg?.confirmedCount || 0,
          canceledCount: orderAgg?.canceledCount || 0,
          totals: {
            UZS: orderAgg?.totalUZS || 0,
            USD: orderAgg?.totalUSD || 0,
          },
          lastOrderAt: orderAgg?.lastOrderAt || null,
        },
        sales: {
          salesCount: saleAgg?.salesCount || 0,
          total: saleAgg?.salesTotalSum || 0,
          lastSaleAt: saleAgg?.lastSaleAt || null,
        },
        history: {
          lastOrders,
        },
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};
