const Product = require("../modules/Products/Product");

const UNITS = ["DONA", "PACHKA", "KG"];
const CUR = ["UZS", "USD"];

/**
 * POST /api/products/create
 */
exports.createProduct = async (req, res) => {
  try {
    const {
      supplier_id,
      name,
      model,
      color,
      category,
      unit,
      warehouse_currency,
      qty,
      buy_price,
      sell_price,
    } = req.body;

    if (
      !supplier_id ||
      !name ||
      !unit ||
      !warehouse_currency ||
      buy_price === undefined ||
      sell_price === undefined
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "supplier_id, name, unit, warehouse_currency, buy_price, sell_price majburiy",
      });
    }

    if (!UNITS.includes(unit)) {
      return res
        .status(400)
        .json({ ok: false, message: "unit noto‘g‘ri (DONA/PACHKA/KG)" });
    }

    if (!CUR.includes(warehouse_currency)) {
      return res
        .status(400)
        .json({ ok: false, message: "warehouse_currency noto‘g‘ri (UZS/USD)" });
    }

    const product = await Product.create({
      supplier_id,
      name: name.trim(),
      model: (model || "").trim(),
      color: (color || "").trim(),
      category: (category || "").trim(),
      unit,
      warehouse_currency,
      qty: qty || 0,
      buy_price,
      sell_price,
    });

    return res.status(201).json({
      ok: true,
      message: "Mahsulot yaratildi",
      product,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ ok: false, message: "Bu mahsulot allaqachon mavjud" });
    }
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * GET /api/products
 * Query: q, page, limit, currency, category, supplier_id
 */
exports.getProducts = async (req, res) => {
  try {
    const { q, currency, category, supplier_id } = req.query;

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      100
    );
    const skip = (page - 1) * limit;

    const filter = {};

    if (supplier_id) filter.supplier_id = supplier_id;
    if (currency) filter.warehouse_currency = currency;
    if (category) filter.category = category;

    if (q && q.trim()) {
      const r = new RegExp(q.trim(), "i");
      filter.$or = [{ name: r }, { model: r }, { color: r }, { category: r }];
    }

    const [items, total] = await Promise.all([
      Product.find(filter)
        .populate("supplier_id", "name phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Product.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * GET /api/products/:id
 */
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "supplier_id",
      "name phone"
    );

    if (!product) {
      return res.status(404).json({ ok: false, message: "Mahsulot topilmadi" });
    }

    return res.json({ ok: true, product });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * PUT /api/products/:id
 * supplier_id ni bu yerda o'zgartirmaymiz (xohlasang keyin qo'shamiz)
 */
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ ok: false, message: "Mahsulot topilmadi" });
    }

    const {
      name,
      model,
      color,
      category,
      unit,
      warehouse_currency,
      qty,
      buy_price,
      sell_price,
    } = req.body;

    if (unit !== undefined && !UNITS.includes(unit)) {
      return res
        .status(400)
        .json({ ok: false, message: "unit noto‘g‘ri (DONA/PACHKA/KG)" });
    }

    if (warehouse_currency !== undefined && !CUR.includes(warehouse_currency)) {
      return res
        .status(400)
        .json({ ok: false, message: "warehouse_currency noto‘g‘ri (UZS/USD)" });
    }

    if (name !== undefined) product.name = name;
    if (model !== undefined) product.model = model;
    if (color !== undefined) product.color = color;
    if (category !== undefined) product.category = category;
    if (unit !== undefined) product.unit = unit;
    if (warehouse_currency !== undefined)
      product.warehouse_currency = warehouse_currency;
    if (qty !== undefined) product.qty = qty;
    if (buy_price !== undefined) product.buy_price = buy_price;
    if (sell_price !== undefined) product.sell_price = sell_price;

    await product.save();

    return res.json({ ok: true, message: "Mahsulot yangilandi", product });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ ok: false, message: "Bu mahsulot allaqachon mavjud" });
    }
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * DELETE /api/products/:id
 */
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ ok: false, message: "Mahsulot topilmadi" });
    }

    return res.json({ ok: true, message: "Mahsulot o‘chirildi", product });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};
