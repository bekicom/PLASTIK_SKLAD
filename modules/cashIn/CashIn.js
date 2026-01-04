const mongoose = require("mongoose");

const cashInSchema = new mongoose.Schema(
  {
    // Kim bilan bog‘liq to‘lov
    target_type: {
      type: String,
      enum: ["CUSTOMER", "SUPPLIER"],
      required: true,
    },

    // Mijoz bo‘lsa
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    // Zavod bo‘lsa
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },

    // To‘lov summasi
    amount: {
      type: Number,
      required: true,
      
    },

    // Valyuta
    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },
  },
  { timestamps: true }
);

/* =========================
   VALIDATION (MUHIM)
========================= */
cashInSchema.pre("validate", function (next) {
  if (this.target_type === "CUSTOMER") {
    if (!this.customer_id) {
      return next(new Error("CUSTOMER uchun customer_id majburiy"));
    }
    this.supplier_id = null;
  }

  if (this.target_type === "SUPPLIER") {
    if (!this.supplier_id) {
      return next(new Error("SUPPLIER uchun supplier_id majburiy"));
    }
    this.customer_id = null;
  }


});

module.exports =
  mongoose.models.CashIn || mongoose.model("CashIn", cashInSchema);
