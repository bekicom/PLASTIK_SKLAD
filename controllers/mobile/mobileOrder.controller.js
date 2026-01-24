const mongoose = require("mongoose");
const Order = require("../../modules/orders/Order");
const Product = require("../../modules/products/Product");

/* =========================
   📱 MOBILE → CREATE ORDER
   ✅ SOCKET FORMAT TUZATILDI
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

    const { items = [], note } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Zakas bo'sh bo'lishi mumkin emas",
      });
    }

    /* =========================
       PRODUCTS (1 QUERY)
    ========================= */
    const productIds = items.map((i) => i.product_id);

    if (productIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({
        ok: false,
        message: "Product id noto'g'ri",
      });
    }

    const products = await Product.find({
      _id: { $in: productIds },
      is_active: { $ne: false },
    }).lean();

    const productMap = new Map(products.map((p) => [String(p._id), p]));

    const orderItems = [];
    let total_uzs = 0;
    let total_usd = 0;

    /* =========================
       ITEMS BUILD
    ========================= */
    for (const it of items) {
      const qty = Number(it.qty);
      if (!qty || qty <= 0) {
        return res.status(400).json({
          ok: false,
          message: "Qty noto'g'ri",
        });
      }

      const product = productMap.get(String(it.product_id));
      if (!product) {
        return res.status(404).json({
          ok: false,
          message: "Product topilmadi",
        });
      }

      if (Number(product.qty || 0) < qty) {
        return res.status(400).json({
          ok: false,
          message: `${product.name} dan yetarli miqdor yo'q`,
        });
      }

      const price = Number(product.sell_price || 0);
      const subtotal = price * qty;

      if (product.warehouse_currency === "UZS") total_uzs += subtotal;
      if (product.warehouse_currency === "USD") total_usd += subtotal;

      orderItems.push({
        product_id: product._id,
        product_snapshot: {
          name: product.name,
          model: product.model || "",
          color: product.color || "",
          category: product.category || "",
          unit: product.unit,
          images: product.images || [],
        },
        qty,
        price_snapshot: price,
        subtotal,
        currency_snapshot: product.warehouse_currency,
      });
    }

    /* =========================
       CREATE ORDER (MOBILE)
    ========================= */
    const order = await Order.create({
      agent_id: null,
      customer_id: customer._id,
      source: "MOBILE",
      items: orderItems,
      total_uzs,
      total_usd,
      note: note?.trim() || "",
      status: "NEW",
    });

    /* =========================
       🔔 SOCKET EMIT
       ✅ AGENT FORMAT BILAN
    ========================= */
    if (req.io) {
      // To'liq order olish (populate bilan)
      const fullOrder = await Order.findById(order._id)
        .populate("agent_id", "name phone login")
        .populate("customer_id", "name phone address note")
        .lean();

      // ✅ Agent format bilan emit qilish
      req.io.to("cashiers").emit("mobile:new-order", {
        order: {
          _id: fullOrder._id,
          source: fullOrder.source,

          // Agent (mobile uchun null)
          agent_id: fullOrder.agent_id || null,

          // Customer
          customer_id: {
            _id: fullOrder.customer_id._id,
            name: fullOrder.customer_id.name,
            phone: fullOrder.customer_id.phone,
            address: fullOrder.customer_id.address,
            note: fullOrder.customer_id.note,
          },

          // Items (agent format)
          items: fullOrder.items.map((it) => ({
            product_id: it.product_id,
            product_snapshot: {
              name: it.product_snapshot?.name,
              model: it.product_snapshot?.model,
              color: it.product_snapshot?.color,
              category: it.product_snapshot?.category,
              unit: it.product_snapshot?.unit,
              images: it.product_snapshot?.images || [],
            },
            qty: it.qty,
            price_snapshot: it.price_snapshot,
            subtotal: it.subtotal,
            currency_snapshot: it.currency_snapshot,
          })),

          // Totals
          total_uzs: fullOrder.total_uzs || 0,
          total_usd: fullOrder.total_usd || 0,

          // Status
          status: fullOrder.status,
          sale_id: fullOrder.sale_id || null,
          note: fullOrder.note || "",

          // Timestamps
          confirmedAt: fullOrder.confirmedAt || null,
          confirmedBy: fullOrder.confirmedBy || null,
          canceledAt: fullOrder.canceledAt || null,
          canceledBy: fullOrder.canceledBy || null,
          cancelReason: fullOrder.cancelReason || "",
          createdAt: fullOrder.createdAt,
          updatedAt: fullOrder.updatedAt,

          __v: fullOrder.__v,

          // Qo'shimcha (agar kerak bo'lsa)
          totals: {
            UZS: fullOrder.total_uzs || 0,
            USD: fullOrder.total_usd || 0,
          },
        },
      });

      console.log("✅ Mobile order socket emitted:", order._id);
    } else {
      console.warn("⚠️ req.io mavjud emas!");
    }

    return res.status(201).json({
      ok: true,
      message: "Mobile zakas qabul qilindi",
      order: {
        _id: order._id,
        status: order.status,
        totals: { UZS: total_uzs, USD: total_usd },
      },
    });
  } catch (error) {
    console.error("❌ createMobileOrder error:", error);
    return res.status(500).json({
      ok: false,
      message: "Mobile zakas yaratishda xatolik",
      error: error.message,
    });
  }
};
