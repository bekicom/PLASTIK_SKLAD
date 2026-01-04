const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true },

    // 🔥 UNIVERSAL BALANCE
    balance: {
      UZS: { type: Number, default: 0 },
      USD: { type: Number, default: 0 },
    },

    // To‘lovlar va avanslar tarixi
    payment_history: [
      {
        currency: { type: String, enum: ["UZS", "USD"], required: true },
        amount: { type: Number, required: true }, // har doim musbat
        direction: {
          type: String,
          enum: ["DEBT", "PAYMENT", "PREPAYMENT"],
          required: true,
        },
        note: String,
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Supplier", supplierSchema);
