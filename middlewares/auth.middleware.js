const jwt = require("jsonwebtoken");

/**
 * rAuth
 * - Authorization: Bearer <token> tekshiradi
 * - tokenni verify qiladi
 * - req.user va req.userId ni set qiladi
 */
exports.rAuth = (req, res, next) => {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        message: "Token kerak (Authorization: Bearer ...)",
      });
    }

    const token = header.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        ok: false,
        message: "Token bo‘sh (Authorization: Bearer ...)",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // decoded odatda: { id, login, role, iat, exp }
    const userId = decoded?.id || decoded?._id || decoded?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Token ichida user id topilmadi (token noto‘g‘ri)",
      });
    }

    // ✅ hamma controllerlar uchun qulay format
    req.user = {
      ...decoded,
      _id: userId, // ✅ controllerlar req.user._id bilan ishlayversin
    };

    req.userId = userId; // ✅ fallback (ba’zi joylarda kerak bo‘ladi)

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: "Token noto‘g‘ri yoki eskirgan",
      error: error.message,
    });
  }
};

/**
 * rRole
 * - req.user.role bo‘yicha tekshiradi
 */
exports.rRole = (...roles) => {
  return (req, res, next) => {
    const role = req.user?.role;

    if (!role) {
      return res.status(403).json({
        ok: false,
        message: "Role topilmadi (token yangilang)",
      });
    }

    if (!roles.includes(role)) {
      return res.status(403).json({
        ok: false,
        message: "Sizda ruxsat yo‘q",
      });
    }

    next();
  };
};
