const jwt = require("jsonwebtoken");

exports.rAuth = (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        message: "Token kerak (Authorization: Bearer ...)",
      });
    }

    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // token ichidan user ma'lumotini requestga biriktiramiz
    req.user = decoded; // { id, login, role, iat, exp }
    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: "Token noto‘g‘ri yoki eskirgan",
      error: error.message,
    });
  }
};

exports.rRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user?.role) {
      return res.status(403).json({
        ok: false,
        message: "Role topilmadi (token yangilang)",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        message: "Sizda ruxsat yo‘q",
      });
    }

    next();
  };
};
