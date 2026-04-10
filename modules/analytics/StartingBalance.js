const mongoose = require("mongoose");

const startingBalanceSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      index: true,
      default: Date.now,
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
      default: "CASH",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

startingBalanceSchema.index({ date: -1, currency: 1, payment_method: 1 });

module.exports =
  mongoose.models.StartingBalance ||
  mongoose.model("StartingBalance", startingBalanceSchema);
