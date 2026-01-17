// modules/appCustomer/AppCustomer.js
const mongoose = require("mongoose");

const appCustomerSchema = new mongoose.Schema(
  {
    full_name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "BLOCKED"],
      default: "PENDING",
      index: true,
    },

    // 🔐 AUTH (OTP / TOKEN uchun tayyor)
    last_login_at: {
      type: Date,
    },

    // 🔹 kelajak uchun
    note: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// 🔥 indexlar
appCustomerSchema.index({ phone: 1 });

module.exports = mongoose.model("AppCustomer", appCustomerSchema);
