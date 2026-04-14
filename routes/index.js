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
const moneyEntryController = require("../controllers/moneyEntry.controller");
const analyticsRoutes = require("../modules/analytics/analytics.routes");
const uploadProductImages = require("../middlewares/uploadProductImage");
const withdrawalController = require("../controllers/withdrawal.controller");
const cashInController = require("../controllers/cashIn.controller");
const reconciliationController = require("../controllers/reconciliation.controller");
const agentDebtPaymentController = require("../controllers/agentDebtPayment.controller");
const {
  createProductWriteOff,
} = require("../controllers/productWriteOff.controller");

// Middlewares
const { rAuth, rRole } = require("../middlewares/auth.middleware");

/**
 * AUTH
 */
router.use("/customers", require("./customers.routes"));

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
  warehouseController.createWarehouse,
);

// warehouselarni get qilish
router.get(
  "/warehouses",
  rAuth,
  rRole("ADMIN"),
  warehouseController.getWarehouses,
);

// bitta warehouseni get qilish
router.get(
  "/warehouses/:id",
  rAuth,
  rRole("ADMIN"),
  warehouseController.getWarehouseById,
);

// warehouseni update qilish
router.put(
  "/warehouses/:id",
  rAuth,
  rRole("ADMIN"),
  warehouseController.updateWarehouse,
);

// warehouseni delete qilish
router.delete(
  "/warehouses/:id",
  rAuth,
  rRole("ADMIN"),
  warehouseController.deleteWarehouse,
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
  supplierController.getSuppliersDashboard,
);

// supplier detailni get qilish
router.get(
  "/suppliers/:id/detail",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSupplierDetail,
);

// supplier yaratish
router.post(
  "/suppliers/create",
  rAuth,
  rRole("ADMIN"),
  supplierController.createSupplier,
);

// supplierlarni get qilish
router.get(
  "/suppliers",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSuppliers,
);

// bitta supplierni get qilish
router.get(
  "/suppliers/:id",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSupplierById,
);

// supplierni update qilish
router.put(
  "/suppliers/:id",
  rAuth,
  rRole("ADMIN"),
  supplierController.updateSupplier,
);
router.patch(
  "/suppliers/:id",
  rAuth,
  rRole("ADMIN"),
  supplierController.updateSupplier,
);

// supplierni delete qilish
router.delete(
  "/suppliers/:id",
  // rAuth,
  // rRole("ADMIN", "CASHIER"),
  supplierController.deleteSupplierHard,
);

// supplier qarzidan to'lov qilish
router.post(
  "/suppliers/:id/pay",
  rAuth,
  rRole("ADMIN"),
  supplierController.paySupplierDebt,
);

router.post(
  "/suppliers/:id/balance",
  rAuth,
  rRole("ADMIN"),
  supplierController.updateSupplierBalance,
);
router.put(
  "/suppliers/:id/opening-balance",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  supplierController.updateSupplierOpeningBalance,
);
router.patch(
  "/suppliers/:id/opening-balance",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  supplierController.updateSupplierOpeningBalance,
);

router.get(
  "/suppliers/:id/purchases",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSupplierPurchases,
);

router.get(
  "/suppliers/:id/timeline",
  rAuth,
  rRole("ADMIN"),
  supplierController.getSupplierTimeline,
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
  productController.createProduct,
);

// productlarni get qilish
router.get(
  "/products",
  // rAuth,
  // rRole("ADMIN", "CASHIER", "AGENT"),
  productController.getProducts,
);

router.get(
  "/products/archive",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  productController.getArchivedProducts,
);

// bitta productni get qilish
router.get(
  "/products/:id",
  rAuth,
  rRole("ADMIN"),
  productController.getProductById,
);

router.get(
  "/products/:id/history",
  rAuth,
  rRole("ADMIN", "CASHIER", "WAREHOUSE"),
  productController.getProductHistory,
);

// productni update qilish
router.put(
  "/products/:id",
  rAuth,
  rRole("ADMIN"),
  uploadProductImages.array("images", 5), // 1-5 ta rasm
  productController.updateProduct,
);

router.post(
  "/products/:id/archive",
  rAuth,
  rRole("ADMIN", "CASHIER", "WAREHOUSE"),
  productController.archiveProductStock,
);

