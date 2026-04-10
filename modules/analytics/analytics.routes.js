const express = require("express");
const router = express.Router();

const analyticsController = require("../../controllers/analytics.controller");

// /analytics/overview
router.get("/overview", analyticsController.overview);

// /analytics/starting-balance
router.post("/starting-balance", analyticsController.createStartingBalance);
router.get("/starting-balance", analyticsController.getStartingBalanceList);
router.put("/starting-balance/:id", analyticsController.updateStartingBalance);
router.patch("/starting-balance/:id", analyticsController.updateStartingBalance);
router.delete("/starting-balance/:id", analyticsController.deleteStartingBalance);

// /analytics/timeseries
router.get("/timeseries", analyticsController.timeseries);

// /analytics/top
router.get("/top", analyticsController.top);

// /analytics/stock
router.get("/stock", analyticsController.stock);

// /analytics/profit-details
router.get("/profit-details", analyticsController.profitDetails);

// /analytics/business-analysis
router.get("/business-analysis", analyticsController.businessAnalysis);

module.exports = router;
