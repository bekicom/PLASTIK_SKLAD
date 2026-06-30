const router = require("express").Router();
const marketplaceController = require("../controllers/marketplace.controller");
const marketplaceAdminController = require("../controllers/marketplaceAdmin.controller");
const marketplaceHomeController = require("../controllers/marketplaceHome.controller");
const marketplaceReorderController = require("../controllers/marketplaceReorder.controller");
const marketplaceSettingsController = require("../controllers/marketplaceSettings.controller");
const marketplaceSystemController = require("../controllers/marketplaceSystem.controller");
const mobileAuthController = require("../controllers/mobile/mobileAuth.controller");
const { rAuth, rRole } = require("../middlewares/auth.middleware");
const { rMobileAuth, rMobileAuthNoVersion } = require("../middlewares/mobileAuth.middleware");

router.get("/version", (req, res) => {
  res.json({
    ok: true,
    minimum_version: process.env.MARKETPLACE_MIN_VERSION || "1.0.0",
    force_update: String(process.env.MARKETPLACE_FORCE_UPDATE || "").toLowerCase() === "true",
  });
});

router.post("/auth/request-code", marketplaceController.requestCode);
router.post("/auth/verify-code", marketplaceController.verifyCode);
router.post("/auth/register", marketplaceController.register);
router.get("/auth/me", rMobileAuth, marketplaceController.me);
router.get("/auth/profile", rMobileAuthNoVersion, marketplaceController.me);
router.post("/auth/logout", rMobileAuth, marketplaceController.logout);
router.patch("/auth/request-agent-change", rMobileAuth, marketplaceController.requestAgentChange);
router.post("/profile/agent-change-request", rMobileAuth, marketplaceController.requestAgentChange);
router.patch("/profile/agent-change-request", rMobileAuth, marketplaceController.requestAgentChange);
router.post("/request-code", marketplaceController.requestCode);
router.post("/verify-code", marketplaceController.verifyCode);
router.post("/register", marketplaceController.register);
router.get("/me", rMobileAuth, marketplaceController.me);
router.get("/profile", rMobileAuthNoVersion, marketplaceController.me);
router.post("/logout", rMobileAuth, marketplaceController.logout);
router.patch("/request-agent-change", rMobileAuth, marketplaceController.requestAgentChange);

router.get("/home", marketplaceHomeController.getHome);
router.get("/home/banners", marketplaceHomeController.getBanners);
router.get("/home/sections", marketplaceHomeController.getSections);
router.get("/promotions", marketplaceHomeController.getPromotions);
router.get("/promotions/:id", marketplaceHomeController.getPromotion);

router.get("/settings/public", marketplaceSettingsController.publicSettings);
router.get("/settings/availability", marketplaceSettingsController.availability);
router.get("/settings/regions", marketplaceSettingsController.regions);
router.get("/settings/delivery", marketplaceSettingsController.delivery);
router.get("/settings/payment-methods", marketplaceSettingsController.paymentMethods);
router.get("/settings/app-config", marketplaceSettingsController.appConfig);
router.get("/settings/support", marketplaceSettingsController.support);
router.get("/settings/access-check", marketplaceSettingsController.accessCheck);

router.get("/products/categories", rMobileAuthNoVersion, mobileAuthController.getMobileProductCategories);
router.get("/products/filters", rMobileAuthNoVersion, mobileAuthController.getMobileProductFilters);
router.get("/products/search-suggestions", rMobileAuthNoVersion, mobileAuthController.getMobileProductSearchSuggestions);
router.get("/products", rMobileAuthNoVersion, mobileAuthController.getMobileProducts);
router.get("/products/:id", rMobileAuthNoVersion, mobileAuthController.getMobileProductById);
router.get("/products/:id/related", rMobileAuthNoVersion, mobileAuthController.getMobileRelatedProducts);
router.post("/orders", rMobileAuth, require("../controllers/mobile/mobileOrder.controller").createMobileOrder);
router.post("/orders/submit", rMobileAuthNoVersion, marketplaceReorderController.submitOrder);
router.patch("/orders/:id/cancel", rMobileAuthNoVersion, marketplaceReorderController.cancelOrder);

router.get("/favorites", rMobileAuth, marketplaceReorderController.getFavorites);
router.post("/favorites", rMobileAuth, marketplaceReorderController.addFavorite);
router.delete("/favorites/:product_id", rMobileAuth, marketplaceReorderController.deleteFavorite);
router.post("/favorites/toggle", rMobileAuth, marketplaceReorderController.toggleFavorite);
router.get("/products/:id/favorite-status", rMobileAuth, marketplaceReorderController.getFavoriteStatus);

