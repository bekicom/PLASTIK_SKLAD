const Customer = require("../../modules/Customer/Customer");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const Product = require("../../modules/products/Product");
const { normalizePhone } = require("../../utils/phone");


/* =========================
   📱 MOBILE REGISTER
========================= */
exports.mobileRegister = async (req, res) => {
  try {
    const { name, phone, address, region, district, login, password } = req.body || {};
    const cleanPhone = normalizePhone(phone);
    const cleanLogin = String(login || "").trim().toLowerCase();
    const rawPassword = String(password || "");

    if (!name || !cleanPhone) {
      return res.status(400).json({
        ok: false,
        message: "Ism va telefon majburiy",
      });
    }

    const [existsPhone, existsLogin] = await Promise.all([
      Customer.findOne({ phone: cleanPhone }).lean(),
      cleanLogin ? Customer.findOne({ login: cleanLogin }).lean() : null,
    ]);
    if (existsPhone) {
      return res.status(409).json({
        ok: false,
        message: "Bu telefon raqam bilan mijoz allaqachon mavjud",
      });
    }
    if (existsLogin) {
      return res.status(409).json({
        ok: false,
        message: "Bu login band",
      });
    }

    const customer = await Customer.create({
      name: String(name).trim(),
      phone: cleanPhone,
      login: cleanLogin || undefined,
      password:
        cleanLogin && rawPassword.length >= 4
          ? await bcrypt.hash(rawPassword, 10)
          : undefined,
      address: address?.trim() || "",
      region: String(region || "").trim(),
      district: String(district || "").trim(),

      role: "MOBILE",
      status: "PENDING",
      registered_from: "MOBILE",

      balance: { UZS: 0, USD: 0 },
      opening_balance: { UZS: 0, USD: 0 },
      payment_history: [],

      isActive: true,
    });

    return res.status(201).json({
      ok: true,
      message: "Ro‘yxatdan o‘tildi. Admin tasdiqlashini kuting",
      customer_id: customer._id,
      status: customer.status,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Ro‘yxatdan o‘tishda xatolik",
      error: error.message,
    });
  }
};

/* =========================
   📱 MOBILE LOGIN
========================= */
exports.login = async (req, res) => {
  try {
    const { phone } = req.body || {};
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      return res.status(400).json({
        ok: false,
        message: "Telefon raqam majburiy",
      });
    }

    const customer = await Customer.findOne({ phone: cleanPhone }).lean();

    if (!customer) {
      return res.status(401).json({
        ok: false,
        message: "Bu telefon raqam bilan mijoz topilmadi",
      });
    }

    if (customer.status !== "ACTIVE" || !customer.isActive) {
      return res.status(403).json({
        ok: false,
        message: "Account ACTIVE emas",
        status: customer.status,
      });
    }

    // 🔐 JWT
    const token = jwt.sign(
      {
        id: customer._id,
        role: "MOBILE",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "30d",
      },
    );

    return res.json({
      ok: true,
      message: "Login muvaffaqiyatli",
      token,
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
        region: customer.region || "",
        district: customer.district || "",
        login: customer.login || null,
        role: customer.role,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Login qilishda xatolik",
      error: error.message,
    });
  }
};
exports.activateMobileCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "Customer ID noto‘g‘ri",
      });
    }

    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Customer topilmadi",
      });
    }

    if (customer.status === "ACTIVE") {
      return res.status(400).json({
        ok: false,
        message: "Customer allaqachon ACTIVE",
      });
    }

    // 🔥 faqat MOBILE bo‘lsa
    if (customer.role !== "MOBILE") {
      return res.status(400).json({
        ok: false,
        message: "Bu mobile customer emas",
      });
    }

    customer.status = "ACTIVE";
    customer.isActive = true;
    await customer.save();

    // 🔔 SOCKET (ixtiyoriy)
    if (req.io) {
      req.io.emit("mobile:activated", {
        customer_id: customer._id,
        name: customer.name,
      });
    }

    return res.json({
      ok: true,
      message: "Customer ACTIVE qilindi",
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
        region: customer.region || "",
        district: customer.district || "",
        status: customer.status,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Customer tasdiqlashda xatolik",
      error: error.message,
    });
  }
};

