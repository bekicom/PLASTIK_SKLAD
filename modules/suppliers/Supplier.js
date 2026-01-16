const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true },

    balance: {
      UZS: { type: Number, default: 0 },
      USD: { type: Number, default: 0 },
    },

    payment_history: [
      {
        currency: { type: String, enum: ["UZS", "USD"], required: true },
        amount: { type: Number, required: true },
        direction: {
          type: String,
          enum: ["DEBT", "PAYMENT", "PREPAYMENT", "ROLLBACK"],
          required: true,
        },
        note: String,
        ref_id: { type: mongoose.Schema.Types.ObjectId }, // 🔥 CashIn ID
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Supplier", supplierSchema);
