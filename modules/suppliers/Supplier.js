const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    phone: { type: String, required: true, unique: true, trim: true },

    total_debt_uzs: { type: Number, default: 0, min: 0 },
    total_debt_usd: { type: Number, default: 0, min: 0 },

    payment_history: [
      new mongoose.Schema(
        {
          currency: { type: String, enum: ["UZS", "USD"], required: true },

          // ✅ ikkalasi ham bo‘ladi (bittasi 0 bo‘ladi)
          amount_uzs: { type: Number, default: 0, min: 0 },
          amount_usd: { type: Number, default: 0, min: 0 },

          date: { type: Date, default: Date.now },
          note: { type: String, default: "" },
        },
        { _id: true }
      ),
    ],
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Supplier || mongoose.model("Supplier", supplierSchema);