router.get("/reorders/previous-purchases", rMobileAuth, marketplaceReorderController.getPreviousPurchases);
router.get("/reorders/previous-purchases/:product_id", rMobileAuth, marketplaceReorderController.getPreviousPurchaseByProduct);
router.post("/reorders/add-to-cart", rMobileAuth, marketplaceReorderController.addReorderToCart);
router.post("/reorders/order/:order_id/add-to-cart", rMobileAuth, marketplaceReorderController.addOrderToCart);
router.get("/reorders/suggestions", rMobileAuth, marketplaceReorderController.getSuggestions);
router.get("/cart", rMobileAuthNoVersion, marketplaceReorderController.getCart);
router.post("/cart/items", rMobileAuthNoVersion, marketplaceReorderController.addCartItem);
router.patch("/cart/items", rMobileAuthNoVersion, marketplaceReorderController.updateCartItem);
router.patch("/cart/items/:item_id", rMobileAuthNoVersion, marketplaceReorderController.updateCartItem);
router.delete("/cart/items", rMobileAuthNoVersion, marketplaceReorderController.deleteCartItem);
router.delete("/cart/items/:item_id", rMobileAuthNoVersion, marketplaceReorderController.deleteCartItem);
router.delete("/cart/clear", rMobileAuthNoVersion, marketplaceReorderController.clearCart);
router.post("/cart/validate", rMobileAuthNoVersion, marketplaceReorderController.validateCart);
router.get("/orders", rMobileAuthNoVersion, marketplaceReorderController.getOrders);
router.get("/orders/:id", rMobileAuthNoVersion, marketplaceReorderController.getOrderById);
router.get("/notifications/unread-count", rMobileAuthNoVersion, marketplaceController.unreadNotificationCount);
router.get("/notifications", rMobileAuthNoVersion, marketplaceController.listNotifications);
router.get("/notifications/preferences", rMobileAuthNoVersion, marketplaceController.notificationPreferences);
router.patch("/notifications/preferences", rMobileAuthNoVersion, marketplaceController.updateNotificationPreferences);
router.get("/cashback/summary", rMobileAuthNoVersion, marketplaceAdminController.cashbackSummary);
router.get("/cashback/history", rMobileAuthNoVersion, marketplaceAdminController.cashbackHistory);
router.get("/finance/summary", rMobileAuthNoVersion, require("../controllers/finance.controller").summary);
router.get("/finance/balance", rMobileAuthNoVersion, require("../controllers/finance.controller").balance);
router.get("/finance/statement", rMobileAuthNoVersion, require("../controllers/finance.controller").statement);
router.get("/finance/payments", rMobileAuthNoVersion, require("../controllers/finance.controller").payments);

router.get("/admin/pending", rAuth, rRole("ADMIN", "CASHIER"), marketplaceController.listPendingAccounts);
router.get("/admin/accounts", rAuth, rRole("ADMIN", "CASHIER"), marketplaceController.listMarketplaceAccounts);

