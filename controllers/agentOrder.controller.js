const mongoose = require("mongoose");
const Order = require("../modules/orders/Order");
const Product = require("../modules/products/Product");
const Customer = require("../modules/Customer/Customer");

// ⚠️ Sizda User modeli qayerda?
// Oldin routerda ../controllers/user.controller ishlatyapsiz, lekin user modeli pathi sizda boshqacha bo‘lishi mumkin.
// Siz yuborgan snippet’da: "../modules/Users/User" deb turibdi.
// Shu path to‘g‘ri bo‘lsa qoldiring, bo‘lmasa moslang.
const User = require("../modules/Users/User");

function safeNumber(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  return String(phone).replace(/\s+/g, "").trim();
}

function parseDate(d, endOfDay = false) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else dt.setHours(0, 0, 0, 0);
  return dt;
}

/**
 * POST /agent/orders
 * (AGENT)
 * body:
 * {
 *   customer_id?: "...",              // eski customer bo‘lsa
 *   customer_name?: "Ali",            // yangi customer bo‘lsa
 *   customer_phone?: "99890...",      // yangi customer bo‘lsa
 *   note?: "...",
 *   items: [{ product_id, qty }]
 * }
 */
exports.createAgentOrder = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        ok: false,
        message: "Token kerak (Authorization: Bearer ...)",
      });
    }

    const agentId = req.user.id;
    const { customer_id, items, note } = req.body || {};

    if (!customer_id || !mongoose.isValidObjectId(customer_id)) {
      return res
        .status(400)
        .json({ ok: false, message: "customer_id noto‘g‘ri yoki yo‘q" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "items bo‘sh bo‘lishi mumkin emas" });
    }

    const customer = await Customer.findById(customer_id);
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    // product_id lar
    const ids = [];
    for (const it of items) {
      if (!it?.product_id || !mongoose.isValidObjectId(it.product_id)) {
        return res
          .status(400)
          .json({ ok: false, message: "items ichida product_id noto‘g‘ri" });
      }
      ids.push(String(it.product_id));
    }
    const productIds = [...new Set(ids)];

    // ✅ Productdan kerakli fieldlar: sell_price, warehouse_currency
    const products = await Product.find({
      _id: { $in: productIds },
      is_active: { $ne: false }, // agar bunday field bo‘lmasa olib tashla
    }).select("name unit sell_price warehouse_currency");

    if (products.length !== productIds.length) {
      return res.status(400).json({
        ok: false,
        message: "Ba’zi productlar topilmadi yoki aktiv emas",
      });
    }

    const orderItems = [];
    let total_uzs = 0;
    let total_usd = 0;

    for (const it of items) {
      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res
          .status(400)
          .json({
            ok: false,
            message: "qty noto‘g‘ri (0 dan katta bo‘lishi kerak)",
          });
      }

      const p = products.find(
        (x) => x._id.toString() === String(it.product_id)
      );

      const currency = String(p.warehouse_currency || "").toUpperCase();
      if (currency !== "UZS" && currency !== "USD") {
        return res.status(400).json({
          ok: false,
          message: "Product currency noto‘g‘ri (UZS/USD bo‘lishi kerak)",
          product_id: p._id,
        });
      }

      // ✅ SOTUV NARXI
      const price = Number(p.sell_price || 0);

      // ✅ narx 0 bo‘lsa zakasni bloklaymiz (tavsiya)
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({
          ok: false,
          message:
            "Product sell_price kiritilmagan (0). Avval product narxini to‘g‘rilang.",
          product_id: p._id,
          product_name: p.name,
          currency,
        });
      }

      const subtotal = qty * price;

      if (currency === "UZS") total_uzs += subtotal;
      if (currency === "USD") total_usd += subtotal;

      orderItems.push({
        product_id: p._id,
        name_snapshot: p.name,
        unit_snapshot: p.unit,
        qty,
        price_snapshot: price, // ✅ sell_price dan
        subtotal,
        currency_snapshot: currency, // ✅ UZS/USD
      });
    }

    const order = await Order.create({
      agent_id: agentId,
      customer_id: customer._id,
      items: orderItems,

      // ✅ totals
      total_uzs,
      total_usd,

      // eski total ni xohlasang olib tashla yoki 0 qoldir
      // total: 0,

      note: note?.trim(),
      status: "NEW",
    });

    return res.status(201).json({
      ok: true,
      message: "Zakas yuborildi",
      data: {
        order,
        totals: { UZS: total_uzs, USD: total_usd },
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};



/**
 * GET /agents/summary?from=&to=
 * ADMIN/CASHIER
 */
exports.getAgentsSummary = async (req, res) => {
  try {
    const { from, to } = req.query;

    const fromDate = parseDate(from, false);
    const toDate = parseDate(to, true);

    const match = {};
    if (fromDate || toDate) {
      match.createdAt = {};
      if (fromDate) match.createdAt.$gte = fromDate;
      if (toDate) match.createdAt.$lte = toDate;
    }

    // ✅ faqat AGENT userlar
    const agents = await User.find({ role: "AGENT" }).select(
      "name phone login role createdAt"
    );

    const agentIds = agents.map((a) => a._id);

    // ✅ endi total_uzs / total_usd bo‘yicha yig‘amiz
    const agg = await Order.aggregate([
      { $match: { ...match, agent_id: { $in: agentIds } } },
      {
        $group: {
          _id: "$agent_id",

          ordersCount: { $sum: 1 },

          confirmedCount: {
            $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] },
          },

          canceledCount: {
            $sum: { $cond: [{ $eq: ["$status", "CANCELED"] }, 1, 0] },
          },

          // ✅ UZS/USD totals
          totalUZS: { $sum: { $ifNull: ["$total_uzs", 0] } },
          totalUSD: { $sum: { $ifNull: ["$total_usd", 0] } },

          confirmedUZS: {
            $sum: {
              $cond: [
                { $eq: ["$status", "CONFIRMED"] },
                { $ifNull: ["$total_uzs", 0] },
                0,
              ],
            },
          },

          confirmedUSD: {
            $sum: {
              $cond: [
                { $eq: ["$status", "CONFIRMED"] },
                { $ifNull: ["$total_usd", 0] },
                0,
              ],
            },
          },

          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ]);

    const map = new Map(agg.map((x) => [String(x._id), x]));

    const items = agents.map((a) => {
      const s = map.get(String(a._id)) || {};
      return {
        agent: a,
        stats: {
          ordersCount: s.ordersCount || 0,
          confirmedCount: s.confirmedCount || 0,
          canceledCount: s.canceledCount || 0,

          // ✅ yangi ko‘rinish
          totals: {
            UZS: s.totalUZS || 0,
            USD: s.totalUSD || 0,
          },
          confirmedTotals: {
            UZS: s.confirmedUZS || 0,
            USD: s.confirmedUSD || 0,
          },

          lastOrderAt: s.lastOrderAt || null,
        },
      };
    });

    return res.json({ ok: true, total: items.length, items });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};


/**
 * GET /agents/:id/orders?from=&to=&status=&customer_id=
 * ADMIN/CASHIER
 */
exports.getAgentOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const { from, to, status, customer_id } = req.query;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "agent id noto‘g‘ri" });
    }

    const fromDate = parseDate(from, false);
    const toDate = parseDate(to, true);

    const filter = { agent_id: id };

    if (status) filter.status = status;
    if (customer_id) filter.customer_id = customer_id;

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate) filter.createdAt.$lte = toDate;
    }

    const items = await Order.find(filter)
      .populate("customer_id", "name phone")
      .sort({ createdAt: -1 });

    return res.json({ ok: true, total: items.length, items });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

