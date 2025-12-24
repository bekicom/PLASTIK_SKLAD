const mongoose = require("mongoose");
const Order = require("../modules/orders/Order");
const Product = require("../modules/products/Product");

/**
 * POST /agent/orders
 * body:
 * {
 *   warehouse_id,
 *   note,
 *   items: [
 *     { product_id, qty }
 *   ]
 * }
 */
exports.createAgentOrder = async (req, res) => {
  try {
    const agentId = req.user._id; // rAuth dan keladi
    const { warehouse_id, items, note } = req.body || {};

    if (!warehouse_id) {
      return res.status(400).json({
        ok: false,
        message: "warehouse_id majburiy",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "items bo‘sh bo‘lishi mumkin emas",
      });
    }

    // product_id larni yig‘ib olamiz
    const productIds = items.map((i) => i.product_id);

    const products = await Product.find({
      _id: { $in: productIds },
      is_active: { $ne: false }, // agar bunday field bo‘lsa
    });

    if (products.length !== items.length) {
      return res.status(400).json({
        ok: false,
        message: "Ba’zi productlar topilmadi yoki aktiv emas",
      });
    }

    let orderItems = [];
    let total = 0;

    for (const it of items) {
      const product = products.find((p) => p._id.toString() === it.product_id);

      const qty = Number(it.qty);
      if (!qty || qty <= 0) {
        return res.status(400).json({
          ok: false,
          message: "qty noto‘g‘ri",
        });
      }

      // ⚠️ NARX QAYERDA TURLIGIGA QARAB O‘ZGARTIRILADI
      const price = Number(product.price || 0);

      const subtotal = qty * price;
      total += subtotal;

      orderItems.push({
        product_id: product._id,
        name_snapshot: product.name,
        unit_snapshot: product.unit, // kg / dona (agar bo‘lsa)
        qty,
        price_snapshot: price,
        subtotal,
      });
    }

    const order = await Order.create({
      agent_id: agentId,
      warehouse_id,
      items: orderItems,
      total,
      note: note?.trim(),
      status: "NEW",
    });

    // 🔔 SOCKET (keyin qo‘shamiz)
    // req.io.to("role:CASHIER").emit("order:new", {
    //   orderId: order._id,
    //   agentId,
    //   total,
    // });

    return res.status(201).json({
      ok: true,
      message: "Zakas yuborildi",
      data: order,
    });
  } catch (error) {
    console.error("createAgentOrder error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
