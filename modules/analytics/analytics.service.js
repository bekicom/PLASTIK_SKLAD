const mongoose = require("mongoose");

const Sale = require("../sales/Sale");
const Expense = require("../expenses/Expense");
const Order = require("../orders/Order");
const Customer = require("../Customer/Customer");
const Supplier = require("../suppliers/Supplier");
const Product = require("../products/Product");
const CashIn = require("../cashIn/CashIn");
const Withdrawal = require("../withdrawals/Withdrawal");

/* =====================
   HELPERS
===================== */
function buildDateMatch(from, to, field = "createdAt") {
  const m = {};
  if (from || to) {
    m[field] = {};
    if (from) m[field].$gte = from;
    if (to) m[field].$lte = to;
  }
  return m;
}

/* =====================
   OVERVIEW (DASHBOARD)
===================== */
async function getOverview({ from, to, tz, warehouseId }) {
  /* =====================
     SALES
  ===================== */
  const saleMatch = {
    ...buildDateMatch(from, to, "createdAt"),
    status: "COMPLETED",
  };

  let salesPipeline = [{ $match: saleMatch }];

  if (warehouseId && mongoose.isValidObjectId(warehouseId)) {
    salesPipeline.push(
      { $unwind: "$items" },
      {
        $match: {
          "items.warehouseId": new mongoose.Types.ObjectId(warehouseId),
        },
      }
    );
  }

  const salesAgg = await Sale.aggregate([
    ...salesPipeline,
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
     PROFIT (GROSS)
  ===================== */
  const profitAgg = await Sale.aggregate([
    ...salesPipeline,
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

  const expenses = {
    UZS: { total: 0, count: 0 },
    USD: { total: 0, count: 0 },
  };

  for (const r of expensesAgg) {
    if (r._id === "UZS") expenses.UZS = r;
    if (r._id === "USD") expenses.USD = r;
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

  for (const o of ordersAgg) {
    if (orders[o._id]) orders[o._id] = o;
  }

  /* =====================
     BALANCES (CUSTOMER / SUPPLIER)
  ===================== */
  const balances = {
    customers: { debt: { UZS: 0, USD: 0 }, prepaid: { UZS: 0, USD: 0 } },
    suppliers: { debt: { UZS: 0, USD: 0 }, prepaid: { UZS: 0, USD: 0 } },
  };

  const customers = await Customer.find(
    { isActive: true },
    { balance: 1 }
  ).lean();
  for (const c of customers) {
    if (c.balance?.UZS > 0) balances.customers.debt.UZS += c.balance.UZS;
    if (c.balance?.UZS < 0)
      balances.customers.prepaid.UZS += Math.abs(c.balance.UZS);
    if (c.balance?.USD > 0) balances.customers.debt.USD += c.balance.USD;
    if (c.balance?.USD < 0)
      balances.customers.prepaid.USD += Math.abs(c.balance.USD);
  }

  const suppliers = await Supplier.find({}, { balance: 1 }).lean();
  for (const s of suppliers) {
    if (s.balance?.UZS > 0) balances.suppliers.debt.UZS += s.balance.UZS;
    if (s.balance?.UZS < 0)
      balances.suppliers.prepaid.UZS += Math.abs(s.balance.UZS);
    if (s.balance?.USD > 0) balances.suppliers.debt.USD += s.balance.USD;
    if (s.balance?.USD < 0)
      balances.suppliers.prepaid.USD += Math.abs(s.balance.USD);
  }

  /* =====================
     CASH-IN (CUSTOMER / SUPPLIER)
===================== */
  const cashInAgg = await CashIn.aggregate([
    {
      $match: {
        ...buildDateMatch(from, to, "createdAt"),
        amount: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: "$currency",
        customer_in: {
          $sum: {
            $cond: [{ $eq: ["$target_type", "CUSTOMER"] }, "$amount", 0],
          },
        },
        supplier_out: {
          $sum: {
            $cond: [{ $eq: ["$target_type", "SUPPLIER"] }, "$amount", 0],
          },
        },
      },
    },
  ]);

  const cashInFlow = {
    UZS: { in: 0, out: 0 },
    USD: { in: 0, out: 0 },
  };

  for (const r of cashInAgg) {
    if (r._id === "UZS") {
      cashInFlow.UZS.in = r.customer_in || 0;
      cashInFlow.UZS.out = r.supplier_out || 0;
    }
    if (r._id === "USD") {
      cashInFlow.USD.in = r.customer_in || 0;
      cashInFlow.USD.out = r.supplier_out || 0;
    }
  }

  /* =====================
     INVESTOR WITHDRAWALS
  ===================== */
  const withdrawalsAgg = await Withdrawal.aggregate([
    { $match: buildDateMatch(from, to, "takenAt") },
    {
      $group: {
        _id: "$currency",
        total: { $sum: "$amount" },
      },
    },
  ]);

  const withdrawals = { UZS: 0, USD: 0 };
  for (const w of withdrawalsAgg) {
    if (w._id === "UZS") withdrawals.UZS = w.total || 0;
    if (w._id === "USD") withdrawals.USD = w.total || 0;
  }

  /* =====================
     CASHFLOW (FINAL, REAL)
  ===================== */
  const cashflow = {
    UZS:
      (sales.uzs_paid || 0) +
      cashInFlow.UZS.in -
      cashInFlow.UZS.out -
      (expenses.UZS.total || 0) -
      withdrawals.UZS,

    USD:
      (sales.usd_paid || 0) +
      cashInFlow.USD.in -
      cashInFlow.USD.out -
      (expenses.USD.total || 0) -
      withdrawals.USD,
  };

  const net_profit = {
    UZS: (profit.UZS || 0) - (expenses.UZS.total || 0),
    USD: (profit.USD || 0) - (expenses.USD.total || 0),
  };

  return {
    range: { from, to, tz, warehouseId },

    sales,

    profit: {
      gross: profit,
      net: net_profit,
    },

    expenses,
    orders,
    balances,

    cashflow: {
      total: cashflow,
      breakdown: {
        cash_in: cashInFlow,
        expenses,
        withdrawals,
      },
    },
  };
}

/* =====================
   TIME SERIES
===================== */
async function getTimeSeries({ from, to, tz, group }) {
  const unit = group === "month" ? "month" : "day";

  return Sale.aggregate([
    { $match: { ...buildDateMatch(from, to), status: "COMPLETED" } },
    {
      $group: {
        _id: { $dateTrunc: { date: "$createdAt", unit, timezone: tz } },
        uzs: { $sum: "$currencyTotals.UZS.paidAmount" },
        usd: { $sum: "$currencyTotals.USD.paidAmount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

/* =====================
   TOP PRODUCTS
===================== */
async function getTop({ from, to, limit }) {
  return Sale.aggregate([
    { $match: { ...buildDateMatch(from, to), status: "COMPLETED" } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.productId",
        qty: { $sum: "$items.qty" },
      },
    },
    { $sort: { qty: -1 } },
    { $limit: limit },
  ]);
}

/* =====================
   STOCK
===================== */
async function getStock() {
  return Product.aggregate([
    {
      $group: {
        _id: "$warehouse_currency",
        total_qty: { $sum: "$qty" },
      },
    },
  ]);
}

module.exports = {
  getOverview,
  getTimeSeries,
  getTop,
  getStock,
};
