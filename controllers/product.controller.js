const Product = require("../modules/products/Product");
const fs = require("fs");
const path = require("path");

const UNITS = ["DONA", "PACHKA", "KG"];
const CUR = ["UZS", "USD"];

/* =======================
   HELPERS
======================= */
function toStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

function normalizeText(v) {
  return toStr(v).trim();
}

function safeNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// ✅ IMAGE URL BUILDER (MUHIM)
function withImageUrl(req, images = []) {
  const base = `${req.protocol}://${req.get("host")}`;
  return (images || []).map((img) => `${base}${img}`);
}

/* =======================
   CREATE PRODUCT
======================= */
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
      return res.status(400).json({
        ok: false,
        message: "unit noto‘g‘ri (DONA/PACHKA/KG)",
      });
    }

    if (!CUR.includes(warehouse_currency)) {
      return res.status(400).json({
        ok: false,
        message: "warehouse_currency noto‘g‘ri (UZS/USD)",
      });
    }

    const images = (req.files || []).map(
      (f) => `/uploads/products/${f.filename}`
    );

    const product = await Product.create({
      supplier_id,
      name: normalizeText(name),
      model: normalizeText(model),
      color: normalizeText(color),
      category: normalizeText(category),
      unit,
      warehouse_currency,
      qty: qty !== undefined ? safeNumber(qty, 0) : 0,
      buy_price: safeNumber(buy_price, 0),
      sell_price: safeNumber(sell_price, 0),
      images,
    });

    product.images = withImageUrl(req, product.images);

    return res.status(201).json({
      ok: true,
      message: "Mahsulot yaratildi",
      product,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Bu mahsulot allaqachon mavjud",
      });
    }
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/* =======================
   GET PRODUCTS
======================= */
exports.getProducts = async (req, res) => {
  try {
    const { q, currency, category, supplier_id } = req.query;

    const filter = {
      isActive: true, // 🔥 MUHIM
    };

    if (supplier_id && mongoose.isValidObjectId(supplier_id)) {
      filter.supplier_id = supplier_id;
    }

    if (currency && ["UZS", "USD"].includes(currency)) {
      filter.warehouse_currency = currency;
    }

    if (category && String(category).trim()) {
      filter.category = String(category).trim();
    }

    if (q && String(q).trim()) {
      const r = new RegExp(escapeRegex(q.trim()), "i");
      filter.$or = [{ name: r }, { model: r }, { color: r }, { category: r }];
    }

    const items = await Product.find(filter)
      .populate("supplier_id", "name phone")
      .sort({ createdAt: -1 })
      .lean();

    const mapped = items.map((p) => ({
      ...p,
      images: withImageUrl(req, p.images),
    }));

    return res.json({
      ok: true,
      total: mapped.length,
      items: mapped,
    });
  } catch (error) {
    console.error("getProducts error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
    });
  }
};


/* =======================
   GET PRODUCT BY ID
======================= */
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate("supplier_id", "name phone")
      .lean();

    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

    product.images = withImageUrl(req, product.images);

    return res.json({
      ok: true,
      product,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/* =======================
   UPDATE PRODUCT
======================= */
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

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
      min_qty,
      description,
    } = req.body || {};

    // 🔹 STRING FIELDS
    if (supplier_id) product.supplier_id = supplier_id;
    if (name !== undefined) product.name = String(name).trim();
    if (model !== undefined) product.model = String(model).trim();
    if (color !== undefined) product.color = String(color).trim();
    if (category !== undefined) product.category = String(category).trim();
    if (description !== undefined)
      product.description = String(description).trim();

    // 🔹 ENUM / IMPORTANT
    if (unit) product.unit = unit;
    if (warehouse_currency) product.warehouse_currency = warehouse_currency;

    // 🔹 NUMBER FIELDS
    if (qty !== undefined) product.qty = Number(qty) || 0;
    if (buy_price !== undefined) product.buy_price = Number(buy_price) || 0;
    if (sell_price !== undefined) product.sell_price = Number(sell_price) || 0;
    if (min_qty !== undefined) product.min_qty = Number(min_qty) || 0;

    // 🔹 IMAGE (AGAR KELSA – QO‘SHADI)
    if (req.file) {
      product.images = product.images || [];
      product.images.push(`/uploads/products/${req.file.filename}`);
    }

    await product.save();

    return res.json({
      ok: true,
      message: "Mahsulot yangilandi",
      product,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};


/* =======================
   DELETE PRODUCT
======================= */
exports.deleteProduct = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ ok: false });

  product.isActive = false;
  await product.save();

  return res.json({
    ok: true,
    message: "Mahsulot o‘chirildi (arxivlandi)",
  });
};

