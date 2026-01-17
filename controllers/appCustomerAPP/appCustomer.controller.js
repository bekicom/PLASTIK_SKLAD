const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AppCustomer = require("../../modules/appCustomerAPP/AppCustomer");

/* =========================
   HELPERS
========================= */
function normalizePhone(phone) {
  return String(phone || "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .trim();
}

function signToken(customer) {
  return jwt.sign(
    { id: customer._id, role: "APP_CUSTOMER" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

/* =========================
   CREATE / REGISTER
========================= */
exports.register = async (req, res) => {
  try {
    const { full_name, phone, address } = req.body;

    if (!full_name || !phone || !address) {
      return res
        .status(400)
        .json({ ok: false, message: "Barcha maydonlar majburiy" });
    }

    const normPhone = normalizePhone(phone);

    const exists = await AppCustomer.findOne({ phone: normPhone });
    if (exists) {
      return res
        .status(400)
        .json({ ok: false, message: "Bu telefon allaqachon mavjud" });
    }

    const customer = await AppCustomer.create({
      full_name,
      phone: normPhone,
      address,
      status: "PENDING",
    });

    res.status(201).json({
      ok: true,
      message: "Customer yaratildi (PENDING)",
      data: customer,
    });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};

/* =========================
   GET ALL (ADMIN)
========================= */
exports.getAll = async (req, res) => {
  try {
    const list = await AppCustomer.find().sort({ createdAt: -1 });

    res.json({
      ok: true,
      count: list.length,
      data: list,
    });
  } catch (err) {
    console.error("getAll error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};

/* =========================
   GET ONE
========================= */
exports.getOne = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto‘g‘ri" });
    }

    const customer = await AppCustomer.findById(id);
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    res.json({ ok: true, data: customer });
  } catch (err) {
    console.error("getOne error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};

/* =========================
   UPDATE / EDIT
========================= */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, phone, address, status, note } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto‘g‘ri" });
    }

    const customer = await AppCustomer.findById(id);
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    if (phone) customer.phone = normalizePhone(phone);
    if (full_name) customer.full_name = full_name;
    if (address) customer.address = address;
    if (status) customer.status = status;
    if (note !== undefined) customer.note = note;

    await customer.save();

    res.json({
      ok: true,
      message: "Customer yangilandi",
      data: customer,
    });
  } catch (err) {
    console.error("update error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};

/* =========================
   DELETE
========================= */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto‘g‘ri" });
    }

    const deleted = await AppCustomer.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    res.json({
      ok: true,
      message: "Customer o‘chirildi",
    });
  } catch (err) {
    console.error("delete error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};

/* =========================
   ADMIN ACTIVATE
========================= */
exports.adminActivate = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await AppCustomer.findById(id);
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    customer.status = "ACTIVE";
    await customer.save();

    res.json({
      ok: true,
      message: "Customer ACTIVE qilindi",
    });
  } catch (err) {
    console.error("activate error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};

/* =========================
   LOGIN (MOBILE)
========================= */
exports.login = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ ok: false, message: "Telefon majburiy" });
    }

    const customer = await AppCustomer.findOne({
      phone: normalizePhone(phone),
    });

    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    if (customer.status !== "ACTIVE") {
      return res.status(403).json({
        ok: false,
        message: "Customer aktiv emas",
      });
    }

    customer.last_login_at = new Date();
    await customer.save();

    const token = signToken(customer);

    res.json({
      ok: true,
      token,
      customer: {
        id: customer._id,
        full_name: customer.full_name,
        phone: customer.phone,
      },
    });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};