exports.updateCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "Customer ID noto‘g‘ri",
      });
    }

    const { name, phone, address, region, district } = req.body || {};
    const update = {};

    if (name && String(name).trim()) {
      update.name = String(name).trim();
    }

    if (address !== undefined) {
      update.address = String(address).trim();
    }

    if (region !== undefined) {
      update.region = String(region || "").trim();
    }

    if (district !== undefined) {
      update.district = String(district || "").trim();
    }

    if (phone && String(phone).trim()) {
      const newPhone = String(phone).trim();

      const exists = await Customer.findOne({
        phone: newPhone,
        _id: { $ne: id },
      }).lean();

      if (exists) {
        return res.status(409).json({
          ok: false,
          message: "Bu telefon raqam boshqa mijozda mavjud",
        });
      }

      update.phone = newPhone;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        ok: false,
        message: "O‘zgartirish uchun ma’lumot yo‘q",
      });
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true },
    ).lean();

    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Customer topilmadi",
      });
    }

    return res.json({
      ok: true,
      message: "Customer yangilandi",
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Customer edit qilishda xatolik",
      error: error.message,
    });
  }
};

exports.deleteCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "Customer ID noto‘g‘ri",
      });
    }

    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Customer topilmadi",
      });
    }

    // 🔥 Soft delete
    customer.isActive = false;
    customer.status = "BLOCKED"; // ixtiyoriy, lekin yaxshi
    await customer.save();

    return res.json({
      ok: true,
      message: "Customer o‘chirildi (BLOCK qilindi)",
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
        status: customer.status,
        isActive: customer.isActive,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Customer delete qilishda xatolik",
      error: error.message,
    });
  }
};


/* =========================
   📱 MOBILE → GET PRODUCTS
========================= */
exports.getMobileProducts = async (req, res) => {
  try {
    // rMobileAuth middleware qo‘yilgan bo‘lishi kerak
    const mobileCustomer = req.mobileCustomer;
    const mobileAccount = req.mobileAccount;

    if (!mobileCustomer && !mobileAccount) {
      return res.status(401).json({
        ok: false,
        message: "Mobile auth yo‘q",
      });
    }

    const {
      q,
      category,
      page = 1,
      limit = 20,
    } = req.query;

    /* =========================
       FILTER
    ========================= */
    const filter = {
      isActive: true,
      qty: { $gt: 0 }, // faqat omborda bor productlar
    };

    if (category) {
      filter.category = String(category).trim();
    }

    if (q) {
      const r = new RegExp(q.trim(), "i");
      filter.$or = [
        { name: r },
        { model: r },
        { category: r },
      ];
    }

    /* =========================
       QUERY
    ========================= */
    const [items, total] = await Promise.all([
      Product.find(filter)
        .select(
          "_id name model sell_price qty unit category images"
        )
        .sort({ createdAt: -1 })
        .lean(),

      Product.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      total,
      count: total,
      items,
      data: items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Mobile productlarni olishda xatolik",
      error: error.message,
    });
  }
};

