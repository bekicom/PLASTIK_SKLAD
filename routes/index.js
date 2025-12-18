const express = require("express");
const router = express.Router();

// Controllers
const authController = require("../controllers/auth.controller");
const userController = require("../controllers/user.controller");
const wConler = require("../controllers/warehouse.controller");
const suler = require("../controllers/supplier.controller");
const prller = require("../controllers/product.controller");

const purchaseController = require("../controllers/purchase.controller");
const warehouseController = require("../controllers/warehouse.controller");


// Middlewares
const { rAuth, rRole } = require("../middlewares/auth.middleware");

/**
 * AUTH
 */
router.post("/auth/register", authController.register);
router.post("/auth/login", authController.login);

/**
 * USERS (ADMIN only)
 */
router.post("/users/create", rAuth, rRole("ADMIN"), userController.createUser);
router.get("/users", rAuth, rRole("ADMIN"), userController.getUsers);
router.get("/users/:id", rAuth, rRole("ADMIN"), userController.getUserById);
router.put("/users/:id", rAuth, rRole("ADMIN"), userController.updateUser);
router.delete("/users/:id", rAuth, rRole("ADMIN"), userController.deleteUser);

/**
 * WAREHOUSES (ADMIN only)
 */
router.post(
  "/warehouses/create",
  rAuth,
  rRole("ADMIN"),
  wConler.createWarehouse
);
router.get("/warehouses", rAuth, rRole("ADMIN"), wConler.getWarehouses);
router.get("/warehouses/:id", rAuth, rRole("ADMIN"), wConler.getWarehouseById);
router.put("/warehouses/:id", rAuth, rRole("ADMIN"), wConler.updateWarehouse);
router.delete(
  "/warehouses/:id",
  rAuth,
  rRole("ADMIN"),
  wConler.deleteWarehouse
);
router.get(
  "/suppliers/dashboard",
  rAuth,
  rRole("ADMIN"),
  suler.getSuppliersDashboard
);

router.get(
  "/suppliers/:id/detail",
  rAuth,
  rRole("ADMIN"),
  suler.getSupplierDetail
);
// 🔴 KEYIN CRUD
router.post("/suppliers/create", rAuth, rRole("ADMIN"), suler.createSupplier);
router.get("/suppliers", rAuth, rRole("ADMIN"), suler.getSuppliers);
router.get("/suppliers/:id", rAuth, rRole("ADMIN"), suler.getSupplierById);
router.put("/suppliers/:id", rAuth, rRole("ADMIN"), suler.updateSupplier);
router.delete("/suppliers/:id", rAuth, rRole("ADMIN"), suler.deleteSupplier);
router.post("/suppliers/:id/pay", rAuth, rRole("ADMIN"), suler.paySupplierDebt);
/**
 * PRODUCTS (ADMIN only)
 */
router.post("/products/create", rAuth, rRole("ADMIN"), prller.createProduct);
router.get("/products", rAuth, rRole("ADMIN"), prller.getProducts);
router.get("/products/:id", rAuth, rRole("ADMIN"), prller.getProductById);
router.put("/products/:id", rAuth, rRole("ADMIN"), prller.updateProduct);
router.delete("/products/:id", rAuth, rRole("ADMIN"), prller.deleteProduct);
/**
 * PURCHASES (KIRIM) (ADMIN only)
 */
router.post(
  "/purchases/create",
  rAuth,
  rRole("ADMIN"),
  purchaseController.createPurchase
);

/**
 * WAREHOUSES (ADMIN only)
 */
router.post("/warehouses/create", rAuth, rRole("ADMIN"), warehouseController.createWarehouse);
router.get("/warehouses", rAuth, rRole("ADMIN"), warehouseController.getWarehouses);
router.get("/warehouses/:id", rAuth, rRole("ADMIN"), warehouseController.getWarehouseById);
router.put("/warehouses/:id", rAuth, rRole("ADMIN"), warehouseController.updateWarehouse);
router.delete("/warehouses/:id", rAuth, rRole("ADMIN"), warehouseController.deleteWarehouse);



module.exports = router;
