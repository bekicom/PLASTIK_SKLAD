const mongoose = require("mongoose");

const productWriteOffSchema = new mongoose.Schema(
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

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },

    loss_amount: {
      type: Number,
      required: true,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ProductWriteOff ||
  mongoose.model("ProductWriteOff", productWriteOffSchema);
