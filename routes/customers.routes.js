const router = require("express").Router();
const mobileAuthController = require("../controllers/mobile/mobileAuth.controller");
const { rAuth, rRole } = require("../middlewares/auth.middleware");
const { rMobileAuth } = require("../middlewares/mobileAuth.middleware");
// 👆 agar alohida mobile token middleware bo‘lsa

/* =========================
   📱 MOBILE (PUBLIC)
========================= */

// REGISTER
router.post("/app-customers/register", rMobileAuth, mobileAuthController.mobileRegister);

// LOGIN
router.post("/app-customers/login", mobileAuthController.login);

/* =========================
   📱 MOBILE (AUTH)
========================= */

// PROFILE EDIT (name, phone, address)
// 🔧 ADMIN / CASHIER → EDIT CUSTOMER BY ID
router.put(
  "/customers/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  rMobileAuth,
  mobileAuthController.updateCustomerById
);


/* =========================
   🔐 ADMIN
========================= */

// ACTIVATE MOBILE CUSTOMER
router.post(
  "/customers/:id/activate",
  rAuth,
  rRole("ADMIN"),
  mobileAuthController.activateMobileCustomer,
);

// 🗑️ ADMIN → DELETE (SOFT)
router.delete(
  "/customers/:id",
  rAuth,
  rRole("ADMIN"),
  mobileAuthController.deleteCustomerById
);

module.exports = router;
