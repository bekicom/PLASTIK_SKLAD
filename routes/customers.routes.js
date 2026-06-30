const router = require("express").Router();
const mobileAuthController = require("../controllers/mobile/mobileAuth.controller");
const mobileOrderController = require("../controllers/mobile/mobileOrder.controller");
const { rAuth, rRole } = require("../middlewares/auth.middleware");
const { rMobileAuth } = require("../middlewares/mobileAuth.middleware");

/* =========================
   📱 MOBILE (PUBLIC)
========================= */

// ✅ REGISTER
router.post("/register", mobileAuthController.mobileRegister);

// ✅ LOGIN
router.post("/login", mobileAuthController.login);

/* =========================
   📱 MOBILE (AUTH)
========================= */

// 📦 MOBILE → PRODUCTS
router.post("/orders", rMobileAuth, mobileOrderController.createMobileOrder);
router.get("/products", rMobileAuth, mobileAuthController.getMobileProducts);

// 📦 MOBILE → CREATE ORDER (ZAKAS)

/* =========================
   🔐 ADMIN
========================= */

// ACTIVATE MOBILE CUSTOMER
router.route("/:id/activate").get(rAuth, rRole("ADMIN"), mobileAuthController.activateMobileCustomer).post(rAuth, rRole("ADMIN"), mobileAuthController.activateMobileCustomer);
router.route("/customers/:id/activate").get(rAuth, rRole("ADMIN"), mobileAuthController.activateMobileCustomer).post(rAuth, rRole("ADMIN"), mobileAuthController.activateMobileCustomer);

// 🗑️ ADMIN → DELETE (SOFT)
router.delete(
  "/customers/:id",
  rAuth,
  rRole("ADMIN"),
  mobileAuthController.deleteCustomerById,
);

module.exports = router;
