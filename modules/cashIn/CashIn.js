const mongoose = require("mongoose");

const cashInSchema = new mongoose.Schema(
  {
    /* =========================
       TARGET
    ========================= */
    target_type: {
      type: String,
      enum: ["CUSTOMER", "SUPPLIER"],
      required: true,
    },

    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },

    /* =========================
       AMOUNT & CURRENCY
    ========================= */
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isFinite(v) && v !== 0,
        message: "amount 0 bo‘lmasligi kerak",
      },
    },

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },

    /* =========================
       PAYMENT METHOD
    ========================= */
    payment_method: {
      type: String,
      enum: ["CASH", "CARD"],
      default: "CASH",
      required: true,
    },

    /* =========================
       META
    ========================= */
    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

/* =========================
   VALIDATION (MUHIM)
========================= */
cashInSchema.pre("validate", function (next) {
  // CUSTOMER bo‘lsa
  if (this.target_type === "CUSTOMER") {
    if (!this.customer_id) {
      return next(new Error("CUSTOMER uchun customer_id majburiy"));
    }
    this.supplier_id = null;
  }

  // SUPPLIER bo‘lsa
  if (this.target_type === "SUPPLIER") {
    if (!this.supplier_id) {
      return next(new Error("SUPPLIER uchun supplier_id majburiy"));
    }
    this.customer_id = null;
  }

  // payment_method fallback (extra safety)
  if (!this.payment_method) {
    this.payment_method = "CASH";
  }
});

module.exports =
  mongoose.models.CashIn || mongoose.model("CashIn", cashInSchema);
