const Product = require("../../modules/products/Product");

/**
 * =========================
 * GET PRODUCTS (APP CUSTOMER)
 * =========================
 */
exports.getProductsForApp = async (req, res) => {
  try {
    const products = await Product.find({
      qty: { $gt: 0 }, // 🔥 FAQAT SHU YETARLI
    })
      .select("name model color category unit sell_price qty images")
      .sort({ name: 1 })
      .lean();

    res.json({
      ok: true,
      count: products.length,
      data: products,
    });
  } catch (err) {
    console.error("getProductsForApp error:", err);
    res.status(500).json({ ok: false, message: "Server xatoligi" });
  }
};
