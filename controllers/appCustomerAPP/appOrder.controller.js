const mongoose = require("mongoose");
const AppOrder = require("../../modules/appOrderAPP/AppOrder");
const Product = require("../../modules/products/Product");

/**
 * =========================
 * CREATE ORDER (APP CUSTOMER)
 * =========================
 */
exports.createOrder = async (req, res) => {
  try {
    const customerId = req.appCustomer._id;
    const { items = [], note = "" } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Kamida bitta mahsulot bo‘lishi kerak",
      });
    }

    const orderItems = [];
    let grandTotal = 0;

    for (const it of items) {
      if (
        !mongoose.isValidObjectId(it.product_id) ||
        !Number.isFinite(it.qty) ||
        it.qty <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message: "Mahsulot ma’lumotlari noto‘g‘ri",
        });
      }

      const product = await Product.findById(it.product_id);
      if (!product) {
        return res.status(404).json({
          ok: false,
          message: "Mahsulot topilmadi",
        });
      }

      if (product.qty < it.qty) {
        return res.status(400).json({
          ok: false,
          message: `Omborda yetarli emas: ${product.name}`,
        });
      }

      const price = product.sell_price;
      const total = price * it.qty;

      orderItems.push({
        product_id: product._id,
        qty: it.qty,
        price,
        total,
      });

      grandTotal += total;
    }

    const order = await AppOrder.create({
      customer_id: customerId,
      items: orderItems,
      grand_total: grandTotal,
      note,
      status: "NEW",
    });

    res.status(201).json({
      ok: true,
      message: "Zakaz yaratildi",
      order,
    });
  } catch (err) {
    console.error("createOrder error:", err);
    res.status(500).json({
      ok: false,
      message: "Server xatoligi",
    });
  }
};
