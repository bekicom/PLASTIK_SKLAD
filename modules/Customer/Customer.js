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

    // ✅ TO‘LOV TARIXI (YANGI)
    payment_history: [
      new mongoose.Schema(
        {
          currency: { type: String, enum: ["UZS", "USD"], required: true },

          // doim ikkalasi bo‘ladi, bittasi 0
          amount_uzs: { type: Number, default: 0, min: 0 },
          amount_usd: { type: Number, default: 0, min: 0 },

          note: { type: String, default: "" },
          date: { type: Date, default: Date.now },

          // qaysi sotuvlardan yopildi (hisobot uchun MUHIM)
          allocations: [
            {
              sale_id: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Sale",
                required: true,
              },
              applied: { type: Number, required: true, min: 0 },
              before_debt: { type: Number, default: 0 },
              after_debt: { type: Number, default: 0 },
            },
          ],
        },
        { _id: true }
      ),
    ],

    // Soft delete
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

customerSchema.index({ name: 1, phone: 1 });

module.exports =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);
