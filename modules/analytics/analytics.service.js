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
   OVERVIEW (DASHBOARD) - ✅ FIXED CASHFLOW
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

        usd_total: { $sum: "$currencyTotals.USD.grandTotal" },
        usd_paid: { $sum: "$currencyTotals.USD.paidAmount" },
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
     EXPENSES (WITH COUNT)
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
  for (const e of expensesAgg) {
    expenses[e._id] = {
      total: e.total || 0,
      count: e.count || 0,
    };
  }

  /* =====================
     BALANCES (REAL)
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

  const customers = await Customer.find({}, { balance: 1 }).lean();
  for (const c of customers) {
    if (c.balance?.UZS > 0) {
      balances.customers.debt.UZS += c.balance.UZS;
    } else if (c.balance?.UZS < 0) {
      balances.customers.prepaid.UZS += Math.abs(c.balance.UZS);
    }

    if (c.balance?.USD > 0) {
      balances.customers.debt.USD += c.balance.USD;
    } else if (c.balance?.USD < 0) {
      balances.customers.prepaid.USD += Math.abs(c.balance.USD);
    }
  }

  const suppliers = await Supplier.find({}, { balance: 1 }).lean();
  for (const s of suppliers) {
    if (s.balance?.UZS > 0) {
      balances.suppliers.debt.UZS += s.balance.UZS;
    } else if (s.balance?.UZS < 0) {
      balances.suppliers.prepaid.UZS += Math.abs(s.balance.UZS);
    }

    if (s.balance?.USD > 0) {
      balances.suppliers.debt.USD += s.balance.USD;
    } else if (s.balance?.USD < 0) {
      balances.suppliers.prepaid.USD += Math.abs(s.balance.USD);
    }
  }

  /* =====================
     CASH-IN SUMMARY (CUSTOMER / SUPPLIER + CASH / CARD)
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
          target: "$target_type", // CUSTOMER | SUPPLIER
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
    const { target, currency, method } = r._id;
    if (target === "CUSTOMER") {
      cash_in_summary.customers[currency][method] += r.total;
    }
    if (target === "SUPPLIER") {
      cash_in_summary.suppliers[currency][method] += r.total;
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
        _id: "$currency",
        total: { $sum: "$amount" },
      },
    },
  ]);

  const investor_withdrawals = { UZS: 0, USD: 0 };
  for (const w of withdrawalAgg) {
    investor_withdrawals[w._id] = w.total || 0;
  }

  /* =====================
     CASHFLOW CALCULATION
  ===================== */

  // Cash IN (customers to'lagan)
  const cashInTotal = {
    UZS:
      cash_in_summary.customers.UZS.CASH + cash_in_summary.customers.UZS.CARD,
    USD:
      cash_in_summary.customers.USD.CASH + cash_in_summary.customers.USD.CARD,
  };

  // Cash OUT (suppliers ga to'langan)
  const cashOutTotal = {
    UZS:
      cash_in_summary.suppliers.UZS.CASH + cash_in_summary.suppliers.UZS.CARD,
    USD:
      cash_in_summary.suppliers.USD.CASH + cash_in_summary.suppliers.USD.CARD,
  };

  // By method (CASH va CARD bo'yicha)
  const cashflowByMethod = {
    UZS: {
      CASH:
        cash_in_summary.customers.UZS.CASH - cash_in_summary.suppliers.UZS.CASH,
      CARD:
        cash_in_summary.customers.UZS.CARD - cash_in_summary.suppliers.UZS.CARD,
    },
    USD: {
      CASH:
        cash_in_summary.customers.USD.CASH - cash_in_summary.suppliers.USD.CASH,
      CARD:
        cash_in_summary.customers.USD.CARD - cash_in_summary.suppliers.USD.CARD,
    },
  };

  // Total cashflow
  const cashflowTotal = {
    UZS:
      cashInTotal.UZS -
      cashOutTotal.UZS -
      expenses.UZS.total -
      investor_withdrawals.UZS,

    USD:
      cashInTotal.USD -
      cashOutTotal.USD -
      expenses.USD.total -
      investor_withdrawals.USD,
  };

  /* =====================
     RESPONSE
  ===================== */
  return {
    range: { from, to, tz, warehouseId },

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
      by_method: cashflowByMethod,
      breakdown: {
        cash_in: {
          UZS: {
            in: cashInTotal.UZS,
            out: cashOutTotal.UZS,
          },
          USD: {
            in: cashInTotal.USD,
            out: cashOutTotal.USD,
          },
        },
        expenses: {
          UZS: {
            total: expenses.UZS.total,
            count: expenses.UZS.count,
          },
          USD: {
            total: expenses.USD.total,
            count: expenses.USD.count,
          },
        },
        withdrawals: investor_withdrawals,
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
