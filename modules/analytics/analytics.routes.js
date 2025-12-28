const express = require("express");
const router = express.Router();

const analyticsController = require("../../controllers/analytics.controller");

// /analytics/overview
router.get("/overview", analyticsController.overview);

// /analytics/timeseries
router.get("/timeseries", analyticsController.timeseries);

// /analytics/top
router.get("/top", analyticsController.top);

// /analytics/stock
router.get("/stock", analyticsController.stock);

module.exports = router;
