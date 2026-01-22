const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    /* =====================
       BASIC INFO
    ===================== */
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

    /* =====================
       ROLE & ACCESS (NEW)
    ===================== */
    role: {
      type: String,
      enum: ["ADMIN", "CASHIER", "AGENT", "MOBILE"],
      default: "ADMIN", // 🔥 eski customerlar uchun
      index: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "BLOCKED", "REJECTED"],
      default: "ACTIVE", // 🔥 web orqali kiritilganlar darhol aktiv
      index: true,
    },

    registered_from: {
      type: String,
      enum: ["ADMIN", "MOBILE"],
      default: "WEB",
      index: true,
    },

    /* =====================
       BALANCE
    ===================== */
    balance: {
      UZS: { type: Number, default: 0 }, // + qarz, - avans
      USD: { type: Number, default: 0 },
    },

    opening_balance: {
      UZS: { type: Number, default: 0 },
      USD: { type: Number, default: 0 },
    },

    /* =====================
       PAYMENT HISTORY
    ===================== */
    payment_history: [
      {
        currency: {
          type: String,
          enum: ["UZS", "USD"],
          required: true,
        },

        amount: {
          type: Number,
          required: true,
          min: 0,
        },

        direction: {
          type: String,
          enum: ["DEBT", "PAYMENT", "PREPAYMENT", "PAYMENT_CANCEL", "ROLLBACK"],
          required: true,
        },

        note: { type: String, default: "" },
        date: { type: Date, default: Date.now },
      },
    ],

    /* =====================
       SOFT DELETE
    ===================== */
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

customerSchema.index({ name: 1, phone: 1 });

module.exports =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);
