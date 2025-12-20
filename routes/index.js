const express = require("express");
const router = express.Router();



// Controllers
const authController = require("../controllers/auth.controller");
const userController = require("../controllers/user.controller");
const warehouseController = require("../controllers/warehouse.controller");
const supplierController = require("../controllers/supplier.controller");
const productController = require("../controllers/product.controller");
const purchaseController = require("../controllers/purchase.controller");
const salesController = require("../controllers/sales.controller");


// Middlewares
const { rAuth, rRole } = require("../middlewares/auth.middleware");

/**
 * AUTH
 */

// register
router.post("/auth/register", authController.register);

// login
router.post("/auth/login", authController.login);

/**
 * USERS (ADMIN only)
 */

// user yaratish
router.post("/users/create", rAuth, rRole("ADMIN"), userController.createUser);

// userlarni get qilish
router.get("/users", rAuth, rRole("ADMIN"), userController.getUsers);

// bitta userni get qilish
router.get("/users/:id", rAuth, rRole("ADMIN"), userController.getUserById);

// userni update qilish
router.put("/users/:id", rAuth, rRole("ADMIN"), userController.updateUser);

// userni delete qilish
router.delete("/users/:id", rAuth, rRole("ADMIN"), userController.deleteUser);

/**
 * WAREHOUSES (ADMIN only)
 */

// warehouse yaratish
router.post(
  "/warehouses/create",
  rAuth,
  rRole("ADMIN"),
  warehouseController.createWarehouse
);

// warehouselarni get qilish
router.get(
  "/warehouses",
  rAuth,
  rRole("ADMIN"),
  warehouseController.getWarehouses
);

// bitta warehouseni get qilish
router.get(
  "/warehouses/:id",
  rAuth,
  rRole("ADMIN"),
  warehouseController.getWarehouseById
);

// warehouseni update qilish
router.put(
  "/warehouses/:id",
  rAuth,
  rRole("ADMIN"),
  warehouseController.updateWarehouse
);

// warehouseni delete qilish
router.delete(
  "/warehouses/:id",
  rAuth,
  rRole("ADMIN"),
  warehouseController.deleteWarehouse
);

/**
 * SUPPLIERS (ADMIN only)
 * ⚠️ dashboard/detail doim /:id dan oldin
 */

// suppliers dashboardni get qilish
router.get(
  "/suppliers/dashboard",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSuppliersDashboard
);

// supplier detailni get qilish
router.get(
  "/suppliers/:id/detail",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSupplierDetail
);

// supplier yaratish
router.post(
  "/suppliers/create",
  rAuth,
  rRole("ADMIN"),
  supplierController.createSupplier
);

// supplierlarni get qilish
router.get(
  "/suppliers",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSuppliers
);

// bitta supplierni get qilish
router.get(
  "/suppliers/:id",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSupplierById
);

// supplierni update qilish
router.put(
  "/suppliers/:id",
  rAuth,
  rRole("ADMIN"),
  supplierController.updateSupplier
);

// supplierni delete qilish
router.delete(
  "/suppliers/:id",
  rAuth,
  rRole("ADMIN"),
  supplierController.deleteSupplier
);

// supplier qarzidan to'lov qilish
router.post(
  "/suppliers/:id/pay",
  rAuth,
  rRole("ADMIN"),
  supplierController.paySupplierDebt
);

/**
 * PRODUCTS (ADMIN only)
 */

// product yaratish
router.post(
  "/products/create",
  rAuth,
  rRole("ADMIN"),
  productController.createProduct
);

// productlarni get qilish
router.get("/products", rAuth, rRole("ADMIN"), productController.getProducts);

// bitta productni get qilish
router.get(
  "/products/:id",
  rAuth,
  rRole("ADMIN"),
  productController.getProductById
);

// productni update qilish
router.put(
  "/products/:id",
  rAuth,
  rRole("ADMIN"),
  productController.updateProduct
);

// productni delete qilish
router.delete(
  "/products/:id",
  rAuth,
  rRole("ADMIN"),
  productController.deleteProduct
);

/**
 * PURCHASES (KIRIM) (ADMIN only)
 */

// purchase (kirim) yaratish
router.post(
  "/purchases/create",
  rAuth,
  rRole("ADMIN"),
  purchaseController.createPurchase
);

/**        
 * SALES (SOTUV)
 */

// sale (sotuv) yaratish
router.post(
  "/sales/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.createSale
);

// salelarni get qilish
router.get(
  "/sales",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.getSales
);

// bitta saleni get qilish
router.get(
  "/sales/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.getSaleById
);

// saleni cancel qilish
router.post(
  "/sales/:id/cancel",
  rAuth,
  rRole("ADMIN"),
  salesController.cancelSale
);

module.exports = router;
