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
const customerController = require("../controllers/customer.controller"); // ✅ NEW
const agentOrderController = require("../controllers/agentOrder.controller");
const cashierOrderController = require("../controllers/cashierOrder.controller");
const returnController = require("../controllers/return.controller");
const expenseController = require("../controllers/expense.controller");
const analyticsRoutes = require("../modules/analytics/analytics.routes");
const uploadProductImages = require("../middlewares/uploadProductImage");

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
  uploadProductImages.array("images", 5),
  productController.createProduct
);

// productlarni get qilish
router.get(
  "/products",
  rAuth,
  rRole("ADMIN", "CASHIER", "AGENT"),
  productController.getProducts
);

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
router.put(
  "/products/:id/image",
  rAuth,
  rRole("ADMIN"),
  uploadProductImages.single("image"),
  productController.replaceProductImage
);

/**
 * PURCHASES (KIRIM) (ADMIN only)
 */

// purchase (kirim) yaratish
// purchase (kirim) yaratish
router.post(
  "/purchases/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  uploadProductImages.any(), // 🔥 HAMMA FILE FIELD QABUL QILINADI
  purchaseController.createPurchase
);
router.post(
  "/products/:id/image",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  uploadProductImages.single("image"),
  purchaseController.addProductImage
);



/**
 * CUSTOMERS (HOZMAKLAR)
 */

// customer yaratish
router.post(
  "/customers/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.createCustomer
);

// customerlarni get qilish
router.get(
  "/customers",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  customerController.getCustomers
);

// bitta customer detail + summary
router.get(
  "/customers/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.getCustomerById
);

// customer update qilish
router.put(
  "/customers/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.updateCustomer
);

// customer delete qilish (soft delete) (ADMIN only)
router.delete(
  "/customers/:id",
  rAuth,
  rRole("ADMIN"),
  customerController.deleteCustomer
);

// customer sales history
router.get(
  "/customers/:id/sales",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  customerController.getCustomerSales
);

// customer statement (kunma-kun hisobot)
router.get(
  "/customers/:id/statement",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.getCustomerStatement
);
// customer summary (to‘liq tarix)
router.get(
  "/customers/:id/summary",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.getCustomerSummary
);
router.post(
  "/customers/:id/pay",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.payCustomerDebt
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
// router.get(
//   "/sales/:id",
//   rAuth,
//   rRole("ADMIN", "CASHIER"),
//   salesController.getSaleById
// );

// saleni cancel qilish
router.post(
  "/sales/:id/cancel",
  rAuth,
  rRole("ADMIN"),
  salesController.cancelSale
);

/**
 * AGENT ORDERS (ZAKAS)
 * Agent faqat zakas yaratadi
 */
router.post(
  "/agent/orders",
  rAuth,
  rRole("AGENT"),
  agentOrderController.createAgentOrder
);

router.get(
  "/agents/summary",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  agentOrderController.getAgentsSummary
);

router.get(
  "/agents/:id/orders",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  agentOrderController.getAgentOrders
);

router.get(
  "/agents/:id/customers",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  agentOrderController.getAgentCustomersStats
);

/**
 * CASHIER ORDERS (AGENT ZAKAS QABUL QILISH)
 */

// NEW zakaslar ro‘yxati
router.get(
  "/orders/new",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.getNewOrders
);

// zakasni tasdiqlash (ombordan qty kamayadi)
router.post(
  "/orders/:id/confirm",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.confirmOrder
);

// zakasni bekor qilish
router.post(
  "/orders/:id/cancel",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.cancelOrder
);

router.get(
  "/sales/search-by-product",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.searchSalesByProduct
);

router.get(
  "/sales/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.getSaleById
);

router.post(
  "/returns/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  returnController.createReturn
);

// CREATE
router.post("/expenses", rAuth, expenseController.createExpense);

// READ (LIST)
router.get("/expenses", rAuth, expenseController.getExpenses);

// READ (ONE)
router.get("/expenses/:id", rAuth, expenseController.getExpenseById);

// UPDATE
router.put("/expenses/:id", rAuth, expenseController.updateExpense);

// DELETE
router.delete("/expenses/:id", rAuth, expenseController.deleteExpense);
router.use("/analytics", rAuth, rRole("ADMIN", "CASHIER"), analyticsRoutes);

module.exports = router;
