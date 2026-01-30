const service = require("../modules/analytics/analytics.service");

function parseDate(s, endOfDay = false) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * ✅ HELPER: startingBalance ni parse qilish
 * Request dan kelgan ma'lumotlarni to'g'ri formatga o'tkazish
 */
function parseStartingBalance(req) {
  // Agar request body'da startingBalance obyekti bo'lsa
  if (req.body && req.body.startingBalance) {
    return req.body.startingBalance;
  }

  // Agar alohida fieldlar bo'lsa
  if (req.body) {
    const uzs = {
      total: Number(
        req.body.starting_balance_uzs || req.body.startingBalanceUZS || 0,
      ),
      CASH: Number(req.body.starting_cash_uzs || req.body.startingCashUZS || 0),
      CARD: Number(req.body.starting_card_uzs || req.body.startingCardUZS || 0),
    };

    const usd = {
      total: Number(
        req.body.starting_balance_usd || req.body.startingBalanceUSD || 0,
      ),
      CASH: Number(req.body.starting_cash_usd || req.body.startingCashUSD || 0),
      CARD: Number(req.body.starting_card_usd || req.body.startingCardUSD || 0),
    };

    // Agar hech narsa berilmagan bo'lsa, null qaytarish (default 0 ishlatiladi)
    if (
      uzs.total === 0 &&
      uzs.CASH === 0 &&
      uzs.CARD === 0 &&
      usd.total === 0 &&
      usd.CASH === 0 &&
      usd.CARD === 0
    ) {
      return null;
    }

    return { UZS: uzs, USD: usd };
  }

  // Agar query params'dan kelsa
  if (req.query) {
    const uzs = {
      total: Number(req.query.starting_balance_uzs || 0),
      CASH: Number(req.query.starting_cash_uzs || 0),
      CARD: Number(req.query.starting_card_uzs || 0),
    };

    const usd = {
      total: Number(req.query.starting_balance_usd || 0),
      CASH: Number(req.query.starting_cash_usd || 0),
      CARD: Number(req.query.starting_card_usd || 0),
    };

    if (
      uzs.total === 0 &&
      uzs.CASH === 0 &&
      uzs.CARD === 0 &&
      usd.total === 0 &&
      usd.CASH === 0 &&
      usd.CARD === 0
    ) {
      return null;
    }

    return { UZS: uzs, USD: usd };
  }

  return null;
}

/**
 * DASHBOARD OVERVIEW
 * - supplier / customer balance (qarz & avans)
 * - sales / profit / expenses / orders
 * - cashflow by method (CASH/CARD)
 */
exports.overview = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const warehouseId = req.query.warehouseId || null;

    // ✅ BOSHLANG'ICH BALANSNI QO'LDA KIRITISH
    // Klent aytgan bo'lsa, bu yerda o'zgartiring
    const startingBalance = {
      UZS: {
        total: 250000, // 👈 Bu yerda o'zgartiring
        CASH: 250000, // 👈 Naqd pul
        CARD: 0, // 👈 Karta
      },
      USD: {
        total: 0,
        CASH: 0,
        CARD: 0,
      },
    };

    const data = await service.getOverview({
      from,
      to,
      tz,
      warehouseId,
      startingBalance,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("Overview error:", e);
    return res.status(500).json({
      ok: false,
      message: "overview xatolik",
      error: e.message,
    });
  }
};

/**
 * TIME SERIES (grafiklar)
 * - Kunlik yoki oylik sotuv/xarajat statistikasi
 */
exports.timeseries = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const group = req.query.group === "month" ? "month" : "day";

    const data = await service.getTimeSeries({
      from,
      to,
      tz,
      group,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("Timeseries error:", e);
    return res.status(500).json({
      ok: false,
      message: "timeseries xatolik",
      error: e.message,
    });
  }
};

/**
 * TOP LISTS
 * type:
 *  - products  (eng ko'p sotilgan mahsulotlar)
 *  - customers (eng katta qarzdor mijozlar)
 */
exports.top = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";
    const type = req.query.type || "products";

    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50,
    );

    const data = await service.getTop({
      from,
      to,
      tz,
      type,
      limit,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("Top error:", e);
    return res.status(500).json({
      ok: false,
      message: "top xatolik",
      error: e.message,
    });
  }
};

/**
 * STOCK (ombor qoldig'i)
 * - Valyuta bo'yicha ombor qiymati
 */
exports.stock = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const tz = req.query.tz || "Asia/Tashkent";

    const data = await service.getStock({
      from,
      to,
      tz,
    });

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("Stock error:", e);
    return res.status(500).json({
      ok: false,
      message: "stock xatolik",
      error: e.message,
    });
  }
};

/**
 * ============================================
 * QANDAY ISHLATISH - REQUEST MISOLLARI
 * ============================================
 */

/*
// ✅ Variant 1: Request body orqali (TAVSIYA ETILADI)
POST /api/analytics/overview
Body: {
  "startingBalance": {
    "UZS": {
      "total": 100000,
      "CASH": 100000,
      "CARD": 0
    },
    "USD": {
      "total": 0,
      "CASH": 0,
      "CARD": 0
    }
  }
}

// ✅ Variant 2: Alohida fieldlar bilan
POST /api/analytics/overview
Body: {
  "starting_balance_uzs": 100000,
  "starting_cash_uzs": 100000,
  "starting_card_uzs": 0,
  "starting_balance_usd": 0,
  "starting_cash_usd": 0,
  "starting_card_usd": 0
}

// ✅ Variant 3: Query params orqali
GET /api/analytics/overview?starting_balance_uzs=100000&starting_cash_uzs=100000&starting_card_uzs=0

// ✅ Variant 4: Bo'sh (default 0 ishlatiladi)
GET /api/analytics/overview

*/
