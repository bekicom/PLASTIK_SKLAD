const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // Qaysi zavoddan kelgan
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Model (agar yo‘q bo‘lsa null bo‘ladi)
    model: {
      type: String,
      trim: true,
      default: null,
    },

    images: {
      type: [String],
      default: [],
    },

    // 🔥 MUHIM: rang bilan ajratyapmiz
    color: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      default: "",
      trim: true,
    },

    unit: {
      type: String,
      enum: ["DONA", "PACHKA", "KG"],
      required: true,
    },

    // Qaysi ombor (UZS / USD)
    warehouse_currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
      index: true,
    },

    qty: {
      type: Number,
      default: 0,
      min: 0,
    },

    buy_price: {
      type: Number,
      required: true,
      min: 0,
    },

    sell_price: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true },
);

/**
 * 🔒 DUBL BO‘LMASIN
 * supplier + name + model + color + currency
 */
productSchema.index(
  {
    supplier_id: 1,
    name: 1,
    model: 1,
    color: 1,
    warehouse_currency: 1,
  },
  { unique: true },
);

module.exports = mongoose.model("Product", productSchema);
