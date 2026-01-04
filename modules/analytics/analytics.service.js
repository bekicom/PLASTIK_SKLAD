const mongoose = require("mongoose");

const Sale = require("../sales/Sale");
const Expense = require("../expenses/Expense");
const Order = require("../orders/Order");
const Customer = require("../Customer/Customer");
const Supplier = require("../suppliers/Supplier");
const Product = require("../products/Product");

function buildDateMatch(from, to, field = "createdAt") {
  const m = {};
  if (from || to) {
    m[field] = {};
    if (from) m[field].$gte = from;
    if (to) m[field].$lte = to;
  }
  return m;
}

async function getOverview({ from, to, tz, warehouseId }) {
  /* =====================
     SALES SUMMARY
  ===================== */
  const saleMatch = {
    ...buildDateMatch(from, to, "createdAt"),
    status: "COMPLETED",
  };

  if (warehouseId && mongoose.isValidObjectId(warehouseId)) {
    saleMatch["items.warehouseId"] = new mongoose.Types.ObjectId(warehouseId);
  }

  const salesAgg = await Sale.aggregate([
    { $match: saleMatch },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },

        uzs_total: { $sum: "$currencyTotals.UZS.grandTotal" },
        uzs_paid: { $sum: "$currencyTotals.UZS.paidAmount" },
        uzs_discount: { $sum: "$currencyTotals.UZS.discount" },

        usd_total: { $sum: "$currencyTotals.USD.grandTotal" },
        usd_paid: { $sum: "$currencyTotals.USD.paidAmount" },
        usd_discount: { $sum: "$currencyTotals.USD.discount" },
      },
    },
    { $project: { _id: 0 } },
  ]);

  const sales = salesAgg[0] || {
    count: 0,
    uzs_total: 0,
    uzs_paid: 0,
    uzs_discount: 0,
    usd_total: 0,
    usd_paid: 0,
    usd_discount: 0,
  };

  /* =====================
     PROFIT
  ===================== */
  const profitAgg = await Sale.aggregate([
    { $match: saleMatch },
    { $unwind: "$items" },
    {
      $group: {
        _id: null,
        UZS: {
          $sum: {
            $cond: [
              { $eq: ["$items.currency", "UZS"] },
              {
                $multiply: [
                  { $subtract: ["$items.sell_price", "$items.buy_price"] },
                  "$items.qty",
                ],
              },
              0,
            ],
          },
        },
        USD: {
          $sum: {
            $cond: [
              { $eq: ["$items.currency", "USD"] },
              {
                $multiply: [
                  { $subtract: ["$items.sell_price", "$items.buy_price"] },
                  "$items.qty",
                ],
              },
              0,
            ],
          },
        },
      },
    },
    { $project: { _id: 0 } },
  ]);

  const profit = profitAgg[0] || { UZS: 0, USD: 0 };

  /* =====================
     EXPENSES
  ===================== */
  const expensesAgg = await Expense.aggregate([
    { $match: buildDateMatch(from, to, "expense_date") },
    {
      $group: {
        _id: "$currency",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const expenses = { UZS: { total: 0, count: 0 }, USD: { total: 0, count: 0 } };
  for (const r of expensesAgg) {
    if (r._id === "UZS")
      expenses.UZS = { total: r.total || 0, count: r.count || 0 };
    if (r._id === "USD")
      expenses.USD = { total: r.total || 0, count: r.count || 0 };
  }

  /* =====================
     ORDERS
  ===================== */
  const ordersAgg = await Order.aggregate([
    { $match: buildDateMatch(from, to, "createdAt") },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        total_uzs: { $sum: "$total_uzs" },
        total_usd: { $sum: "$total_usd" },
      },
    },
  ]);

  const orders = {
    NEW: { count: 0, total_uzs: 0, total_usd: 0 },
    CONFIRMED: { count: 0, total_uzs: 0, total_usd: 0 },
    CANCELED: { count: 0, total_uzs: 0, total_usd: 0 },
  };
  for (const r of ordersAgg) {
    if (orders[r._id]) {
      orders[r._id] = {
        count: r.count || 0,
        total_uzs: r.total_uzs || 0,
        total_usd: r.total_usd || 0,
      };
    }
  }

  /* =====================
     SUPPLIER BALANCE
  ===================== */
  const suppliers = await Supplier.find({}, { balance: 1 }).lean();

  let supplierDebtUZS = 0;
  let supplierDebtUSD = 0;
  let supplierPrepaidUZS = 0;
  let supplierPrepaidUSD = 0;

  for (const s of suppliers) {
    const uzs = Number(s.balance?.UZS || 0);
    const usd = Number(s.balance?.USD || 0);

    if (uzs > 0) supplierDebtUZS += uzs;
    if (uzs < 0) supplierPrepaidUZS += Math.abs(uzs);

    if (usd > 0) supplierDebtUSD += usd;
    if (usd < 0) supplierPrepaidUSD += Math.abs(usd);
  }

  /* =====================
     CUSTOMER BALANCE
  ===================== */
  const customers = await Customer.find(
    { isActive: true },
    { balance: 1 }
  ).lean();

  let customerDebtUZS = 0;
  let customerDebtUSD = 0;

  for (const c of customers) {
    const uzs = Number(c.balance?.UZS || 0);
    const usd = Number(c.balance?.USD || 0);

    if (uzs > 0) customerDebtUZS += uzs;
    if (usd > 0) customerDebtUSD += usd;
  }

  /* =====================
     CASHFLOW
  ===================== */
  const cashflow = {
    UZS: (sales.uzs_paid || 0) - (expenses.UZS.total || 0),
    USD: (sales.usd_paid || 0) - (expenses.USD.total || 0),
  };

  return {
    range: { from, to, tz, warehouseId },

    sales,
    profit,
    expenses,
    orders,

    balances: {
      suppliers: {
        debt: { UZS: supplierDebtUZS, USD: supplierDebtUSD },
        prepaid: { UZS: supplierPrepaidUZS, USD: supplierPrepaidUSD },
      },
      customers: {
        receivable: { UZS: customerDebtUZS, USD: customerDebtUSD },
      },
    },

    cashflow,
  };
}

/* =====================
   QOLGAN FUNKSIYALAR
   (deyarli o‘zgarmadi)
===================== */

async function getTimeSeries({ from, to, tz, group }) {
  const unit = group === "month" ? "month" : "day";

  const sales = await Sale.aggregate([
    {
      $match: { ...buildDateMatch(from, to, "createdAt"), status: "COMPLETED" },
    },
    {
      $group: {
        _id: { $dateTrunc: { date: "$createdAt", unit, timezone: tz } },
        count: { $sum: 1 },
        uzs_total: { $sum: "$currencyTotals.UZS.grandTotal" },
        usd_total: { $sum: "$currencyTotals.USD.grandTotal" },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: { _id: 0, date: "$_id", count: 1, uzs_total: 1, usd_total: 1 },
    },
  ]);

  return { group, sales };
}

async function getTop({ from, to, tz, type, limit }) {
  if (type === "customers") {
    return Customer.find({ isActive: true })
      .sort({ "balance.UZS": -1, "balance.USD": -1 })
      .limit(limit)
      .select("name phone balance")
      .lean();
  }

  return Sale.aggregate([
    {
      $match: { ...buildDateMatch(from, to, "createdAt"), status: "COMPLETED" },
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.productId",
        qty: { $sum: "$items.qty" },
        uzs_sum: {
          $sum: {
            $cond: [{ $eq: ["$items.currency", "UZS"] }, "$items.subtotal", 0],
          },
        },
        usd_sum: {
          $sum: {
            $cond: [{ $eq: ["$items.currency", "USD"] }, "$items.subtotal", 0],
          },
        },
      },
    },
    { $sort: { uzs_sum: -1, usd_sum: -1, qty: -1 } },
    { $limit: limit },
  ]);
}

async function getStock() {
  const byCurrency = await Product.aggregate([
    {
      $group: {
        _id: "$warehouse_currency",
        sku: { $sum: 1 },
        total_qty: { $sum: "$qty" },
        valuation_buy: { $sum: { $multiply: ["$qty", "$buy_price"] } },
        valuation_sell: { $sum: { $multiply: ["$qty", "$sell_price"] } },
      },
    },
    {
      $project: {
        _id: 0,
        currency: "$_id",
        sku: 1,
        total_qty: 1,
        valuation_buy: 1,
        valuation_sell: 1,
      },
    },
  ]);

  return { byCurrency };
}

module.exports = {
  getOverview,
  getTimeSeries,
  getTop,
  getStock,
};
