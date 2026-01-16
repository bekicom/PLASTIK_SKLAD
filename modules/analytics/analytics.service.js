const mongoose = require("mongoose");

const Sale = require("../sales/Sale");
const Expense = require("../expenses/Expense");
const Order = require("../orders/Order");
const Customer = require("../Customer/Customer");
const Supplier = require("../suppliers/Supplier");
const Product = require("../products/Product");
const CashIn = require("../cashIn/CashIn");
const Withdrawal = require("../withdrawals/Withdrawal");
const Purchase = require("../purchases/Purchase");

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
   OVERVIEW (DASHBOARD) - ✅ FIXED CASHFLOW
===================== */
async function getOverview({ from, to, tz, warehouseId }) {
  /* =====================
     HELPERS
  ===================== */
  const wid =
    warehouseId && mongoose.isValidObjectId(warehouseId)
      ? new mongoose.Types.ObjectId(warehouseId)
      : null;

  /* =====================
     SALES (UNIQUE SALE COUNT)
  ===================== */
  const saleMatch = {
    ...buildDateMatch(from, to, "createdAt"),
    status: "COMPLETED", // ✅ oltin qoida
  };

  // base pipeline: match + optional warehouse filter
  const salesBasePipeline = [{ $match: saleMatch }];

  if (wid) {
    salesBasePipeline.push(
      { $unwind: "$items" },
      { $match: { "items.warehouseId": wid } }
    );
  }

  // ✅ Unikal sale bo'yicha hisob (warehouseId bo'lsa ham 2x bo'lmaydi)
  const salesAgg = await Sale.aggregate([
    ...salesBasePipeline,

    // 1) unikal sale ga qaytaramiz
    {
      $group: {
        _id: "$_id",
        uzs_total: {
          $first: { $ifNull: ["$currencyTotals.UZS.grandTotal", 0] },
        },
        uzs_paid: {
          $first: { $ifNull: ["$currencyTotals.UZS.paidAmount", 0] },
        },
        usd_total: {
          $first: { $ifNull: ["$currencyTotals.USD.grandTotal", 0] },
        },
        usd_paid: {
          $first: { $ifNull: ["$currencyTotals.USD.paidAmount", 0] },
        },
      },
    },

    // 2) endi umumiy sum
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        uzs_total: { $sum: "$uzs_total" },
        uzs_paid: { $sum: "$uzs_paid" },
        usd_total: { $sum: "$usd_total" },
        usd_paid: { $sum: "$usd_paid" },
      },
    },
    { $project: { _id: 0 } },
  ]);

  const sales = salesAgg[0] || {
    count: 0,
    uzs_total: 0,
    uzs_paid: 0,
    usd_total: 0,
    usd_paid: 0,
  };

  /* =====================
     PROFIT
  ===================== */
  const profitPipeline = [{ $match: saleMatch }, { $unwind: "$items" }];

  if (wid) {
    profitPipeline.push({ $match: { "items.warehouseId": wid } });
  }

  const profitAgg = await Sale.aggregate([
    ...profitPipeline,
    {
      $group: {
        _id: null,
        UZS: {
          $sum: {
            $cond: [
              { $eq: ["$items.currency", "UZS"] },
              {
                $multiply: [
                  {
                    $subtract: [
                      { $ifNull: ["$items.sell_price", 0] },
                      { $ifNull: ["$items.buy_price", 0] },
                    ],
                  },
                  { $ifNull: ["$items.qty", 0] },
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
                  {
                    $subtract: [
                      { $ifNull: ["$items.sell_price", 0] },
                      { $ifNull: ["$items.buy_price", 0] },
                    ],
                  },
                  { $ifNull: ["$items.qty", 0] },
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
        _id: {
          currency: "$currency",
          method: { $ifNull: ["$payment_method", "CASH"] },
        },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const expenses = {
    UZS: { total: 0, count: 0, CASH: 0, CARD: 0 },
    USD: { total: 0, count: 0, CASH: 0, CARD: 0 },
  };

  for (const e of expensesAgg) {
    const { currency, method } = e._id || {};
    if (!currency || !expenses[currency]) continue;

    const t = Number(e.total || 0);
    const c = Number(e.count || 0);

    expenses[currency].total += t;
    expenses[currency].count += c;

    if (method === "CARD" || method === "CASH") {
      expenses[currency][method] += t;
    } else {
      // unknown method -> CASH ga qo‘shamiz (xohlasang alohida qilamiz)
      expenses[currency].CASH += t;
    }
  }

  /* =====================
     BALANCES
  ===================== */
  const balances = {
    customers: {
      debt: { UZS: 0, USD: 0 },
      prepaid: { UZS: 0, USD: 0 },
    },
    suppliers: {
      debt: { UZS: 0, USD: 0 },
      prepaid: { UZS: 0, USD: 0 },
    },
  };

  // CUSTOMER BALANCE (hozircha shu source)
  const customers = await Customer.find({}, { balance: 1 }).lean();
  for (const c of customers) {
    const bu = Number(c.balance?.UZS || 0);
    const bd = Number(c.balance?.USD || 0);

    if (bu > 0) balances.customers.debt.UZS += bu;
    else if (bu < 0) balances.customers.prepaid.UZS += Math.abs(bu);

    if (bd > 0) balances.customers.debt.USD += bd;
    else if (bd < 0) balances.customers.prepaid.USD += Math.abs(bd);
  }

  // ✅ SUPPLIER BALANCE (SOURCE OF TRUTH)
  const supplierBalanceAgg = await Supplier.aggregate([
    {
      $project: {
        debtUZS: { $cond: [{ $gt: ["$balance.UZS", 0] }, "$balance.UZS", 0] },
        debtUSD: { $cond: [{ $gt: ["$balance.USD", 0] }, "$balance.USD", 0] },
        prepaidUZS: {
          $cond: [{ $lt: ["$balance.UZS", 0] }, { $abs: "$balance.UZS" }, 0],
        },
        prepaidUSD: {
          $cond: [{ $lt: ["$balance.USD", 0] }, { $abs: "$balance.USD" }, 0],
        },
      },
    },
    {
      $group: {
        _id: null,
        debtUZS: { $sum: "$debtUZS" },
        debtUSD: { $sum: "$debtUSD" },
        prepaidUZS: { $sum: "$prepaidUZS" },
        prepaidUSD: { $sum: "$prepaidUSD" },
      },
    },
  ]);

  balances.suppliers.debt.UZS = Number(supplierBalanceAgg[0]?.debtUZS || 0);
  balances.suppliers.debt.USD = Number(supplierBalanceAgg[0]?.debtUSD || 0);
  balances.suppliers.prepaid.UZS = Number(
    supplierBalanceAgg[0]?.prepaidUZS || 0
  );
  balances.suppliers.prepaid.USD = Number(
    supplierBalanceAgg[0]?.prepaidUSD || 0
  );

  /* =====================
     CASH-IN SUMMARY
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
        _id: {
          target: "$target_type",
          currency: "$currency",
          method: { $ifNull: ["$payment_method", "CASH"] },
        },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const cash_in_summary = {
    customers: {
      UZS: { CASH: 0, CARD: 0 },
      USD: { CASH: 0, CARD: 0 },
    },
    suppliers: {
      UZS: { CASH: 0, CARD: 0 },
      USD: { CASH: 0, CARD: 0 },
    },
  };

  for (const r of cashInAgg) {
    const { target, currency, method } = r._id || {};
    const total = Number(r.total || 0);
    if (!target || !currency || !method) continue;

    if (target === "CUSTOMER" && cash_in_summary.customers[currency]) {
      if (method === "CASH" || method === "CARD")
        cash_in_summary.customers[currency][method] += total;
    }

    if (target === "SUPPLIER" && cash_in_summary.suppliers[currency]) {
      if (method === "CASH" || method === "CARD")
        cash_in_summary.suppliers[currency][method] += total;
    }
  }

  /* =====================
     INVESTOR WITHDRAWALS
  ===================== */
  const withdrawalAgg = await Withdrawal.aggregate([
    {
      $match: {
        ...buildDateMatch(from, to, "takenAt"),
        type: "INVESTOR_WITHDRAWAL",
      },
    },
    {
      $group: {
        _id: {
          currency: "$currency",
          method: { $ifNull: ["$payment_method", "CASH"] },
        },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const investor_withdrawals = {
    UZS: { total: 0, CASH: 0, CARD: 0 },
    USD: { total: 0, CASH: 0, CARD: 0 },
  };

  for (const w of withdrawalAgg) {
    const { currency, method } = w._id || {};
    const total = Number(w.total || 0);
    if (!currency || !investor_withdrawals[currency]) continue;

    if (method === "CASH" || method === "CARD") {
      investor_withdrawals[currency][method] += total;
      investor_withdrawals[currency].total += total;
    } else {
      investor_withdrawals[currency].CASH += total;
      investor_withdrawals[currency].total += total;
    }
  }

  /* =====================
     CASHFLOW (FIXED)
     ❗ Supplier payments EXCLUDED
  ===================== */
  const cashflowTotal = {
    UZS:
      cash_in_summary.customers.UZS.CASH +
      cash_in_summary.customers.UZS.CARD -
      expenses.UZS.total -
      investor_withdrawals.UZS.total,

    USD:
      cash_in_summary.customers.USD.CASH +
      cash_in_summary.customers.USD.CARD -
      expenses.USD.total -
      investor_withdrawals.USD.total,
  };

  return {
    sales,
    profit: {
      gross: profit,
      net: {
        UZS: profit.UZS - expenses.UZS.total,
        USD: profit.USD - expenses.USD.total,
      },
    },
    expenses,
    balances,
    cash_in_summary,
    investor_withdrawals,
    cashflow: {
      total: cashflowTotal,
      by_method: {
        UZS: {
          CASH:
            cash_in_summary.customers.UZS.CASH -
            expenses.UZS.CASH -
            investor_withdrawals.UZS.CASH,
          CARD:
            cash_in_summary.customers.UZS.CARD -
            expenses.UZS.CARD -
            investor_withdrawals.UZS.CARD,
        },
        USD: {
          CASH:
            cash_in_summary.customers.USD.CASH -
            expenses.USD.CASH -
            investor_withdrawals.USD.CASH,
          CARD:
            cash_in_summary.customers.USD.CARD -
            expenses.USD.CARD -
            investor_withdrawals.USD.CARD,
        },
      },
      breakdown: {
        expenses,
      },
    },
  };
}


/* =====================
   TIME SERIES
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

  const expRaw = await Expense.aggregate([
    { $match: buildDateMatch(from, to, "expense_date") },
    {
      $group: {
        _id: {
          date: { $dateTrunc: { date: "$expense_date", unit, timezone: tz } },
          currency: "$currency",
        },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  const map = new Map();
  for (const r of expRaw) {
    const key = new Date(r._id.date).toISOString();
    const row = map.get(key) || { date: r._id.date, UZS: 0, USD: 0 };
    row[r._id.currency] = r.total || 0;
    map.set(key, row);
  }

  const expenses = Array.from(map.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  const orders = await Order.aggregate([
    { $match: buildDateMatch(from, to, "createdAt") },
    {
      $group: {
        _id: { $dateTrunc: { date: "$createdAt", unit, timezone: tz } },
        count: { $sum: 1 },
        confirmed: {
          $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] },
        },
        canceled: { $sum: { $cond: [{ $eq: ["$status", "CANCELED"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: "$_id", count: 1, confirmed: 1, canceled: 1 } },
  ]);

  return { group, sales, expenses, orders };
}

/* =====================
   TOP PRODUCTS
===================== */
async function getTop({ from, to, limit = 10 }) {
  return Sale.aggregate([
    {
      $match: {
        ...buildDateMatch(from, to, "createdAt"),
        status: "COMPLETED",
      },
    },

    { $unwind: "$items" },

    {
      $group: {
        _id: "$items.productId",
        qty: { $sum: "$items.qty" },
      },
    },

    { $sort: { qty: -1 } },

    { $limit: limit },

    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },

    { $unwind: "$product" },

    {
      $project: {
        _id: 0,
        product_id: "$product._id",
        name: "$product.name",
        model: "$product.model",
        category: "$product.category",
        unit: "$product.unit",
        qty: 1,
      },
    },
  ]);
}

/* =====================
   STOCK
===================== */
async function getStock() {
  const byCurrency = await Product.aggregate([
    {
      $group: {
        _id: "$warehouse_currency",

        sku: { $sum: 1 },

        total_qty: { $sum: "$qty" },

        valuation_buy: {
          $sum: { $multiply: ["$qty", "$buy_price"] },
        },

        valuation_sell: {
          $sum: { $multiply: ["$qty", "$sell_price"] },
        },
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
