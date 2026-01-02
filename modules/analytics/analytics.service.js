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
  const saleMatch = {
    ...buildDateMatch(from, to, "createdAt"),
    status: "COMPLETED",
  };

  if (warehouseId && mongoose.isValidObjectId(warehouseId)) {
    saleMatch["items.warehouseId"] = new mongoose.Types.ObjectId(warehouseId);
  }

  // =====================
  // SALES SUMMARY
  // =====================
  const salesAgg = await Sale.aggregate([
    { $match: saleMatch },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },

        uzs_total: { $sum: "$currencyTotals.UZS.grandTotal" },
        uzs_paid: { $sum: "$currencyTotals.UZS.paidAmount" },
        uzs_debt: { $sum: "$currencyTotals.UZS.debtAmount" },
        uzs_discount: { $sum: "$currencyTotals.UZS.discount" },

        usd_total: { $sum: "$currencyTotals.USD.grandTotal" },
        usd_paid: { $sum: "$currencyTotals.USD.paidAmount" },
        usd_debt: { $sum: "$currencyTotals.USD.debtAmount" },
        usd_discount: { $sum: "$currencyTotals.USD.discount" },
      },
    },
    { $project: { _id: 0 } },
  ]);

  const sales = salesAgg[0] || {
    count: 0,
    uzs_total: 0,
    uzs_paid: 0,
    uzs_debt: 0,
    uzs_discount: 0,
    usd_total: 0,
    usd_paid: 0,
    usd_debt: 0,
    usd_discount: 0,
  };

  // =====================
  // PROFIT (FOYDA)
  // =====================
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

  // =====================
  // EXPENSES
  // =====================
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

  // =====================
  // ORDERS
  // =====================
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

  // =====================
  // DEBTS
  // =====================
  const [custDebt] = await Customer.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: null,
        uzs: { $sum: "$total_debt_uzs" },
        usd: { $sum: "$total_debt_usd" },
      },
    },
    { $project: { _id: 0 } },
  ]);

  const [suppDebt] = await Supplier.aggregate([
    {
      $group: {
        _id: null,
        uzs: { $sum: "$total_debt_uzs" },
        usd: { $sum: "$total_debt_usd" },
      },
    },
    { $project: { _id: 0 } },
  ]);

  // =====================
  // CASHFLOW
  // =====================
  const cashflow = {
    UZS: (sales.uzs_paid || 0) - (expenses.UZS.total || 0),
    USD: (sales.usd_paid || 0) - (expenses.USD.total || 0),
  };

  return {
    range: { from, to, tz, warehouseId },
    sales,
    profit, // 🔥 JAMI FOYDA
    expenses,
    orders,
    debts: {
      customers: { UZS: custDebt?.uzs || 0, USD: custDebt?.usd || 0 },
      suppliers: { UZS: suppDebt?.uzs || 0, USD: suppDebt?.usd || 0 },
    },
    cashflow,
  };
}

// ⬇️ QOLGAN FUNKSIYALAR O‘ZGARMADI
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

async function getTop({ from, to, tz, type, limit }) {
  if (type === "customers") {
    return Customer.find({ isActive: true })
      .sort({ total_debt_uzs: -1, total_debt_usd: -1 })
      .limit(limit)
      .select("name phone total_debt_uzs total_debt_usd")
      .lean();
  }

  if (type === "agents") {
    return Order.aggregate([
      { $match: buildDateMatch(from, to, "createdAt") },
      {
        $group: {
          _id: "$agent_id",
          count: { $sum: 1 },
          total_uzs: { $sum: "$total_uzs" },
          total_usd: { $sum: "$total_usd" },
        },
      },
      { $sort: { total_uzs: -1, total_usd: -1, count: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "agent",
        },
      },
      { $unwind: { path: "$agent", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          agent_id: "$_id",
          agent_name: "$agent.name",
          count: 1,
          total_uzs: 1,
          total_usd: 1,
        },
      },
    ]);
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
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        product_id: "$_id",
        name: "$product.name",
        model: "$product.model",
        color: "$product.color",
        qty: 1,
        uzs_sum: 1,
        usd_sum: 1,
      },
    },
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

  const low = await Product.find({ qty: { $gt: 0 } })
    .sort({ qty: 1 })
    .limit(20)
    .select(
      "name model color warehouse_currency qty buy_price sell_price supplier_id"
    )
    .lean();

  return { byCurrency, low };
}

module.exports = {
  getOverview,
  getTimeSeries,
  getTop,
  getStock,
};
