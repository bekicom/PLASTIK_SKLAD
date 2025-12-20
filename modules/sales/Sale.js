// models/Sale.js
const mongoose = require("mongoose");

const saleItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    // Fakturada product nomi keyin o'zgarsa ham, eski nom saqlanib qoladi
    nameSnapshot: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Qaysi ombordan chiqdi (USD yoki UZS warehouse)
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
      index: true,
    },

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
      index: true,
    },

    qty: {
      type: Number,
      required: true,
      min: 0.0001,
    },

    // 1 dona narx (shu item.currency bo'yicha)
    price: {
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

const saleSchema = new mongoose.Schema(
  {
    invoiceNo: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 50,
    },

    // Kassir (User)
    soldBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Customer tanlangan bo'lsa
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: false,
      index: true,
    },

    // Customer sale paytida tez kiritilsa (tezkor)
    customerSnapshot: {
      name: { type: String, trim: true, maxlength: 120 },
      phone: { type: String, trim: true, maxlength: 30 },
      address: { type: String, trim: true, maxlength: 250 },
      note: { type: String, trim: true, maxlength: 300 },
    },

    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "Items bo'sh bo'lishi mumkin emas",
      },
    },

    totals: {
      // barcha item subtotallari yig'indisi (currency aralash bo'lishi mumkin)
      // shuning uchun quyida currencyTotals ham bor
      subtotal: { type: Number, required: true, min: 0 },
      discount: { type: Number, default: 0, min: 0 },
      grandTotal: { type: Number, required: true, min: 0 },
    },

    // currency bo'yicha ajratib totals saqlab qo'yamiz (USD/UZS aralash savdo bo'lsa kerak bo'ladi)
    currencyTotals: {
      UZS: {
        subtotal: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        grandTotal: { type: Number, default: 0, min: 0 },
        paidAmount: { type: Number, default: 0, min: 0 },
        debtAmount: { type: Number, default: 0, min: 0 },
      },
      USD: {
        subtotal: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        grandTotal: { type: Number, default: 0, min: 0 },
        paidAmount: { type: Number, default: 0, min: 0 },
        debtAmount: { type: Number, default: 0, min: 0 },
      },
    },

    // To'lovlarni ham currency bo'yicha ajratamiz
    payments: [
      {
        currency: {
          type: String,
          enum: ["UZS", "USD"],
          required: true,
          index: true,
        },
        method: {
          type: String,
          enum: ["CASH", "CARD", "TRANSFER"],
          required: true,
        },
        amount: { type: Number, required: true, min: 0 },
      },
    ],

    // umumiy status
    status: {
      type: String,
      enum: ["COMPLETED", "CANCELED"],
      default: "COMPLETED",
      index: true,
    },

    note: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    canceledAt: { type: Date },
    canceledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

// Indexlar
saleSchema.index({ createdAt: -1 });
saleSchema.index({ soldBy: 1, createdAt: -1 });
saleSchema.index({ customerId: 1, createdAt: -1 });
saleSchema.index({ status: 1, createdAt: -1 });
// Qaysi ombordan ko'p sotilganini tez olish uchun
saleSchema.index({ "items.warehouseId": 1, createdAt: -1 });
module.exports = mongoose.models.Sale || mongoose.model("Sale", saleSchema);

