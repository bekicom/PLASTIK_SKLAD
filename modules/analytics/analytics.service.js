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

  for (const e of expensesAgg) {
    if (e._id === "UZS") expenses.UZS = e;
    if (e._id === "USD") expenses.USD = e;
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
     BALANCES
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
     CASH-IN (OLD LOGIC – TOTAL)
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
        in: {
          $sum: {
            $cond: [{ $eq: ["$target_type", "CUSTOMER"] }, "$amount", 0],
          },
        },
        out: {
          $sum: {
            $cond: [{ $eq: ["$target_type", "SUPPLIER"] }, "$amount", 0],
          },
        },
      },
    },
  ]);

  const cashInTotal = { UZS: { in: 0, out: 0 }, USD: { in: 0, out: 0 } };
  for (const r of cashInAgg) {
    cashInTotal[r._id] = { in: r.in || 0, out: r.out || 0 };
  }

  /* =====================
     WITHDRAWALS
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
    withdrawals[w._id] = w.total || 0;
  }

  /* =====================
     CASHFLOW TOTAL (ESKI FORMULA)
  ===================== */
  const cashflowTotal = {
    UZS:
      (sales.uzs_paid || 0) +
      cashInTotal.UZS.in -
      cashInTotal.UZS.out -
      (expenses.UZS.total || 0) -
      withdrawals.UZS,

    USD:
      (sales.usd_paid || 0) +
      cashInTotal.USD.in -
      cashInTotal.USD.out -
      (expenses.USD.total || 0) -
      withdrawals.USD,
  };

  /* =====================
     CASHFLOW BY METHOD (YANGI)
  ===================== */
  const cashInByMethodAgg = await CashIn.aggregate([
    {
      $match: {
        ...buildDateMatch(from, to, "createdAt"),
        amount: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: {
          currency: "$currency",
          method: { $ifNull: ["$payment_method", "CASH"] },
          type: "$target_type",
        },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const cashflowByMethod = {
    UZS: { CASH: 0, CARD: 0 },
    USD: { CASH: 0, CARD: 0 },
  };

  for (const r of cashInByMethodAgg) {
    const cur = r._id.currency;
    const m = r._id.method || "CASH";
    if (r._id.type === "CUSTOMER") cashflowByMethod[cur][m] += r.total;
    if (r._id.type === "SUPPLIER") cashflowByMethod[cur][m] -= r.total;
  }

  return {
    range: { from, to, tz, warehouseId },

    sales,

    profit: {
      gross: profit,
      net: {
        UZS: (profit.UZS || 0) - (expenses.UZS.total || 0),
        USD: (profit.USD || 0) - (expenses.USD.total || 0),
      },
    },

    expenses,
    orders,
    balances,

    cashflow: {
      total: cashflowTotal,
      by_method: cashflowByMethod,
      breakdown: {
        cash_in: cashInTotal,
        expenses,
        withdrawals,
      },
    },
  };
}

/* =====================
   TIME SERIES
===================== */
/* =====================
   TIME SERIES (FIXED)
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
/* =====================
   TOP PRODUCTS (FIXED)
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

    // 1️⃣ PRODUCT BO‘YICHA GROUP
    {
      $group: {
        _id: "$items.productId",
        qty: { $sum: "$items.qty" },
      },
    },

    // 2️⃣ SORT (ENG KO‘P SOTILGAN)
    { $sort: { qty: -1 } },

    // 3️⃣ LIMIT
    { $limit: limit },

    // 4️⃣ PRODUCT LOOKUP
    {
      $lookup: {
        from: "products", // ⚠️ collection nomi
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },

    // 5️⃣ ARRAY → OBJECT
    { $unwind: "$product" },

    // 6️⃣ FINAL FORMAT
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
/* =====================
   STOCK (FIXED & EXTENDED)
===================== */
async function getStock() {
  const byCurrency = await Product.aggregate([
    {
      $group: {
        _id: "$warehouse_currency",

        // nechta mahsulot turi
        sku: { $sum: 1 },

        // jami qty
        total_qty: { $sum: "$qty" },

        // ombordagi qiymat (kelish narxida)
        valuation_buy: {
          $sum: { $multiply: ["$qty", "$buy_price"] },
        },

        // ombordagi qiymat (sotuv narxida)
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
