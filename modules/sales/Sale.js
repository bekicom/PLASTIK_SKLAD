// modules/sales/Sale.js
const mongoose = require("mongoose");

/* =========================
   SALE ITEM
========================= */
const saleItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    productSnapshot: {
      name: String,
      model: String,
      color: String,
      category: String,
      unit: String,
      images: [String],
    },

    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },

    qty: {
      type: Number,
      required: true,
      min: 0,
    },

    sell_price: {
      type: Number,
      required: true,
      min: 0,
    },

    buy_price: {
      type: Number,
      required: true,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

/* =========================
   CURRENCY TOTAL
========================= */
const currencyTotalSchema = new mongoose.Schema(
  {
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },

    paidAmount: { type: Number, default: 0 },
    debtAmount: { type: Number, default: 0 },
  },
  { _id: false }
);

/* =========================
   SALE
========================= */
const saleSchema = new mongoose.Schema(
  {
    invoiceNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    saleDate: {
      type: Date,
      required: true,
      index: true,
    },

    soldBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // agar walk-in bo‘lsa null
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    // agar customer keyin o‘chsa ham tarix qoladi
    customerSnapshot: {
      name: String,
      phone: String,
      address: String,
      note: String,
    },

    items: {
      type: [saleItemSchema],
      required: true,
    },

    totals: {
      subtotal: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
    },

    currencyTotals: {
      UZS: { type: currencyTotalSchema, default: () => ({}) },
      USD: { type: currencyTotalSchema, default: () => ({}) },
    },

    status: {
      type: String,
      enum: ["COMPLETED", "CANCELED", "DELETED"],
      default: "COMPLETED",
      index: true,
    },

    note: {
      type: String,
      default: "",
    },

    canceledAt: {
      type: Date,
      default: null,
    },

    cancelReason: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

/* =========================
   INDEXES
========================= */
saleSchema.index({ saleDate: -1 });
saleSchema.index({ customerId: 1, saleDate: -1 });

module.exports = mongoose.models.Sale || mongoose.model("Sale", saleSchema);
