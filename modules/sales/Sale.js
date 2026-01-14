const mongoose = require("mongoose");

const saleItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    productSnapshot: {
      name: { type: String, required: true },
      model: { type: String },
      color: { type: String },
      category: { type: String },
      unit: { type: String, required: true },
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

    qty: { type: Number, required: true, min: 0.0001 },

    sell_price: { type: Number, required: true, min: 0 },
    buy_price: { type: Number, required: true, min: 0 },

    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, required: true, unique: true },
    saleDate: {
  type: Date,
  default: Date.now
}
,
    soldBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
    },

    customerSnapshot: {
      name: String,
      phone: String,
      address: String,
      note: String,
    },

    items: { type: [saleItemSchema], required: true },

    totals: {
      subtotal: Number,
      discount: Number,
      grandTotal: Number,
    },

    currencyTotals: {
      UZS: {
        subtotal: Number,
        discount: Number,
        grandTotal: Number,
        paidAmount: Number,
        debtAmount: Number,
      },
      USD: {
        subtotal: Number,
        discount: Number,
        grandTotal: Number,
        paidAmount: Number,
        debtAmount: Number,
      },
    },

    payments: [
      {
        currency: { type: String, enum: ["UZS", "USD"] },
        method: { type: String, enum: ["CASH", "CARD", "TRANSFER"] },
        amount: Number,
      },
    ],

    status: {
      type: String,
      enum: ["COMPLETED", "CANCELED", "DEBT", "PARTIALLY_PAID"],
      default: "COMPLETED",
    },

    note: String,

    canceledAt: Date,
    canceledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: String,
  },
  { timestamps: true }
);

module.exports = mongoose.models.Sale || mongoose.model("Sale", saleSchema);
