require("dotenv").config();
const mongoose = require("mongoose");

// MODELS
const Product = require("../modules/products/Product");
const Purchase = require("../modules/purchases/Purchase");
const Sale = require("../modules/sales/Sale");
const ProductWriteOff = require("../modules/writeOff/ProductWriteOff");

async function rebuildStock() {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("🔁 STOCK REBUILD STARTED");

  const products = await Product.find().select("_id name qty");

  for (const product of products) {
    const productId = product._id;

    // 1️⃣ PURCHASE → KIRIM
    const purchases = await Purchase.aggregate([
      { $unwind: "$items" },
      {
        $match: {
          "items.product_id": productId,
          status: "COMPLETED",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$items.qty" },
        },
      },
    ]);

    const purchaseQty = purchases[0]?.total || 0;

    // 2️⃣ SALES → CHIQIM
    const sales = await Sale.aggregate([
      { $unwind: "$items" },
      {
        $match: {
          "items.product_id": productId,
          status: "COMPLETED",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$items.qty" },
        },
      },
    ]);

    const saleQty = sales[0]?.total || 0;

    // 3️⃣ WRITE-OFF → YO‘QOTISH
    const writeoffs = await ProductWriteOff.aggregate([
      { $unwind: "$items" },
      {
        $match: {
          "items.product_id": productId,
          status: "CONFIRMED",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$items.qty" },
        },
      },
    ]);

    const writeOffQty = writeoffs[0]?.total || 0;

    // ✅ TO‘G‘RI QTY
    const correctQty = purchaseQty - saleQty - writeOffQty;

    // 🧾 LOG
    if (product.qty !== correctQty) {
      console.log(`📦 ${product.name}: ${product.qty} → ${correctQty}`);

      product.qty = correctQty;
      await product.save();
    }
  }

  console.log("✅ STOCK REBUILD FINISHED");
  process.exit();
}

rebuildStock().catch((err) => {
  console.error("❌ ERROR:", err);
  process.exit(1);
});
