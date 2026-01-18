const mongoose = require("mongoose");

const CUR = ["UZS", "USD"];

const ExpenseSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true, index: true },

    note: { type: String, trim: true },

    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, enum: CUR, default: "UZS", index: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    payment_method: {
      type: String,
      enum: ["CASH", "CARD"],
      default: "CASH",
    },

    // ✅ ISTALGAN SANANI QABUL QILADI
    // agar yuborilmasa → hozirgi sana
    expense_date: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
);

ExpenseSchema.statics.CUR = CUR;

module.exports =
  mongoose.models.Expense || mongoose.model("Expense", ExpenseSchema);
