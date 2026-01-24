const Customer = require("../../modules/Customer/Customer");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const Product = require("../../modules/products/Product");


/* =========================
   📱 MOBILE REGISTER
========================= */
exports.mobileRegister = async (req, res) => {
  try {
    const { name, phone, address } = req.body || {};

    /* =========================
       VALIDATION
    ========================= */
    if (!name || !phone) {
      return res.status(400).json({
        ok: false,
        message: "Ism va telefon majburiy",
      });
    }

    const cleanPhone = String(phone).trim();

    /* =========================
       PHONE UNIQUE CHECK
    ========================= */
    const exists = await Customer.findOne({
      phone: cleanPhone,
    }).lean();

    if (exists) {
      return res.status(409).json({
        ok: false,
        message: "Bu telefon raqam bilan mijoz allaqachon mavjud",
      });
    }

    /* =========================
       CREATE MOBILE CUSTOMER
    ========================= */
    const customer = await Customer.create({
      name: String(name).trim(),
      phone: cleanPhone,
      address: address?.trim() || "",

      role: "MOBILE",
      status: "PENDING", // 🔒 admin tasdiqlaydi
      registered_from: "MOBILE",

      // balanslar
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

    if (!phone) {
      return res.status(400).json({
        ok: false,
        message: "Telefon raqam majburiy",
      });
    }

    const customer = await Customer.findOne({
      phone: String(phone).trim(),
      role: "MOBILE",
    }).lean();

    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Mobile mijoz topilmadi",
      });
    }

    if (customer.status !== "ACTIVE") {
      return res.status(403).json({
        ok: false,
        message: "Account hali ACTIVE emas",
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

exports.mobileRegister = async (req, res) => {
  try {
    const { name, phone, address } = req.body || {};

    if (!name || !phone) {
      return res.status(400).json({
        ok: false,
        message: "Ism va telefon majburiy",
      });
    }

    /* =========================
       PHONE UNIQUE CHECK
    ========================= */
    const exists = await Customer.findOne({
      phone: String(phone).trim(),
    }).lean();

    if (exists) {
      return res.status(409).json({
        ok: false,
        message: "Bu telefon raqam bilan mijoz allaqachon mavjud",
      });
    }

    /* =========================
       CREATE MOBILE CUSTOMER
    ========================= */
    const customer = await Customer.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      address: address?.trim() || "",

      role: "MOBILE",
      status: "PENDING",
      registered_from: "MOBILE",

      // 🔒 default
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

    const { name, phone, address } = req.body || {};
    const update = {};

    if (name && String(name).trim()) {
      update.name = String(name).trim();
    }

    if (address !== undefined) {
      update.address = String(address).trim();
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

    if (!mobileCustomer) {
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
       PAGINATION
    ========================= */
    const pageNum = Math.max(Number(page), 1);
    const limitNum = Math.min(Math.max(Number(limit), 1), 50);
    const skip = (pageNum - 1) * limitNum;

    /* =========================
       QUERY
    ========================= */
    const [items, total] = await Promise.all([
      Product.find(filter)
        .select(
          "_id name model sell_price qty unit category images"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Product.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      page: pageNum,
      limit: limitNum,
      total,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Mobile productlarni olishda xatolik",
      error: error.message,
    });
  }
};

// 🔥 ALIAS — router createCustomer deb chaqiryapti
exports.createCustomer = exports.mobileRegister;
