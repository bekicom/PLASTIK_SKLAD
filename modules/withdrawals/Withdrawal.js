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

    purpose: {
      type: String,
      required: true,
      trim: true,
    },

    // 🔥 MUHIM MAYDON
    type: {
      type: String,
      enum: ["INVESTOR_WITHDRAWAL"],
      default: "INVESTOR_WITHDRAWAL",
      index: true,
    },

    takenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Withdrawal || mongoose.model("Withdrawal", withdrawalSchema);
