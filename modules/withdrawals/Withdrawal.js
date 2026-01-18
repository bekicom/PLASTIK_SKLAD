const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    investor_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
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
      index: true,
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

    // ✅ ISTALGAN SANANI QABUL QILADI
    // agar yuborilmasa → hozirgi sana
    takenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.Withdrawal || mongoose.model("Withdrawal", withdrawalSchema);
