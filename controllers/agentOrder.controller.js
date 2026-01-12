const mongoose = require("mongoose");
const Order = require("../modules/orders/Order");
const Product = require("../modules/products/Product");
const Customer = require("../modules/Customer/Customer");
const User = require("../modules/Users/User"); // path to‘g‘riligini tekshir

function parseDate(d, endOfDay = false) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else dt.setHours(0, 0, 0, 0);
  return dt;
}

function getUserId(req) {
  return req.user?.id || req.user?._id;
}


exports.createAgentOrder = async (req, res) => {
  try {
    const agentId = getUserId(req);
    if (!agentId) {
      return res.status(401).json({
        ok: false,
        message: "Token kerak (Authorization: Bearer ...)",
      });
    }

    const { customer_id, customer: customerRaw, items, note } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "items bo‘sh bo‘lishi mumkin emas",
      });
    }

    /* =========================
       👤 CUSTOMER ANIQLASH
       priority:
       1) customer_id
       2) customer object (yangi)
    ========================= */
    let customer;

    // 1️⃣ Mavjud customer_id
    if (customer_id && mongoose.isValidObjectId(customer_id)) {
      customer = await Customer.findById(customer_id);
      if (!customer) {
        return res.status(404).json({
          ok: false,
          message: "Customer topilmadi",
        });
      }
    }

    // 2️⃣ Yangi customer object
    else if (customerRaw && typeof customerRaw === "object") {
      const name = String(customerRaw.name || "").trim();
      const phone = String(customerRaw.phone || "").trim();
      const address = String(customerRaw.address || "").trim();
      const noteCustomer = String(customerRaw.note || "").trim();

      if (!name || !phone) {
        return res.status(400).json({
          ok: false,
          message: "Yangi mijoz uchun name va phone majburiy",
        });
      }

      // 🔍 Avval phone bo‘yicha tekshiramiz
      customer = await Customer.findOne({ phone });

      // ➕ Yo‘q bo‘lsa – yaratamiz
      if (!customer) {
        customer = await Customer.create({
          name,
          phone,
          address,
          note: noteCustomer,
          balance: { UZS: 0, USD: 0 },
        });
      }
    }

    // 3️⃣ Hech narsa yuborilmagan
    else {
      return res.status(400).json({
        ok: false,
        message: "customer_id yoki customer object yuborilishi kerak",
      });
    }

    /* =========================
       📦 PRODUCTLARNI TEKSHIRISH
    ========================= */
    const productIds = items.map((it) => it.product_id);

    if (productIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({
        ok: false,
        message: "items ichida product_id noto‘g‘ri",
      });
    }

    const products = await Product.find({
      _id: { $in: productIds },
      is_active: { $ne: false },
    })
      .select(
        "name model color category unit sell_price warehouse_currency images"
      )
      .lean();

    if (products.length !== productIds.length) {
      return res.status(400).json({
        ok: false,
        message: "Ba’zi productlar topilmadi yoki aktiv emas",
      });
    }

    const productMap = new Map(products.map((p) => [String(p._id), p]));

    /* =========================
       🧮 ITEMS + TOTALS
    ========================= */
    const orderItems = [];
    let total_uzs = 0;
    let total_usd = 0;

    for (const it of items) {
      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({
          ok: false,
          message: "qty noto‘g‘ri",
        });
      }

      const p = productMap.get(String(it.product_id));
      const currency = p.warehouse_currency;

      const basePrice = Number(p.sell_price || 0);
      const price = it.price !== undefined ? Number(it.price) : basePrice;

      if (!price || price <= 0 || price > basePrice) {
        return res.status(400).json({
          ok: false,
          message: `Narx noto‘g‘ri: ${p.name}`,
        });
      }

      const subtotal = qty * price;

      if (currency === "UZS") total_uzs += subtotal;
      else total_usd += subtotal;

      orderItems.push({
        product_id: p._id,
        product_snapshot: {
          name: p.name,
          model: p.model || null,
          color: p.color || null,
          category: p.category || null,
          unit: p.unit,
          images: p.images || [],
        },
        qty,
        price_snapshot: price,
        subtotal,
        currency_snapshot: currency,
      });
    }

    /* =========================
       🧾 ORDER CREATE
    ========================= */
    const orderDoc = await Order.create({
      agent_id: agentId,
      customer_id: customer._id,
      items: orderItems,
      total_uzs,
      total_usd,
      note: note?.trim(),
      status: "NEW",
    });

    /* =========================
       🔔 SOCKET
    ========================= */
    const io = req.app?.get("io");
    if (io) {
      const fullOrder = await Order.findById(orderDoc._id)
        .populate("agent_id", "name phone login")
        .populate("customer_id", "name phone address note")
        .lean();

      io.to("cashiers").emit("order:new", { order: fullOrder });
    }

    return res.status(201).json({
      ok: true,
      message: "Zakas yuborildi",
      data: {
        order: orderDoc,
        customer: {
          _id: customer._id,
          name: customer.name,
          phone: customer.phone,
        },
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

    // faqat AGENT userlar
    const agents = await User.find({ role: "AGENT" })
      .select("name phone login role createdAt")
      .lean();

    const agentIds = agents.map((a) => a._id);

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
    if (status) filter.status = String(status).toUpperCase();
    if (customer_id && mongoose.isValidObjectId(customer_id))
      filter.customer_id = customer_id;

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
 *
 * ✅ eski total ishlatmasdan, total_uzs + total_usd bilan
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
      customer_id: { $ne: null },
    };

    if (fromDate || toDate) {
      match.createdAt = {};
      if (fromDate) match.createdAt.$gte = fromDate;
      if (toDate) match.createdAt.$lte = toDate;
    }

    const items = await Order.aggregate([
      { $match: match },

      {
        $group: {
          _id: "$customer_id",
          ordersCount: { $sum: 1 },
          confirmedCount: {
            $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] },
          },
          canceledCount: {
            $sum: { $cond: [{ $eq: ["$status", "CANCELED"] }, 1, 0] },
          },

          // ✅ totals (UZS/USD)
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

      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer",
        },
      },
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
          canceledCount: 1,
          totals: { UZS: "$totalUZS", USD: "$totalUSD" },
          confirmedTotals: { UZS: "$confirmedUZS", USD: "$confirmedUSD" },
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
