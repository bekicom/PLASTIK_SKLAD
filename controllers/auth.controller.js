const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../modules/Users/User");

/**
 * POST /api/auth/register
 * (default role: AGENT)
 * Agar xohlasang role ham yuborishing mumkin: ADMIN/CASHIER/AGENT
 */
exports.register = async (req, res) => {
  try {
    const { name, phone, login, password, role } = req.body;

    if (!name || !phone || !login || !password) {
      return res.status(400).json({
        ok: false,
        message: "Barcha maydonlar majburiy",
      });
    }

    const exists = await User.findOne({
      $or: [{ phone }, { login }],
    });

    if (exists) {
      return res.status(409).json({
        ok: false,
        message: "Telefon yoki login band",
      });
    }

    // role validatsiya (ixtiyoriy)
    const allowedRoles = ["ADMIN", "CASHIER", "AGENT"];
    const finalRole = role && allowedRoles.includes(role) ? role : undefined;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      phone,
      login,
      password: hashedPassword,
      ...(finalRole ? { role: finalRole } : {}), // role berilmasa model default ishlaydi
    });

    return res.status(201).json({
      ok: true,
      message: "Ro‘yxatdan o‘tildi",
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        login: user.login,
        role: user.role,
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
 * POST /api/auth/login
 */
exports.login = async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({
        ok: false,
        message: "Login va parol majburiy",
      });
    }

    const user = await User.findOne({ login });
    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Login yoki parol noto‘g‘ri",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        ok: false,
        message: "Login yoki parol noto‘g‘ri",
      });
    }

    // ✅ token ichiga role qo‘shildi
    const token = jwt.sign(
      {
        id: user._id,
        login: user.login,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        login: user.login,
        role: user.role,
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
