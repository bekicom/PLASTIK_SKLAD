const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        message: "Token kerak",
      });
    }

    const token = header.slice(7).trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "APP_CUSTOMER") {
      return res.status(403).json({
        ok: false,
        message: "Faqat mobile mijozlar uchun",
      });
    }

    // 🔥 MUHIM: _id bilan set qilamiz
    req.appCustomer = {
      _id: decoded.id || decoded._id,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      message: "Token noto‘g‘ri yoki eskirgan",
    });
  }
};
