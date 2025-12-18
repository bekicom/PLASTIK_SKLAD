const mongoose = require("mongoose");

const warehouseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    currency: {
      type: String,
      enum: ["UZS", "USD"],
      required: true,
      unique: true, // UZS bitta, USD bitta bo‘lishi uchun
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Warehouse", warehouseSchema);
