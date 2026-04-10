const mongoose = require("mongoose");

const agentDebtPaymentSchema = new mongoose.Schema(
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
      default: "CASH",
      required: true,
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "CANCELED"],
      default: "PENDING",
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    decisionNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    cash_in_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CashIn",
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

agentDebtPaymentSchema.index({ status: 1, createdAt: -1 });
agentDebtPaymentSchema.index({ customer_id: 1, status: 1, createdAt: -1 });

module.exports =
  mongoose.models.AgentDebtPayment ||
  mongoose.model("AgentDebtPayment", agentDebtPaymentSchema);

