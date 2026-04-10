const mongoose = require("mongoose");

const CUR = ["UZS", "USD"];
const METHODS = ["CASH", "CARD"];
const TYPES = ["INCOME", "EXPENSE"];

const moneyEntrySchema = new mongoose.Schema(
  {
    entry_type: {
      type: String,
      enum: TYPES,
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
      enum: CUR,
      default: "UZS",
      index: true,
    },
    payment_method: {
      type: String,
      enum: METHODS,
      default: "CASH",
      index: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
    entry_date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

moneyEntrySchema.statics.CUR = CUR;
moneyEntrySchema.statics.METHODS = METHODS;
moneyEntrySchema.statics.TYPES = TYPES;

module.exports =
  mongoose.models.MoneyEntry || mongoose.model("MoneyEntry", moneyEntrySchema);
