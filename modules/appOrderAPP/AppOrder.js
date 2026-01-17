const mongoose = require("mongoose");

const appOrderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const appOrderSchema = new mongoose.Schema(
  {
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppCustomer",
      required: true,
    },

    items: {
      type: [appOrderItemSchema],
      required: true,
    },

    grand_total: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["NEW", "CONFIRMED", "CANCELED"],
      default: "NEW",
      index: true,
    },

    source: {
      type: String,
      default: "APP",
    },

    note: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppOrder", appOrderSchema);
