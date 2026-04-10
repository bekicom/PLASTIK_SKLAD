const mongoose = require("mongoose");

const inventoryRevaluationSchema = new mongoose.Schema(
  {
    purchase_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchase",
      required: true,
      index: true,
    },
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
      default: Date.now,
    },
    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
      index: true,
    },
    product: {
      name: { type: String, required: true, trim: true },
      model: { type: String, default: "", trim: true },
      color: { type: String, default: "", trim: true },
      category: { type: String, default: "", trim: true },
      unit: { type: String, default: "", trim: true },
    },
    existing_qty: {
      type: Number,
      required: true,
      min: 0,
    },
    incoming_buy_price: {
      type: Number,
      required: true,
      min: 0,
    },
    old_avg_buy_price: {
      type: Number,
      required: true,
      min: 0,
    },
    delta_profit: {
      type: Number,
      required: true,
      default: 0,
    },
    kind: {
      type: String,
      enum: ["GAIN", "LOSS"],
      required: true,
      index: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

inventoryRevaluationSchema.index({
  date: -1,
  currency: 1,
  "product.name": 1,
  purchase_id: 1,
});

module.exports =
  mongoose.models.InventoryRevaluation ||
  mongoose.model("InventoryRevaluation", inventoryRevaluationSchema);
