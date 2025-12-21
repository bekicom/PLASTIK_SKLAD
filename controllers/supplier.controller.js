const Supplier = require("../modules/Suppliers/Supplier");
const Purchase = require("../modules/Purchases/Purchase");

const CUR = ["UZS", "USD"];

/** Helper: purchase totalsni items’dan hisoblaydi (rate’siz) */
function calcPurchaseTotals(p) {
  const items = Array.isArray(p.items) ? p.items : [];
  let totalUzs = 0;
  let totalUsd = 0;

  for (const it of items) {
    const Q = Number(it.qty || 0);
    const BP = Number(it.buy_price || 0);
    const row = Q * BP;

    if (it.currency === "UZS") totalUzs += row;
    if (it.currency === "USD") totalUsd += row;
  }

  const paidUzs = Number(p.paid_amount_uzs || 0);
  const paidUsd = Number(p.paid_amount_usd || 0);

  return {
    uzs: {
      total: totalUzs,
      paid: paidUzs,
      debt: Math.max(0, totalUzs - paidUzs),
    },
    usd: {
      total: totalUsd,
      paid: paidUsd,
      debt: Math.max(0, totalUsd - paidUsd),
    },
  };
}

/**
 * POST /api/suppliers/create
 */
exports.createSupplier = async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res
        .status(400)
        .json({ ok: false, message: "name va phone majburiy" });
    }

    const exists = await Supplier.findOne({ phone });
    if (exists) {
      return res
        .status(409)
        .json({ ok: false, message: "Bu telefon raqam band" });
    }

    const supplier = await Supplier.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      // schema’da bo‘lsa — defaults qo‘yib ketadi, bo‘lmasa ignore bo‘ladi
      total_debt_uzs: 0,
      total_debt_usd: 0,
    });

    return res.status(201).json({
      ok: true,
      message: "Zavod yaratildi",
      supplier,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * GET /api/suppliers
 * Query: q, page, limit
 */
exports.getSuppliers = async (req, res) => {
  try {
    const { q } = req.query;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      100
    );
    const skip = (page - 1) * limit;

    const filter = {};
    if (q && q.trim()) {
      const r = new RegExp(q.trim(), "i");
      filter.$or = [{ name: r }, { phone: r }];
    }

    const [items, total] = await Promise.all([
      Supplier.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Supplier.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * GET /api/suppliers/:id
 */
exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    return res.json({ ok: true, supplier });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * PUT /api/suppliers/:id
 */
exports.updateSupplier = async (req, res) => {
  try {
    const { name, phone } = req.body;

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    if (phone && phone !== supplier.phone) {
      const phoneExists = await Supplier.findOne({
        phone,
        _id: { $ne: supplier._id },
      });
      if (phoneExists)
        return res.status(409).json({ ok: false, message: "Bu telefon band" });
      supplier.phone = String(phone).trim();
    }

    if (name !== undefined) supplier.name = String(name).trim();

    await supplier.save();

    return res.json({ ok: true, message: "Zavod yangilandi", supplier });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * DELETE /api/suppliers/:id
 */
exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier)
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });

    return res.json({ ok: true, message: "Zavod o‘chirildi", supplier });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * GET /api/suppliers/dashboard
 */
exports.getSuppliersDashboard = async (req, res) => {
  try {
    const { q } = req.query;

    const filter = {};
    if (q && q.trim()) {
      const r = new RegExp(q.trim(), "i");
      filter.$or = [{ name: r }, { phone: r }];
    }

    const suppliers = await Supplier.find(filter).sort({ createdAt: -1 });
    const total_suppliers = await Supplier.countDocuments(filter);

    const total_debt_uzs = suppliers.reduce(
      (sum, s) => sum + Number(s.total_debt_uzs || 0),
      0
    );

    const total_debt_usd = suppliers.reduce(
      (sum, s) => sum + Number(s.total_debt_usd || 0),
      0
    );

    const ids = suppliers.map((s) => s._id);

    const stats = await Purchase.aggregate([
      { $match: { supplier_id: { $in: ids } } },
      {
        $group: {
          _id: "$supplier_id",
          purchases_count: { $sum: 1 },
          last_purchase_at: { $max: "$createdAt" },
        },
      },
    ]);

    const map = {};
    stats.forEach((x) => {
      map[String(x._id)] = {
        purchases_count: x.purchases_count,
        last_purchase_at: x.last_purchase_at,
      };
    });

    const items = suppliers.map((s) => ({
      id: s._id,
      name: s.name,
      phone: s.phone,
      total_debt_uzs: Number(s.total_debt_uzs || 0),
      total_debt_usd: Number(s.total_debt_usd || 0),
      purchases_count: map[String(s._id)]?.purchases_count || 0,
      last_purchase_at: map[String(s._id)]?.last_purchase_at || null,
      createdAt: s.createdAt,
    }));

    return res.json({
      ok: true,
      total_suppliers,
      total_debt_uzs,
      total_debt_usd,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/**
 * GET /api/suppliers/:id/detail
 * Query: page, limit, from, to
 *
 * ✅ FIX: history'da har purchase uchun totals (UZS+USD) hisoblab qaytaradi.
 */
exports.getSupplierDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });
    }

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      100
    );
    const skip = (page - 1) * limit;

    const purchaseFilter = { supplier_id: id };

    if (req.query.from || req.query.to) {
      purchaseFilter.createdAt = {};
      if (req.query.from)
        purchaseFilter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) purchaseFilter.createdAt.$lte = new Date(req.query.to);
    }

    const [rows, total] = await Promise.all([
      Purchase.find(purchaseFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Purchase.countDocuments(purchaseFilter),
    ]);

    // ✅ har bir purchase uchun totals qo‘shamiz
    const items = rows.map((p) => {
      const totals = calcPurchaseTotals(p);

      // eski fieldlarni ham "to‘g‘ri ko‘rinadigan" qilib override qilib yuboramiz:
      // (front total_amount_uzs ni ko'rsatsa ham 0 bo'lib qolmasin UZS item bo'lsa)
      return {
        ...p,
        total_amount_uzs: totals.uzs.total,
        debt_amount_uzs: totals.uzs.debt,
        // agar schema’da yo‘q bo‘lsa ham frontda ko‘rinsin:
        total_amount_usd: totals.usd.total,
        paid_amount_usd: totals.usd.paid,
        debt_amount_usd: totals.usd.debt,
        totals,
      };
    });

    return res.json({
      ok: true,
      supplier: {
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        total_debt_uzs: Number(supplier.total_debt_uzs || 0),
        total_debt_usd: Number(supplier.total_debt_usd || 0),
        createdAt: supplier.createdAt,
      },
      purchases: { page, limit, total, items },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/**
 * POST /api/suppliers/:id/pay
 * Body: { amount, currency: "UZS"|"USD", note? }
 *
 * ✅ FIX: bitta endpoint bilan UZS yoki USD qarz to‘lovi
 */
exports.paySupplierDebt = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency = "UZS", note } = req.body;

    if (!CUR.includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto‘g‘ri (UZS/USD)",
      });
    }

    const payAmount = Number(amount);
    if (!amount || Number.isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount noto‘g‘ri (0 dan katta bo‘lsin)",
      });
    }

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });
    }

    const debtField = currency === "UZS" ? "total_debt_uzs" : "total_debt_usd";
    const currentDebt = Number(supplier[debtField] || 0);

    if (currentDebt <= 0) {
      return res.status(400).json({
        ok: false,
        message: `Bu zavodda ${currency} qarz yo‘q`,
      });
    }

    const applied = Math.min(payAmount, currentDebt);
    const change = Math.max(0, payAmount - currentDebt);

    supplier[debtField] = currentDebt - applied;

    // payment_history strukturasi schema’ga bog‘liq:
    // UZS bo‘lsa amount_uzs, USD bo‘lsa amount_usd yozamiz
    supplier.payment_history = supplier.payment_history || [];
    supplier.payment_history.push({
      amount_uzs: currency === "UZS" ? applied : undefined,
      amount_usd: currency === "USD" ? applied : undefined,
      currency,
      note: `${note || "Qarz to‘lovi"}${
        change > 0 ? ` (Ortiqcha: ${change})` : ""
      }`,
      createdAt: new Date(),
    });

    await supplier.save();

    return res.json({
      ok: true,
      message: "To‘lov qabul qilindi",
      supplier: {
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        total_debt_uzs: Number(supplier.total_debt_uzs || 0),
        total_debt_usd: Number(supplier.total_debt_usd || 0),
      },
      payment: {
        currency,
        paid_amount: applied,
        previous_debt: currentDebt,
        remaining_debt: supplier[debtField],
        change,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
