const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      index: true,
    },

    phone: { type: String, trim: true, maxlength: 30, index: true },
    address: { type: String, trim: true, maxlength: 250 },
    note: { type: String, trim: true, maxlength: 300 },

    // 🔥 UNIVERSAL BALANCE (supplier bilan BIR XIL)
    balance: {
      UZS: { type: Number, default: 0 }, // + qarz, - avans
      USD: { type: Number, default: 0 },
    },

    // 🔥 TO‘LOV / O‘ZGARISH TARIXI
    payment_history: [
      {
        currency: {
          type: String,
          enum: ["UZS", "USD"],
          required: true,
        },

        amount: {
          type: Number,
          required: true, // har doim musbat
          min: 0,
        },

        // DEBT  → qarz oshdi
        // PAYMENT → qarz kamaydi
        // PREPAYMENT → avans
        direction: {
          type: String,
          enum: ["DEBT", "PAYMENT", "PREPAYMENT"],
          required: true,
        },

        note: { type: String, default: "" },
        date: { type: Date, default: Date.now },
      },
    ],

    // Soft delete
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

customerSchema.index({ name: 1, phone: 1 });

module.exports =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);
