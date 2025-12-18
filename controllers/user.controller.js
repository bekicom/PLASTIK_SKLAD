const bcrypt = require("bcrypt");
const User = require("../modules/Users/User"); // sening project yo'ling shu edi

const ALLOWED_ROLES = ["ADMIN", "CASHIER", "AGENT"];

/**
 * POST /api/users
 * Admin creates user (kassir/agent/admin)
 */
exports.createUser = async (req, res) => {
  try {
    const { name, phone, login, password, role } = req.body;

    if (!name || !phone || !login || !password) {
      return res.status(400).json({
        ok: false,
        message: "name, phone, login, password majburiy",
      });
    }

    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        ok: false,
        message: "role noto‘g‘ri (ADMIN/CASHIER/AGENT)",
      });
    }

    const exists = await User.findOne({ $or: [{ phone }, { login }] });
    if (exists) {
      return res.status(409).json({
        ok: false,
        message: "Telefon yoki login band",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      phone,
      login,
      password: hashedPassword,
      role: role || "AGENT",
    });

    return res.status(201).json({
      ok: true,
      message: "User yaratildi",
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        login: user.login,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
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

/**
 * GET /api/users
 * Query: q, page, limit, role
 */
exports.getUsers = async (req, res) => {
  try {
    const { q, role } = req.query;

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "20", 10), 1),
      100
    );
    const skip = (page - 1) * limit;

    const filter = {};

    if (role) {
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          ok: false,
          message: "role noto‘g‘ri (ADMIN/CASHIER/AGENT)",
        });
      }
      filter.role = role;
    }

    if (q && q.trim()) {
      const r = new RegExp(q.trim(), "i");
      filter.$or = [{ name: r }, { phone: r }, { login: r }];
    }

    const [items, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
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
 * GET /api/users/:id
 */
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select("-password");
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User topilmadi",
      });
    }

    return res.json({
      ok: true,
      user,
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
 * PUT /api/users/:id
 * Update fields: name, phone, login, password, role
 */
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, login, password, role } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User topilmadi",
      });
    }

    if (role !== undefined) {
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          ok: false,
          message: "role noto‘g‘ri (ADMIN/CASHIER/AGENT)",
        });
      }
      user.role = role;
    }

    // phone unique check
    if (phone !== undefined && phone !== user.phone) {
      const phoneExists = await User.findOne({ phone, _id: { $ne: id } });
      if (phoneExists) {
        return res.status(409).json({ ok: false, message: "Telefon band" });
      }
      user.phone = phone;
    }

    // login unique check
    if (login !== undefined && login !== user.login) {
      const loginExists = await User.findOne({ login, _id: { $ne: id } });
      if (loginExists) {
        return res.status(409).json({ ok: false, message: "Login band" });
      }
      user.login = login;
    }

    if (name !== undefined) user.name = name;

    if (password !== undefined) {
      if (!password || password.length < 4) {
        return res.status(400).json({
          ok: false,
          message: "Password kamida 4 ta belgi bo‘lsin",
        });
      }
      user.password = await bcrypt.hash(password, 10);
    }

    await user.save();

    return res.json({
      ok: true,
      message: "User yangilandi",
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        login: user.login,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
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

/**
 * DELETE /api/users/:id
 */
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndDelete(id).select("-password");
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User topilmadi",
      });
    }

    return res.json({
      ok: true,
      message: "User o‘chirildi",
      user,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
