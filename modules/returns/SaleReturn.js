const mongoose = require("mongoose");

const SaleReturnItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    qty: { type: Number, required: true, min: 0.000001 },

    // Sale ichidagi narx snapshot (return hisob-kitobi uchun)
    price: { type: Number, required: true, min: 0 },

    subtotal: { type: Number, required: true, min: 0 },

    reason: { type: String, trim: true },
  },
  { _id: false }
);

const SaleReturnSchema = new mongoose.Schema(
  {
    sale_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
      required: true,
      index: true,
    },
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
      index: true,
    },

    items: { type: [SaleReturnItemSchema], required: true },

    returnSubtotal: { type: Number, required: true, min: 0 },

    refund_type: {
      type: String,
      enum: ["CASH", "BALANCE", "NO_REFUND"],
      required: true,
    },
    refund_amount: { type: Number, default: 0, min: 0 },

    note: { type: String, trim: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SaleReturn || mongoose.model("SaleReturn", SaleReturnSchema);
