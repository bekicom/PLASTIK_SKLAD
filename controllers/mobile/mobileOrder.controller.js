const mongoose = require("mongoose");
const Order = require("../../modules/orders/Order");
const Product = require("../../modules/products/Product");

/* =======================
   GET ORDER FULL (SOCKET)
======================= */
async function getOrderFull(orderId) {
  if (!mongoose.isValidObjectId(orderId)) return null;

  const order = await Order.findById(orderId)
    .populate("agent_id", "name phone login")
    .populate("customer_id", "name phone address note")
    .lean();

  if (!order) return null;

  return {
    _id: order._id,
    status: order.status,
    createdAt: order.createdAt,
    note: order.note || null,
    source: order.source || null,

    agent: order.agent_id
      ? {
          _id: order.agent_id._id,
          name: order.agent_id.name,
          phone: order.agent_id.phone,
          login: order.agent_id.login,
        }
      : null,

    customer: order.customer_id
      ? {
          _id: order.customer_id._id,
          name: order.customer_id.name,
          phone: order.customer_id.phone,
          address: order.customer_id.address,
          note: order.customer_id.note,
        }
      : null,

    items: (order.items || []).map((it) => ({
      productId: it.product_id,
      product: {
        name: it.product_snapshot?.name,
        model: it.product_snapshot?.model,
        color: it.product_snapshot?.color,
        category: it.product_snapshot?.category,
        unit: it.product_snapshot?.unit,
        images: it.product_snapshot?.images || [],
      },
      currency: it.currency_snapshot,
      qty: Number(it.qty),
      price: Number(it.price_snapshot),
      subtotal: Number(it.subtotal),
    })),

    totals: {
      UZS: Number(order.total_uzs || 0),
      USD: Number(order.total_usd || 0),
    },
  };
}

/* =========================
   📱 MOBILE → CREATE ORDER
========================= */
exports.createMobileOrder = async (req, res) => {
  try {
    const customer = req.mobileCustomer;

    if (!customer) {
      return res.status(401).json({
        ok: false,
        message: "Mobile auth topilmadi",
      });
    }

    const { items, note } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Zakas bo‘sh bo‘lishi mumkin emas",
      });
    }

    const orderItems = [];
    let total = 0;
    let total_uzs = 0;
    let total_usd = 0;

    for (const it of items) {
      if (
        !mongoose.isValidObjectId(it.product_id) ||
        !it.qty ||
        Number(it.qty) <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message: "Product yoki qty noto‘g‘ri",
        });
      }

      const product = await Product.findById(it.product_id).lean();

      if (!product) {
        return res.status(404).json({
          ok: false,
          message: "Product topilmadi",
        });
      }

      if (Number(product.qty || 0) < Number(it.qty)) {
        return res.status(400).json({
          ok: false,
          message: `${product.name} dan yetarli miqdor yo‘q`,
        });
      }

      const price = Number(product.sell_price || 0);
      const qty = Number(it.qty);
      const subtotal = price * qty;

      total += subtotal;

      const cur = product.warehouse_currency; // UZS | USD
      if (cur === "UZS") total_uzs += subtotal;
      if (cur === "USD") total_usd += subtotal;

      orderItems.push({
        product_id: product._id,
        product_snapshot: {
          name: product.name,
          model: product.model || null,
          color: product.color || null,
          category: product.category || null,
          unit: product.unit,
          images: product.images || [],
        },
        qty,
        price_snapshot: price,
        subtotal,
        currency_snapshot: cur,
      });
    }

    const order = await Order.create({
      agent_id: customer._id, // mobil customer
      customer_id: customer._id,
      source: "MOBILE",
      items: orderItems,
      total,
      total_uzs,
      total_usd,
      note: note?.trim() || "",
      status: "NEW",
    });

    /* =========================
       🔔 SOCKET: NEW ORDER
       admin/kassir zakaslar bo‘limiga tushadi
    ========================= */
    const io = req.app?.get("io");
    if (io) {
      const fullOrder = await getOrderFull(order._id);
      io.to("cashiers").emit("order:new", { order: fullOrder });
    }

    return res.status(201).json({
      ok: true,
      message: "Zakas qabul qilindi",
      order_id: order._id,
      status: order.status,
    });
  } catch (error) {
    console.error("createMobileOrder error:", error);
    return res.status(500).json({
      ok: false,
      message: "Zakas yaratishda xatolik",
      error: error.message,
    });
  }
};