exports.getMobileProductCategories = async (req, res) => {
  try {
    const mobileCustomer = req.mobileCustomer;
    const mobileAccount = req.mobileAccount;

    if (!mobileCustomer && !mobileAccount) {
      return res.status(401).json({
        ok: false,
        message: "Mobile auth yo‘q",
      });
    }

    const rows = await Product.find({
      isActive: true,
      qty: { $gt: 0 },
      marketplace_visible: { $ne: false },
    })
      .select("category warehouse_currency")
      .lean();

    const counts = new Map();
    for (const row of rows) {
      const key = String(row.category || "").trim() || "Boshqa";
      if (!counts.has(key)) {
        counts.set(key, {
          category: key,
          count: 0,
          currencies: new Set(),
        });
      }
      const bucket = counts.get(key);
      bucket.count += 1;
      bucket.currencies.add(String(row.warehouse_currency || "UZS").toUpperCase());
    }

    const items = [...counts.entries()]
      .map(([, bucket]) => {
        const currencies = [...bucket.currencies].filter(Boolean).sort();
        return {
          category: bucket.category,
          count: bucket.count,
          currency: currencies.length === 1 ? currencies[0] : "MIXED",
          currencies,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category));

    return res.json({
      ok: true,
      total: items.length,
      items,
      data: items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Kategoriyalarni olishda xatolik",
      error: error.message,
    });
  }
};

exports.getMobileProductFilters = async (req, res) => {
  try {
    const mobileCustomer = req.mobileCustomer;
    const mobileAccount = req.mobileAccount;

    if (!mobileCustomer && !mobileAccount) {
      return res.status(401).json({
        ok: false,
        message: "Mobile auth yo‘q",
      });
    }

    const rows = await Product.find({
      isActive: true,
      qty: { $gt: 0 },
      marketplace_visible: { $ne: false },
    })
      .select("category unit warehouse_currency sell_price marketplace_recommended marketplace_new marketplace_top marketplace_promo")
      .lean();

    const categories = new Map();
    const units = new Map();
    const currencies = new Map();
    let minPrice = null;
    let maxPrice = null;

    for (const row of rows) {
      const category = String(row.category || "").trim() || "Boshqa";
      const unit = String(row.unit || "").trim() || "DONA";
      const currency = String(row.warehouse_currency || "UZS").toUpperCase();
      const price = Number(row.sell_price || 0);

      categories.set(category, (categories.get(category) || 0) + 1);
      units.set(unit, (units.get(unit) || 0) + 1);
      currencies.set(currency, (currencies.get(currency) || 0) + 1);

      if (Number.isFinite(price)) {
        minPrice = minPrice === null ? price : Math.min(minPrice, price);
        maxPrice = maxPrice === null ? price : Math.max(maxPrice, price);
      }
    }

    const filters = {
      categories: [...categories.entries()].map(([value, count]) => ({ value, count })),
      units: [...units.entries()].map(([value, count]) => ({ value, count })),
      currencies: [...currencies.entries()].map(([value, count]) => ({ value, count })),
      price_range: {
        min: minPrice === null ? 0 : minPrice,
        max: maxPrice === null ? 0 : maxPrice,
      },
      flags: {
        recommended: rows.filter((row) => row.marketplace_recommended === true).length,
        new: rows.filter((row) => row.marketplace_new === true).length,
        top: rows.filter((row) => row.marketplace_top === true).length,
        promo: rows.filter((row) => row.marketplace_promo === true).length,
      },
    };

    return res.json({
      ok: true,
      filters,
      data: filters,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Filtrlarni olishda xatolik",
      error: error.message,
    });
  }
};

exports.getMobileProductSearchSuggestions = async (req, res) => {
  try {
    const mobileCustomer = req.mobileCustomer;
    const mobileAccount = req.mobileAccount;

    if (!mobileCustomer && !mobileAccount) {
      return res.status(401).json({
        ok: false,
        message: "Mobile auth yo‘q",
      });
    }

    const q = String(req.query.q || req.query.query || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);
    const filter = {
      isActive: true,
      qty: { $gt: 0 },
      marketplace_visible: { $ne: false },
    };

    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: re }, { model: re }, { category: re }, { code: re }];
    }

    const items = await Product.find(filter)
      .select("_id name model category unit sell_price images")
      .sort({ marketplace_sort_order: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    const suggestions = items.map((product) => ({
      label: product.name || product.model || product.category || "",
      value: product.name || product.model || product.category || "",
      product_id: product._id,
      image_url: Array.isArray(product.images) && product.images.length ? product.images[0] : "",
      category: product.category || "",
      unit: product.unit || "",
      price: Number(product.sell_price || 0),
    }));

    return res.json({
      ok: true,
      total: suggestions.length,
      items: suggestions,
      data: suggestions,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Qidiruv tavsiyalarini olishda xatolik",
      error: error.message,
    });
  }
};

