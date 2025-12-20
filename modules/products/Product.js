const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // Qaysi zavoddan kelgan
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    model: {
      type: String,
      default: "",
      trim: true,
    },

    color: {
      type: String,
      default: "",
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

    // qaysi omborga kirim bo‘ladi (UZS / USD)
    warehouse_currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
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
  { timestamps: true }
);

/**
 * Bir xil zavoddan kelgan bir xil product dubl bo‘lmasin
 * (supplier + name + model + color + currency)
 */
productSchema.index(
  {
    supplier_id: 1,
    name: 1,
    model: 1,
    color: 1,
    warehouse_currency: 1,
  },
  { unique: true }
);

module.exports = mongoose.model("Product", productSchema);

