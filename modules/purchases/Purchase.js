const mongoose = require("mongoose");

const purchaseItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // 🔹 snapshot
    name: { type: String, required: true },
    model: { type: String, default: "" },
    unit: { type: String, enum: ["DONA", "PACHKA", "KG"], required: true },

    qty: { type: Number, required: true, min: 0 },
    buy_price: { type: Number, required: true, min: 0 },
    sell_price: { type: Number, required: true, min: 0 },

    currency: { type: String, enum: ["UZS", "USD"], required: true },

    // 🔥 item bo‘yicha summa (o‘z currency’da)
    row_total: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseSchema = new mongoose.Schema(
  {
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },

    batch_no: {
      type: String,
      required: true,
      trim: true,
    },

    // 🔥 Purchase umumiy summasi (currency bo‘yicha)
    totals: {
      UZS: { type: Number, default: 0 },
      USD: { type: Number, default: 0 },
    },

    items: {
      type: [purchaseItemSchema],
      required: true,
      validate: [
        (arr) => arr.length > 0,
        "Kamida 1 ta mahsulot bo‘lishi kerak",
      ],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Purchase", purchaseSchema);
