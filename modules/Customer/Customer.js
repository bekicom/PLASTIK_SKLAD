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

    // ✅ Qarzdorlik (running balance)
    total_debt_uzs: { type: Number, default: 0, min: 0, index: true },
    total_debt_usd: { type: Number, default: 0, min: 0, index: true },

    // Soft delete
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

customerSchema.index({ name: 1, phone: 1 });

module.exports =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);
