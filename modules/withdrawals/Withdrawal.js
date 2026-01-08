const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    investor_name: {
      type: String,
      required: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },

    payment_method: {
      type: String,
      enum: ["CASH", "CARD"],
      required: true,
    },

    purpose: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      default: "INVESTOR_WITHDRAWAL",
      index: true,
    },

    takenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
