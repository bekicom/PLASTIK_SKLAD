const mongoose = require("mongoose");

const mobileOrderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: String,
    unit: String,
    qty: {
      type: Number,
      required: true,
      min: 0.01,
    },
    price_snapshot: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const mobileOrderSchema = new mongoose.Schema(
  {
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    items: [mobileOrderItemSchema],

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },

    total_amount: {
      type: Number,
      required: true,
    },

    note: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "CANCELLED"],
      default: "PENDING",
    },

    confirmedAt: Date,
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MobileOrder", mobileOrderSchema);