/* =========================
   📱 MOBILE → GET PRODUCT BY ID
========================= */
exports.getMobileProductById = async (req, res) => {
  try {
    const mobileCustomer = req.mobileCustomer;
    const mobileAccount = req.mobileAccount;

    if (!mobileCustomer && !mobileAccount) {
      return res.status(401).json({
        ok: false,
        message: "Mobile auth yo‘q",
      });
    }

    const product = await Product.findById(req.params.id)
      .select("_id name code model color category images unit warehouse_currency qty marketplace_visible min_order_qty step_qty sell_price buy_price isActive marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo createdAt updatedAt")
      .lean();

    if (!product || product.isActive === false || product.marketplace_visible === false) {
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

    const availableStock = Number(product.qty || 0);
    const minOrderQty = Number(product.min_order_qty || 1);
    const stepQty = Number(product.step_qty || 1);

    return res.json({
      ok: true,
      product: {
        product_id: product._id,
        name: product.name || "",
        code: product.code || "",
        model: product.model || "",
        color: product.color || "",
        category: product.category || "",
        images: Array.isArray(product.images) ? product.images : [],
        image_url: Array.isArray(product.images) && product.images.length ? product.images[0] : "",
        price: Number(product.sell_price || 0),
        current_price: Number(product.sell_price || 0),
        currency: product.warehouse_currency || "UZS",
        unit: product.unit || "",
        available_stock: availableStock,
        min_order_qty: minOrderQty,
        step_qty: stepQty,
        marketplace_visible: product.marketplace_visible !== false,
        can_add_to_cart: availableStock >= minOrderQty,
        unavailable_reason: availableStock >= minOrderQty ? null : "OUT_OF_STOCK",
        marketplace_sort_order: Number(product.marketplace_sort_order || 0),
        marketplace_recommended: product.marketplace_recommended === true,
        marketplace_new: product.marketplace_new === true,
        marketplace_top: product.marketplace_top === true,
        marketplace_promo: product.marketplace_promo === true,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
      data: {
        product_id: product._id,
        name: product.name || "",
        images: Array.isArray(product.images) ? product.images : [],
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Mahsulotni olishda xatolik",
      error: error.message,
    });
  }
};

/* =========================
   📱 MOBILE → GET RELATED PRODUCTS
========================= */
exports.getMobileRelatedProducts = async (req, res) => {
  try {
    const mobileCustomer = req.mobileCustomer;
    const mobileAccount = req.mobileAccount;

    if (!mobileCustomer && !mobileAccount) {
      return res.status(401).json({
        ok: false,
        message: "Mobile auth yo‘q",
      });
    }

    const baseProduct = await Product.findById(req.params.id)
      .select("_id category name model color unit warehouse_currency isActive marketplace_visible")
      .lean();

    if (!baseProduct || baseProduct.isActive === false || baseProduct.marketplace_visible === false) {
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

    const relatedFilter = {
      _id: { $ne: baseProduct._id },
      isActive: true,
      marketplace_visible: { $ne: false },
      qty: { $gt: 0 },
    };

    if (baseProduct.category) {
      relatedFilter.category = String(baseProduct.category).trim();
    }

    const items = await Product.find(relatedFilter)
      .select("_id name code model color category images unit warehouse_currency qty marketplace_visible min_order_qty step_qty sell_price marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo")
      .sort({ marketplace_sort_order: 1, createdAt: -1 })
      .limit(12)
      .lean();

    const related = items.map((product) => {
      const availableStock = Number(product.qty || 0);
      const minOrderQty = Number(product.min_order_qty || 1);
      return {
        product_id: product._id,
        name: product.name || "",
        code: product.code || "",
        model: product.model || "",
        color: product.color || "",
        category: product.category || "",
        images: Array.isArray(product.images) ? product.images : [],
        image_url: Array.isArray(product.images) && product.images.length ? product.images[0] : "",
        price: Number(product.sell_price || 0),
        current_price: Number(product.sell_price || 0),
        currency: product.warehouse_currency || "UZS",
        unit: product.unit || "",
        available_stock: availableStock,
        min_order_qty: minOrderQty,
        step_qty: Number(product.step_qty || 1),
        marketplace_visible: product.marketplace_visible !== false,
        can_add_to_cart: availableStock >= minOrderQty,
        unavailable_reason: availableStock >= minOrderQty ? null : "OUT_OF_STOCK",
        marketplace_sort_order: Number(product.marketplace_sort_order || 0),
        marketplace_recommended: product.marketplace_recommended === true,
        marketplace_new: product.marketplace_new === true,
        marketplace_top: product.marketplace_top === true,
        marketplace_promo: product.marketplace_promo === true,
      };
    });

    return res.json({
      ok: true,
      count: related.length,
      items: related,
      data: related,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Tegishli mahsulotlarni olishda xatolik",
      error: error.message,
    });
  }
};

// 🔥 ALIAS — router createCustomer deb chaqiryapti
exports.createCustomer = exports.mobileRegister;
