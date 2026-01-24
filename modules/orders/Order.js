const mongoose = require("mongoose");

/* =========================
   ORDER ITEM
========================= */
const OrderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    product_snapshot: {
      name: { type: String, required: true, trim: true },
      model: { type: String, default: null, trim: true },
      color: { type: String, default: null, trim: true },
      category: { type: String, default: null, trim: true },
      unit: { type: String, required: true, trim: true },
      images: [{ type: String }],
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

    currency_snapshot: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
    },
  },
  { _id: false },
);

/* =========================
   ORDER
========================= */
const OrderSchema = new mongoose.Schema(
  {
    /* =========================
       SOURCE (QAYERDAN KELGAN)
    ========================= */
    source: {
      type: String,
      enum: ["MOBILE", "AGENT", "ADMIN"],
      required: true,
      index: true,
    },

    /* =========================
       RELATIONS
    ========================= */
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return this.source === "AGENT";
      },
      index: true,
      default: null,
    },

    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    /* =========================
       ITEMS
    ========================= */
    items: {
      type: [OrderItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "Order items bo'sh bo'lishi mumkin emas",
      },
    },

    /* =========================
       TOTALS (AUTO CALCULATED)
       ⚠️ UZS va USD ALOHIDA!
    ========================= */
    total_uzs: { type: Number, default: 0, min: 0, index: true },
    total_usd: { type: Number, default: 0, min: 0, index: true },

    /* =========================
       STATUS FLOW
    ========================= */
    status: {
      type: String,
      enum: ["NEW", "CONFIRMED", "CANCELED"],
      default: "NEW",
      index: true,
    },

    /* =========================
       SALE LINK (CONFIRM qilingandan keyin)
    ========================= */
    sale_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
      default: null,
      index: true,
    },

    /* =========================
       NOTE
    ========================= */
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    /* =========================
       CONFIRM META
    ========================= */
    confirmedAt: { type: Date, default: null },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /* =========================
       CANCEL META
    ========================= */
    canceledAt: { type: Date, default: null },
    canceledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancelReason: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
  },
  { timestamps: true },
);

/* =========================
   PRE SAVE → TOTALS AUTO
   ✅ UZS va USD ALOHIDA HISOBLANADI
========================= */
OrderSchema.pre("save", function (next) {
  let uzs = 0;
  let usd = 0;

  for (const it of this.items || []) {
    if (it.currency_snapshot === "UZS") uzs += it.subtotal;
    if (it.currency_snapshot === "USD") usd += it.subtotal;
  }

  this.total_uzs = uzs;
  this.total_usd = usd;

  
});

/* =========================
   INDEXES (PERFORMANCE)
========================= */
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ agent_id: 1, createdAt: -1 });
OrderSchema.index({ customer_id: 1, createdAt: -1 });
OrderSchema.index({ status: 1, source: 1 });
OrderSchema.index({ sale_id: 1 });

module.exports = mongoose.model("Order", OrderSchema);
