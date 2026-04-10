const mongoose = require("mongoose");

const purchaseItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // 🔹 snapshot
    name: { type: String, required: true },
    model: { type: String, default: "" },
    unit: { type: String, enum: ["DONA", "PACHKA", "KG"], required: true },

    qty: { type: Number, required: true, min: 0 },
    buy_price: { type: Number, required: true, min: 0 },
    sell_price: { type: Number, required: true, min: 0 },

    currency: { type: String, enum: ["UZS", "USD"], required: true },

    // 🔥 item bo‘yicha summa
    row_total: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseSchema = new mongoose.Schema(
  {
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    // 🔥 REAL OLGAN SANA (ASOSIY)
    purchase_date: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    batch_no: {
      type: String,
      required: true,
      trim: true,
    },

    // 🔥 umumiy summa
    totals: {
      UZS: { type: Number, default: 0 },
      USD: { type: Number, default: 0 },
    },

    // 🔥 qancha to‘langan
    paid: {
      UZS: { type: Number, default: 0 },
      USD: { type: Number, default: 0 },
    },

    // 🔥 qolgan qarz (ASOSIY)
    remaining: {
      UZS: { type: Number, default: 0 },
      USD: { type: Number, default: 0 },
    },

    // 🔥 batch holati
    status: {
      type: String,
      enum: ["DEBT", "PARTIAL", "PAID"],
      default: "DEBT",
      index: true,
    },

    note: {
      type: String,
      default: "",
      trim: true,
    },

    items: {
      type: [purchaseItemSchema],
      required: true,
      validate: [
        (arr) => arr.length > 0,
        "Kamida 1 ta mahsulot bo‘lishi kerak",
      ],
    },

    editedAt: {
      type: Date,
      default: null,
    },

    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    editReason: {
      type: String,
      default: "",
    },

    revision: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Purchase", purchaseSchema);
