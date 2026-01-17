const express = require("express");
const router = express.Router();

// =========================
// MIDDLEWARES
// =========================
const { rAuth, rRole } = require("../middlewares/auth.middleware");
const appAuth = require("../middlewares/appAuth.middleware");

// =========================
// CONTROLLERS
// =========================
const appCustomerController = require("../controllers/appCustomerAPP/appCustomer.controller");
const appProductController = require("../controllers/appCustomerAPP/appProduct.controller");
const appOrderController = require("../controllers/appCustomerAPP/appOrder.controller");

/**
 * =================================
 * APP CUSTOMERS (MOBILE APP)
 * =================================
 */

// 🔓 REGISTER (PUBLIC)
router.post("/app-customers/register", appCustomerController.register);

// 🔓 LOGIN (PUBLIC)
router.post("/app-customers/login", appCustomerController.login);

// =========================
// ADMIN → APP CUSTOMERS
// =========================

// 🔐 GET ALL
router.get(
  "/app-customers",
  rAuth,
  rRole("ADMIN"),
  appCustomerController.getAll
);

// 🔐 GET ONE
router.get(
  "/app-customers/:id",
  rAuth,
  rRole("ADMIN"),
  appCustomerController.getOne
);

// 🔐 UPDATE
router.put(
  "/app-customers/:id",
  rAuth,
  rRole("ADMIN"),
  appCustomerController.update
);

// 🔐 DELETE
router.delete(
  "/app-customers/:id",
  rAuth,
  rRole("ADMIN"),
  appCustomerController.remove
);

// 🔐 ACTIVATE
router.patch(
  "/app-customers/:id/activate",
  rAuth,
  rRole("ADMIN"),
  appCustomerController.adminActivate
);

/**
 * =========================
 * APP PRODUCTS (MOBILE)
 * =========================
 */

// 🔐 ONLY APP CUSTOMER
router.get("/productss", appAuth, appProductController.getProductsForApp);
router.post("/orders", appAuth, appOrderController.createOrder);

module.exports = router;