router.post(
  "/products/:id/restore-archive",
  rAuth,
  rRole("ADMIN", "CASHIER", "WAREHOUSE"),
  productController.restoreArchivedProductStock,
);

router.delete(
  "/products/:id",
  rAuth,
  rRole("ADMIN","CASHIER"),
  productController.deleteProduct,
);


router.put(
  "/products/:id",
  rAuth,
  rRole("ADMIN"),
  uploadProductImages.array("images", 5),
  productController.updateProduct,
);

// purchase (kirim) yaratish
// purchase (kirim) yaratish
router.post(
  "/purchases/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  uploadProductImages.any(), // 🔥 HAMMA FILE FIELD QABUL QILINADI
  purchaseController.createPurchase,
);
router.get(
  "/purchases",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  purchaseController.getPurchases,
);
router.post(
  "/products/:id/image",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  uploadProductImages.array("images", 5),
  purchaseController.addProductImage,
);
router.delete(
  "/products/:id/image",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  productController.deleteProductImage,
);

router.delete(
  "/purchases/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  purchaseController.deletePurchase,
);
router.put(
  "/purchases/:id/edit",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  purchaseController.editPurchase,
);
router.patch(
  "/purchases/:id/edit",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  purchaseController.editPurchase,
);
/**
 * CUSTOMERS (HOZMAKLAR)
 */

// customer yaratish
router.post(
  "/customers/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.createCustomer,
);

// customerlarni get qilish
router.get(
  "/customers",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  customerController.getCustomers,
);

// bitta customer detail + summary
router.get(
  "/customers/:id",

  customerController.getCustomerById,
);

// customer update qilish
router.put(
  "/customers/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.updateCustomer,
);

// customer delete qilish (soft delete) (ADMIN only)
router.delete(
  "/customers/:id",
  rAuth,
  rRole("ADMIN"),
  customerController.deleteCustomer,
);

// customer sales history
router.get(
  "/customers/:id/sales",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  customerController.getCustomerSales,
);

// customer statement (kunma-kun hisobot)
router.get(
  "/customers/:id/statement",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.getCustomerStatement,
);
// customer summary (to‘liq tarix)
router.get(
  "/customers/:id/summary",
  // rAuth,
  // rRole("ADMIN", "CASHIER"),
  customerController.getCustomerSummary,
);
router.post(
  "/customers/:id/pay",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.payCustomerDebt,
);
router.put(
  "/customers/:id/opening-balance",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.updateCustomerOpeningBalance,
);
router.patch(
  "/customers/:id/opening-balance",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.updateCustomerOpeningBalance,
);
router.get(
  "/customers/:id/debt-sales",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.getCustomerDebtSales,
);

router.get(
  "/customers/:id/timeline",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  customerController.getCustomerTimeline,
);
/**
 * SALES (SOTUV)
 */

// sale (sotuv) yaratish
router.post(
  "/sales/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.createSale,
);

// salelarni get qilish
router.get(
  "/sales",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.getSales,
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
  salesController.cancelSale,
);
router.delete(
  "/sales/:id",
  rAuth,
  rRole("AGENT", "ADMIN", "CASHIER"),
  salesController.deleteSale,
);
router.put(
  "/sales/:id/edit",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.editSale,
);
router.patch(
  "/sales/:id/edit",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.editSale,
);

/**
 * AGENT ORDERS (ZAKAS)
 * Agent faqat zakas yaratadi
 */
router.post(
  "/agent/orders",
  rAuth,
  rRole("AGENT", "ADMIN", "CASHIER"),
  agentOrderController.createAgentOrder,
);

router.get(
  "/agents/summary",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  agentOrderController.getAgentsSummary,
);

router.get(
  "/agents/:id/orders",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  agentOrderController.getAgentOrders,
);

router.get(
  "/agents/:id/customers",
  rAuth,
  rRole("ADMIN", "AGENT", "CASHIER"),
  agentOrderController.getAgentCustomersStats,
);

/**
 * AGENT DEBT PAYMENT REQUESTS
 * Agent kiritadi -> Admin tasdiqlaydi
 */
