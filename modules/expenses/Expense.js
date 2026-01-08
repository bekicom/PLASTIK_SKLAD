const mongoose = require("mongoose");

const CUR = ["UZS", "USD"];

const ExpenseSchema = new mongoose.Schema(
  {
    // Masalan: "Arenda", "Obed", "Svet", "Internet", "Remont"
    category: { type: String, required: true, trim: true, index: true },

    // ixtiyoriy izoh: "Dekabr oyi", "Ofis", "2 kunlik obet"
    note: { type: String, trim: true },

    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, enum: CUR, default: "UZS", index: true },

    // kim kiritdi (req.user)
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

    // xarajat sanasi (hisobotlar uchun)
    expense_date: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

ExpenseSchema.statics.CUR = CUR;

module.exports =
  mongoose.models.Expense || mongoose.model("Expense", ExpenseSchema);
