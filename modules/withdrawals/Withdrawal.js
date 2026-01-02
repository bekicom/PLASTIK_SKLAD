const mongoose = require("mongoose");

const WithdrawalSchema = new mongoose.Schema(
  {
    investor_name: {
      type: String,
      required: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },

    purpose: {
      type: String,
      trim: true,
      required: true,
    },

    takenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Withdrawal", WithdrawalSchema);
