const Supplier = require("../modules/Suppliers/Supplier");
const Purchase = require("../modules/Purchases/Purchase");


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

    const supplier = await Supplier.create({ name, phone });

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
      supplier.phone = phone;
    }

    if (name !== undefined) supplier.name = name;

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
      total_debt_uzs: s.total_debt_uzs || 0,
      purchases_count: map[String(s._id)]?.purchases_count || 0,
      last_purchase_at: map[String(s._id)]?.last_purchase_at || null,
      createdAt: s.createdAt,
    }));

    return res.json({
      ok: true,
      total_suppliers,
      total_debt_uzs,
      items,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * GET /api/suppliers/:id/detail
 * Query: page, limit, from, to
 */
exports.getSupplierDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });
    }

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip = (page - 1) * limit;

    const purchaseFilter = { supplier_id: id };

    if (req.query.from || req.query.to) {
      purchaseFilter.createdAt = {};
      if (req.query.from) purchaseFilter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) purchaseFilter.createdAt.$lte = new Date(req.query.to);
    }

    const [items, total] = await Promise.all([
      Purchase.find(purchaseFilter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Purchase.countDocuments(purchaseFilter),
    ]);

    return res.json({
      ok: true,
      supplier: {
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        total_debt_uzs: supplier.total_debt_uzs || 0,
        createdAt: supplier.createdAt,
      },
      purchases: { page, limit, total, items },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * POST /api/suppliers/:id/pay
 * Body: { amount_uzs, note? }
 */
exports.paySupplierDebt = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_uzs, note } = req.body;

    const amount = Number(amount_uzs);

    if (!amount_uzs || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount_uzs noto‘g‘ri (0 dan katta bo‘lsin)",
      });
    }

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ ok: false, message: "Zavod topilmadi" });
    }

    const currentDebt = Number(supplier.total_debt_uzs || 0);

    if (currentDebt <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Bu zavodda qarz yo‘q",
      });
    }

    // Qancha qismi qarzga tushadi (overpay bo'lsa ham)
    const applied = Math.min(amount, currentDebt);
    const change = Math.max(0, amount - currentDebt);

    supplier.total_debt_uzs = currentDebt - applied;

    supplier.payment_history.push({
      amount_uzs: applied,
      note: `${note || "Qarz to‘lovi"}${change > 0 ? ` (Ortiqcha: ${change})` : ""}`,
    });

    await supplier.save();

    return res.json({
      ok: true,
      message: "To‘lov qabul qilindi",
      supplier: {
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        total_debt_uzs: supplier.total_debt_uzs,
      },
      payment: {
        paid_amount_uzs: applied,
        previous_debt_uzs: currentDebt,
        remaining_debt_uzs: supplier.total_debt_uzs,
        change_uzs: change,
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