/**
 * GET /agents/:id/customers?from=&to=
 * ADMIN/CASHIER
 */
exports.getAgentCustomersStats = async (req, res) => {
  try {
    const { id } = req.params;
    const { from, to } = req.query;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "agent id noto‘g‘ri" });
    }

    const fromDate = parseDate(from, false);
    const toDate = parseDate(to, true);

    const match = {
      agent_id: new mongoose.Types.ObjectId(id),

      // ✅ customer_id null bo‘lgan eski orderlarni chiqarib tashlaymiz
      customer_id: { $ne: null },

      // ✅ agar ba’zi orderlarda customer_id umuman yo‘q bo‘lsa ham chiqarib tashlaydi
      // customer_id: { $exists: true, $ne: null },
    };

    if (fromDate || toDate) {
      match.createdAt = {};
      if (fromDate) match.createdAt.$gte = fromDate;
      if (toDate) match.createdAt.$lte = toDate;
    }

    const items = await Order.aggregate([
      { $match: match },

      // ✅ customer_id bo‘yicha gruppa
      {
        $group: {
          _id: "$customer_id",
          ordersCount: { $sum: 1 },
          confirmedCount: {
            $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] },
          },
          totalSum: { $sum: "$total" },
          confirmedSum: {
            $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, "$total", 0] },
          },
          lastOrderAt: { $max: "$createdAt" },
        },
      },

      // ✅ customers collectiondan customer info olib kelish
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer",
        },
      },

      // ✅ customer topilmasa ham item chiqaveradi (xohlasang false qilamiz)
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 0,
          customer_id: "$_id",
          customer: {
            name: "$customer.name",
            phone: "$customer.phone",
          },
          ordersCount: 1,
          confirmedCount: 1,
          totalSum: 1,
          confirmedSum: 1,
          lastOrderAt: 1,
        },
      },

      { $sort: { lastOrderAt: -1 } },
    ]);

    return res.json({ ok: true, total: items.length, items });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