router.post(
  "/agent-debt-payments",
  rAuth,
  rRole("AGENT", "ADMIN", "CASHIER"),
  agentDebtPaymentController.createAgentDebtPaymentRequest,
);
router.get(
  "/agent-debt-payments/my",
  rAuth,
  rRole("AGENT", "ADMIN", "CASHIER"),
  agentDebtPaymentController.getMyAgentDebtPaymentRequests,
);
router.get(
  "/agent-debt-payments",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  agentDebtPaymentController.getAgentDebtPaymentRequests,
);
router.patch(
  "/agent-debt-payments/:id/approve",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  agentDebtPaymentController.approveAgentDebtPaymentRequest,
);
router.patch(
  "/agent-debt-payments/:id/reject",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  agentDebtPaymentController.rejectAgentDebtPaymentRequest,
);

/**
 * CASHIER ORDERS (AGENT ZAKAS QABUL QILISH)
 */

// NEW zakaslar ro‘yxati
router.get(
  "/orders/new",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.getNewOrders,
);

// zakasni tasdiqlash (ombordan qty kamayadi)
router.post(
  "/orders/:id/confirm",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.confirmOrder,
);

router.put(
  "/orders/:id/edit",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.editOrder,
);
router.patch(
  "/orders/:id/edit",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.editOrder,
);

// zakasni bekor qilish
router.post(
  "/orders/:id/cancel",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashierOrderController.cancelOrder,
);

router.get(
  "/sales/search-by-product",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.searchSalesByProduct,
);

router.get(
  "/sales/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  salesController.getSaleById,
);

router.post(
  "/returns/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  returnController.createReturn,
);
router.get("/returns", returnController.getReturns);

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

// MONEY ENTRIES (pul kirdi / pul chiqdi)
router.post(
  "/money-entries",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  moneyEntryController.createMoneyEntry,
);
router.get(
  "/money-entries",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  moneyEntryController.getMoneyEntries,
);
router.get(
  "/money-entries/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  moneyEntryController.getMoneyEntryById,
);
router.put(
  "/money-entries/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  moneyEntryController.updateMoneyEntry,
);
router.patch(
  "/money-entries/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  moneyEntryController.updateMoneyEntry,
);
router.delete(
  "/money-entries/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  moneyEntryController.deleteMoneyEntry,
);

router.use("/analytics", rAuth, rRole("ADMIN", "CASHIER"), analyticsRoutes);

/**
 * INVESTOR WITHDRAWALS (FOYDADAN AYRILMAYDI)
 */

router.post(
  "/withdrawals/create",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.createWithdrawal,
);

/* =========================
   EDIT WITHDRAWAL
   Investor pulini tahrirlash
========================= */
router.put(
  "/withdrawals/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.updateWithdrawal,
);
router.patch(
  "/withdrawals/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.updateWithdrawal,
);
router.put(
  "/withdrawals/edit/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.updateWithdrawal,
);
router.patch(
  "/withdrawals/edit/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.updateWithdrawal,
);

/* =========================
   GET WITHDRAWALS
   Filter + date range
========================= */
router.get(
  "/withdrawals",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.getWithdrawals,
);
router.get(
  "/withdrawals/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.getWithdrawalById,
);
router.delete(
  "/withdrawals/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.deleteWithdrawal,
);
router.delete(
  "/withdrawals/delete/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.deleteWithdrawal,
);
router.post(
  "/withdrawals/delete/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  withdrawalController.deleteWithdrawal,
);
// 🔥 PUL KIRIM
router.post(
  "/cash-in",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashInController.createCashIn,
);

router.get(
  "/cash-in/report",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashInController.getCashInReportAll,
);

router.get(
  "/reconciliation/counterparties",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  reconciliationController.getCounterparties,
);

router.get(
  "/reconciliation/:type/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  reconciliationController.getActSverka,
);

router.put(
  "/cash-edit/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashInController.editCashIn,
);
router.delete(
  "/cash-in/:id",
  rAuth,
  rRole("ADMIN", "CASHIER"),
  cashInController.deleteCashIn,
);

// faqat ADMIN yoki OMBORCHI
router.post(
  "/products/write-off",
  rAuth,
  rRole("ADMIN", "WAREHOUSE"),
  createProductWriteOff,
);

router.patch(
  "/sales/:saleId/adjust-item",
  rAuth,
  rRole("ADMIN", "WAREHOUSE"),
  salesController.adjustSaleItemQty,
);

module.exports = router;