router.get("/admin/dashboard/summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.dashboardSummary);
router.get("/admin/dashboard/top-products", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.topProducts);
router.get("/admin/dashboard/top-customers", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.topCustomers);
router.get("/admin/dashboard/top-agents", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.topAgents);

router.get("/admin/analytics/overview", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.analyticsOverview);
router.get("/admin/analytics/trends", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.analyticsTrends);
router.get("/admin/analytics/orders/status-summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.orderStatusSummary);
router.get("/admin/analytics/orders/conversion", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.orderConversion);
router.get("/admin/analytics/products/top", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.analyticsTopProducts);
router.get("/admin/analytics/products/stock-alerts", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.productStockAlerts);
router.get("/admin/analytics/customers/top", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.analyticsTopCustomers);
router.get("/admin/analytics/agents/performance", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.agentsPerformance);
router.get("/admin/analytics/cashback/summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.analyticsCashbackSummary);
router.get("/admin/analytics/cashback/customers", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.analyticsCashbackCustomers);
router.get("/admin/analytics/referrals/summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.referralsSummary);
router.get("/admin/analytics/notifications/summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.notificationsSummary);
router.get("/admin/analytics/banners/summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.bannersSummary);
router.get("/admin/analytics/reorder/summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reorderSummary);

router.get("/admin/customers", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listCustomers);
router.get("/admin/customers/:account_id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.getCustomer);
router.patch("/admin/customers/:account_id/approve", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.approveCustomer);
router.patch("/admin/customers/:account_id/link-customer", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.linkCustomer);
router.patch("/admin/customers/:account_id/block", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.setCustomerStatus("BLOCKED"));
router.patch("/admin/customers/:account_id/unblock", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.setCustomerStatus("UNBLOCK"));
router.patch("/admin/customers/:account_id/reject", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.setCustomerStatus("REJECTED"));
router.patch("/admin/customers/:account_id/agent", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.assignAgent);

router.get("/admin/orders", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listOrders);
router.get("/admin/orders/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.getOrder);
router.patch("/admin/orders/:id/items/:item_id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateOrderItem);
router.patch("/admin/orders/:id/approve", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.approveOrder);
router.patch("/admin/orders/:id/reject", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.rejectOrCancelOrder("reject"));
router.patch("/admin/orders/:id/cancel", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.rejectOrCancelOrder("cancel"));
router.patch("/admin/orders/:id/complete", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.rejectOrCancelOrder("complete"));
router.get("/admin/orders/:id/events", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.orderEvents);

router.get("/admin/products", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listProducts);
router.patch("/admin/products/:id/marketplace", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateProductMarketplace);
router.patch("/admin/products/:id/images", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateProductImages);
router.patch("/admin/products/:id/category", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateProductCategory);
router.patch("/admin/products/:id/sort", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateProductSort);
router.post("/admin/products/bulk-update", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.bulkUpdateProducts);

router.get("/admin/cashback/summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.cashbackSummary);
router.get("/admin/cashback/customers", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.cashbackCustomers);
router.get("/admin/cashback/customers/:customer_id/history", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.cashbackHistory);
router.get("/admin/cashback/customers/:customer_id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.cashbackCustomerDetail);
router.get("/admin/cashback/use-requests", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.cashbackUseRequests);
router.patch("/admin/cashback/use-requests/:id/approve", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reviewCashbackUseRequest("APPROVED"));
router.patch("/admin/cashback/use-requests/:id/reject", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reviewCashbackUseRequest("REJECTED"));
router.get("/admin/cashback/rules", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listCashbackRules);
router.post("/admin/cashback/rules", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createCashbackRule);
router.patch("/admin/cashback/rules/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateCashbackRule);
router.delete("/admin/cashback/rules/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.deleteCashbackRule);

router.get("/admin/referrals/stats", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.referralStats);
router.get("/admin/referrals", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listReferrals);
router.patch("/admin/referrals/:id/approve", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reviewReferral("APPLIED"));
router.patch("/admin/referrals/:id/reject", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reviewReferral("REJECTED"));
router.get("/admin/agents/referral-codes", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.agentReferralCodes);
router.patch("/admin/agents/:id/referral-code", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateAgentReferralCode);

router.get("/admin/notifications/campaigns", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listCampaigns);
router.post("/admin/notifications/campaigns", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createCampaign);
router.get("/admin/notifications/campaigns/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.getCampaign);
router.patch("/admin/notifications/campaigns/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateCampaign);
router.post("/admin/notifications/campaigns/:id/send", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.sendCampaign);
router.patch("/admin/notifications/campaigns/:id/cancel", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.cancelCampaign);
router.get("/admin/notifications/templates", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listTemplates);
router.post("/admin/notifications/templates", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createTemplate);
router.patch("/admin/notifications/templates/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateTemplate);
router.get("/admin/notifications/stats", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.notificationStats);

router.get("/admin/home/banners", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listBanners);
router.post("/admin/home/banners", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createBanner);
router.get("/admin/home/banners/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.getBanner);
router.patch("/admin/home/banners/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateBanner);
router.patch("/admin/home/banners/:id/publish", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.publishBanner);
router.patch("/admin/home/banners/:id/disable", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.disableBanner);
router.delete("/admin/home/banners/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.deleteBanner);
router.get("/admin/home/sections", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listSections);
router.post("/admin/home/sections", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createSection);
router.patch("/admin/home/sections/reorder", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reorderSections);
router.patch("/admin/home/sections/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateSection);
router.patch("/admin/home/sections/:id/publish", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.publishSection);
router.patch("/admin/home/sections/:id/disable", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.disableSection);
router.delete("/admin/home/sections/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.deleteSection);
router.get("/admin/promotions", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listPromotions);
router.post("/admin/promotions", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createPromotion);
router.patch("/admin/promotions/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updatePromotion);
router.patch("/admin/promotions/:id/activate", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.activatePromotion);
router.patch("/admin/promotions/:id/disable", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.disablePromotion);
router.delete("/admin/promotions/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.deletePromotion);
router.get("/admin/home/preview", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.homePreview);
router.get("/admin/home/stats", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.homeStats);

router.get("/admin/settings/general", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.getGeneralAdmin);
router.patch("/admin/settings/general", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.patchGeneralAdmin);
router.get("/admin/settings/regions", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.listRegionSettings);
router.post("/admin/settings/regions", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.createRegionSetting);
router.patch("/admin/settings/regions/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.updateRegionSetting);
router.delete("/admin/settings/regions/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.deleteRegionSetting);
router.get("/admin/settings/delivery", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.listDeliverySettings);
router.post("/admin/settings/delivery", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.createDeliverySetting);
router.patch("/admin/settings/delivery/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.updateDeliverySetting);
router.delete("/admin/settings/delivery/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.deleteDeliverySetting);
router.get("/admin/minimal-order-rules", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listMinimalOrderRules);
router.post("/admin/minimal-order-rules", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createMinimalOrderRule);
router.patch("/admin/minimal-order-rules/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateMinimalOrderRule);
router.delete("/admin/minimal-order-rules/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.deleteMinimalOrderRule);
router.get("/admin/settings/minimal-order-rules", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.listMinimalOrderRules);
router.post("/admin/settings/minimal-order-rules", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createMinimalOrderRule);
router.patch("/admin/settings/minimal-order-rules/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.updateMinimalOrderRule);
router.delete("/admin/settings/minimal-order-rules/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.deleteMinimalOrderRule);
router.get("/admin/customers/:customer_id/credit-limit", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.getCreditLimit);
router.patch("/admin/customers/:customer_id/credit-limit", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.patchCreditLimit);
router.get("/admin/settings/payment-methods", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.listPaymentMethodsAdmin);
router.patch("/admin/settings/payment-methods", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.patchPaymentMethodsAdmin);
router.get("/admin/settings/app-version", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.listAppVersionRules);
router.patch("/admin/settings/app-version/:platform", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.patchAppVersionRule);
router.get("/admin/settings/support", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.getSupportAdmin);
router.patch("/admin/settings/support", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.patchSupportAdmin);
router.get("/admin/settings/preview", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.settingsPreview);
router.post("/admin/settings/cache/clear", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.clearSettingsCache);
router.get("/admin/settings/audit-log", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSettingsController.settingsAuditLog);

router.get("/admin/system/health", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSystemController.health);
router.get("/admin/system/routes", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSystemController.routes);
router.get("/admin/system/indexes", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSystemController.indexes);
router.get("/admin/system/integrity", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSystemController.integrity);
router.get("/admin/system/release-checklist", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSystemController.releaseChecklist);
router.post("/admin/system/rebuild-cache", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSystemController.rebuildCache);
router.post("/admin/system/run-diagnostics", rAuth, rRole("ADMIN", "CASHIER"), marketplaceSystemController.runDiagnostics);

router.get("/admin/favorites/stats", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.favoritesStats);
router.get("/admin/reorder/stats", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reorderStats);
router.get("/admin/customers/:customer_id/favorites-summary", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.customerFavoritesSummary);

router.get("/admin/reports/orders", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reportOrders);
router.get("/admin/reports/customers", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reportCustomers);
router.get("/admin/reports/cashback", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reportCashback);
router.get("/admin/reports/referrals", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reportReferrals);
router.get("/admin/reports/notifications", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reportNotifications);
router.get("/admin/reports/banners", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reportBanners);
router.get("/admin/reports/products", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.reportProducts);
router.post("/admin/reports/export-jobs", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.createExportJob);
router.get("/admin/reports/export-jobs/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.getExportJob);
router.get("/admin/audit-log", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.auditLog);
router.get("/admin/audit-log/:id", rAuth, rRole("ADMIN", "CASHIER"), marketplaceAdminController.auditLogDetail);

router.get("/admin/customers/:customer_id/favorites", rAuth, rRole("ADMIN", "CASHIER"), marketplaceReorderController.adminCustomerFavorites);
router.get("/admin/customers/:customer_id/previous-purchases", rAuth, rRole("ADMIN", "CASHIER"), marketplaceReorderController.adminCustomerPreviousPurchases);
router.post("/admin/reorders/rebuild-snapshot", rAuth, rRole("ADMIN", "CASHIER"), marketplaceReorderController.rebuildPreviousPurchaseSnapshot);
router.patch("/admin/accounts/:id/approve", rAuth, rRole("ADMIN", "CASHIER"), marketplaceController.approveAccount);
router.patch("/admin/accounts/:id/unblock", rAuth, rRole("ADMIN", "CASHIER"), marketplaceController.unblockAccount);
router.patch("/admin/accounts/:id/block", rAuth, rRole("ADMIN", "CASHIER"), marketplaceController.blockAccount);
router.patch("/admin/accounts/:id/reject", rAuth, rRole("ADMIN", "CASHIER"), marketplaceController.rejectAccount);
router.patch("/admin/accounts/:id/link", rAuth, rRole("ADMIN", "CASHIER"), marketplaceController.linkToExistingCustomer);

module.exports = router;
