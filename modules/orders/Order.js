const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // 🔒 TO‘LIQ PRODUCT SNAPSHOT (TARIX UCHUN)
    product_snapshot: {
      name: { type: String, required: true, trim: true },
      model: { type: String, default: null, trim: true },
      color: { type: String, default: null, trim: true },
      category: { type: String, default: null, trim: true },
      unit: { type: String, required: true, trim: true },
      images: [{ type: String }],
    },

    qty: {
      type: Number,
      required: true,
      min: 0.000001,
    },

    price_snapshot: {
      type: Number,
      required: true,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    currency_snapshot: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    items: {
      type: [OrderItemSchema],
      default: [],
    },

    total: {
      type: Number,
      default: 0,
      min: 0,
    },

    total_uzs: { type: Number, default: 0, min: 0 },
    total_usd: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ["NEW", "CONFIRMED", "CANCELED"],
      default: "NEW",
      index: true,
    },

    note: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    confirmedAt: Date,
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    canceledAt: Date,
    canceledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    cancelReason: {
      type: String,
      trim: true,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

// indexlar
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ agent_id: 1, createdAt: -1 });
OrderSchema.index({ customer_id: 1, createdAt: -1 });

module.exports = mongoose.model("Order", OrderSchema);
