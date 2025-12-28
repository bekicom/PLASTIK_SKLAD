const service = require("../modules/analytics/analytics.service");

function parseDate(s, endOfDay = false) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

exports.overview = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const warehouseId = req.query.warehouseId || null;

    const data = await service.getOverview({ from, to, tz, warehouseId });
    return res.json({ ok: true, data });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, message: "overview xatolik", error: e.message });
  }
};

exports.timeseries = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const group = req.query.group === "month" ? "month" : "day";

    const data = await service.getTimeSeries({ from, to, tz, group });
    return res.json({ ok: true, data });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, message: "timeseries xatolik", error: e.message });
  }
};

exports.top = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const type = req.query.type || "products";
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50
    );

    const data = await service.getTop({ from, to, tz, type, limit });
    return res.json({ ok: true, data });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, message: "top xatolik", error: e.message });
  }
};

exports.stock = async (req, res) => {
  try {
    const data = await service.getStock();
    return res.json({ ok: true, data });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, message: "stock xatolik", error: e.message });
  }
};
