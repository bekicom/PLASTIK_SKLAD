const jwt = require("jsonwebtoken");
const Customer = require("../modules/Customer/Customer");

module.exports.rMobileAuth = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        message: "Token topilmadi",
      });
    }

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "MOBILE") {
      return res.status(403).json({
        ok: false,
        message: "Ruxsat yo‘q",
      });
    }

    const customer = await Customer.findById(decoded.id).lean();
    if (!customer || !customer.isActive) {
      return res.status(403).json({
        ok: false,
        message: "Customer aktiv emas",
      });
    }

    req.mobileCustomer = customer;
    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      message: "Token yaroqsiz",
      error: err.message,
    });
  }
};
