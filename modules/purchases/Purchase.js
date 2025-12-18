const mongoose = require("mongoose");

const purchaseItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    name: { type: String, required: true }, // snapshot
    model: { type: String, default: "" }, // snapshot
    unit: { type: String, enum: ["DONA", "PACHKA", "KG"], required: true },

    qty: { type: Number, required: true, min: 0 },
    buy_price: { type: Number, required: true, min: 0 },
    sell_price: { type: Number, required: true, min: 0 },

    currency: { type: String, enum: ["UZS", "USD"], required: true },

    row_total_uzs: { type: Number, required: true, min: 0 },
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

    usd_rate: {
      type: Number,
      default: 0,
    },

    paid_amount_uzs: {
      type: Number,
      default: 0,
    },

    total_amount_uzs: {
      type: Number,
      default: 0,
    },

    debt_amount_uzs: {
      type: Number,
      default: 0,
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
