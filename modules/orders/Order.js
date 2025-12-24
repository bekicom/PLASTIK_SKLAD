const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // snapshot (tarix saqlash uchun)
    name_snapshot: {
      type: String,
      required: true,
      trim: true,
    },

    unit_snapshot: {
      type: String, // kg / dona
      trim: true,
    },

    qty: {
      type: Number,
      required: true,
      min: 0.000001,
    },

    price_snapshot: {
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

const OrderSchema = new mongoose.Schema(
  {
    // kim zakas berdi
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // qaysi ombordan
    warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
      index: true,
    },

    items: {
      type: [OrderItemSchema],
      default: [],
    },

    total: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["NEW", "CONFIRMED", "CANCELED"],
      default: "NEW",
      index: true,
    },

    note: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // kassir tasdiqlaganda
    confirmedAt: Date,
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // bekor qilinsa
    canceledAt: Date,
    canceledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    cancelReason: {
      type: String,
      trim: true,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

// indexlar (tezkor filter uchun)
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ agent_id: 1, createdAt: -1 });
OrderSchema.index({ warehouse_id: 1, createdAt: -1 });

module.exports = mongoose.model("Order", OrderSchema);
