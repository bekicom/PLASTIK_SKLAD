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
const SaleReturn = require("../returns/SaleReturn");
const StartingBalance = require("./StartingBalance");
const InventoryRevaluation = require("./InventoryRevaluation");

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

async function getStartingBalanceSummary({ beforeDate = null } = {}) {
  const match = {};
  if (beforeDate instanceof Date && !Number.isNaN(beforeDate.getTime())) {
    match.date = { $lte: beforeDate };
  }

  const agg = await StartingBalance.aggregate([
    { $match: match },
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

  const initialBalance = {
    UZS: { CASH: 0, CARD: 0, total: 0 },
    USD: { CASH: 0, CARD: 0, total: 0 },
  };

  for (const row of agg) {
    const currency = row?._id?.currency;
    const method = row?._id?.method;
    if (!initialBalance[currency]) continue;
    if (method !== "CASH" && method !== "CARD") continue;

    initialBalance[currency][method] += Number(row.total || 0);
  }

  initialBalance.UZS.total = initialBalance.UZS.CASH + initialBalance.UZS.CARD;
  initialBalance.USD.total = initialBalance.USD.CASH + initialBalance.USD.CARD;

  return initialBalance;
}

/* =====================
   OVERVIEW (DASHBOARD) - ✅ FINAL VERSION WITH CASH/CARD
===================== */
async function getOverview({ from, to, tz, warehouseId, startingBalance }) {
  console.log("🎯 getOverview funksiyasi chaqirildi!");
  console.log("📥 Qabul qilingan startingBalance:", startingBalance);

  /* =====================
     HELPERS
  ===================== */
  const wid =
    warehouseId && mongoose.isValidObjectId(warehouseId)
      ? new mongoose.Types.ObjectId(warehouseId)
      : null;

  // ✅ Boshlang'ich balans DB yoki caller orqali keladi
  const initialBalance = startingBalance || {
    UZS: { CASH: 0, CARD: 0, total: 0 },
    USD: { CASH: 0, CARD: 0, total: 0 },
  };

  console.log("💰 initialBalance o'rnatildi:", initialBalance);

  /* =====================
     SALES (UNIQUE SALE COUNT)
  ===================== */
  const saleMatch = {
    ...buildDateMatch(from, to, "saleDate"),
    status: "COMPLETED",
  };

  const salesBasePipeline = [{ $match: saleMatch }];

  if (wid) {
    salesBasePipeline.push(
      { $unwind: "$items" },
      { $match: { "items.warehouseId": wid } },
    );
  }

  const salesAgg = await Sale.aggregate([
    ...salesBasePipeline,
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

  if (wid) profitPipeline.push({ $match: { "items.warehouseId": wid } });

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

  const salesProfit = profitAgg[0] || { UZS: 0, USD: 0 };

  const revaluationAgg = await InventoryRevaluation.aggregate([
    {
      $match: {
        ...buildDateMatch(from, to, "date"),
      },
    },
    {
      $group: {
        _id: "$currency",
        total: { $sum: "$delta_profit" },
      },
    },
  ]);

  const revaluation = { UZS: 0, USD: 0 };
  for (const r of revaluationAgg) {
    if (r._id === "UZS" || r._id === "USD") {
      revaluation[r._id] = Number(r.total || 0);
    }
  }

  const profit = {
    UZS: Number(salesProfit.UZS || 0) + revaluation.UZS,
    USD: Number(salesProfit.USD || 0) + revaluation.USD,
  };

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
      total: { UZS: 0, USD: 0 },
    },
    suppliers: {
      debt: { UZS: 0, USD: 0 },
      prepaid: { UZS: 0, USD: 0 },
      total: { UZS: 0, USD: 0 },
    },
  };

  // Current balance is a live state, not a period snapshot.
  // So we do not filter it by createdAt, otherwise dashboard periods become misleading.
  const customers = await Customer.find({}, { balance: 1 }).lean();

  for (const c of customers) {
    const bu = Number(c.balance?.UZS || 0);
    const bd = Number(c.balance?.USD || 0);

    if (bu > 0) balances.customers.debt.UZS += bu;
    else if (bu < 0) balances.customers.prepaid.UZS += Math.abs(bu);

    if (bd > 0) balances.customers.debt.USD += bd;
    else if (bd < 0) balances.customers.prepaid.USD += Math.abs(bd);
  }

  balances.customers.total.UZS =
    balances.customers.debt.UZS - balances.customers.prepaid.UZS;
  balances.customers.total.USD =
    balances.customers.debt.USD - balances.customers.prepaid.USD;

  console.log("👥 Mijozlar balansi:", balances.customers);

  const supplierPipeline = [
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
  ];

  const supplierBalanceAgg = await Supplier.aggregate(supplierPipeline);

  balances.suppliers.debt.UZS = Number(supplierBalanceAgg[0]?.debtUZS || 0);
  balances.suppliers.debt.USD = Number(supplierBalanceAgg[0]?.debtUSD || 0);
  balances.suppliers.prepaid.UZS = Number(
    supplierBalanceAgg[0]?.prepaidUZS || 0,
  );
  balances.suppliers.prepaid.USD = Number(
    supplierBalanceAgg[0]?.prepaidUSD || 0,
  );

  balances.suppliers.total.UZS =
    balances.suppliers.debt.UZS - balances.suppliers.prepaid.UZS;
  balances.suppliers.total.USD =
    balances.suppliers.debt.USD - balances.suppliers.prepaid.USD;

  console.log("🏭 Taminotchilar balansi:", balances.suppliers);

  /* =====================
     CASH-IN SUMMARY
  ===================== */
  const cashInAgg = await CashIn.aggregate([
    {
      $match: {
        ...buildDateMatch(from, to, "paymentDate"),
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
     CASHFLOW - BOSHLANG'ICH BALANS QOSHILADI
  ===================== */
  const supplierOut = {
    UZS:
      cash_in_summary.suppliers.UZS.CASH + cash_in_summary.suppliers.UZS.CARD,
    USD:
      cash_in_summary.suppliers.USD.CASH + cash_in_summary.suppliers.USD.CARD,
  };

  const customerIn = {
    UZS:
      cash_in_summary.customers.UZS.CASH + cash_in_summary.customers.UZS.CARD,
    USD:
      cash_in_summary.customers.USD.CASH + cash_in_summary.customers.USD.CARD,
  };

  // ✅ CASHFLOW CALCULATION - boshlang'ich balans bilan
  const cashflowMovement = {
    UZS: {
      CASH:
        initialBalance.UZS.CASH +
        cash_in_summary.customers.UZS.CASH -
        cash_in_summary.suppliers.UZS.CASH -
        expenses.UZS.CASH -
        investor_withdrawals.UZS.CASH,
      CARD:
        initialBalance.UZS.CARD +
        cash_in_summary.customers.UZS.CARD -
        cash_in_summary.suppliers.UZS.CARD -
        expenses.UZS.CARD -
        investor_withdrawals.UZS.CARD,
      total: 0,
    },
    USD: {
      CASH:
        initialBalance.USD.CASH +
        cash_in_summary.customers.USD.CASH -
        cash_in_summary.suppliers.USD.CASH -
        expenses.USD.CASH -
        investor_withdrawals.USD.CASH,
      CARD:
        initialBalance.USD.CARD +
        cash_in_summary.customers.USD.CARD -
        cash_in_summary.suppliers.USD.CARD -
        expenses.USD.CARD -
        investor_withdrawals.USD.CARD,
      total: 0,
    },
  };

  cashflowMovement.UZS.total =
    cashflowMovement.UZS.CASH + cashflowMovement.UZS.CARD;
  cashflowMovement.USD.total =
    cashflowMovement.USD.CASH + cashflowMovement.USD.CARD;

  const finalBalance = {
    UZS: {
      CASH: cashflowMovement.UZS.CASH,
      CARD: cashflowMovement.UZS.CARD,
      total: cashflowMovement.UZS.total,
    },
    USD: {
      CASH: cashflowMovement.USD.CASH,
      CARD: cashflowMovement.USD.CARD,
      total: cashflowMovement.USD.total,
    },
  };

  console.log("✅ Cashflow oqimi:", cashflowMovement);
  console.log("✅ Yakuniy balans:", finalBalance);

  /* =====================
     INVENTORY VALUE - PRODUCT JADVALIDAN
  ===================== */
  const inventoryAgg = await Product.aggregate([
    {
      $match: {
        isActive: true,
        qty: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: "$warehouse_currency",
        total_buy: {
          $sum: {
            $multiply: ["$qty", "$buy_price"],
          },
        },
        total_sell: {
          $sum: {
            $multiply: ["$qty", "$sell_price"],
          },
        },
        total_qty: { $sum: "$qty" },
        product_count: { $sum: 1 },
      },
    },
  ]);

  const inventoryValue = {
    UZS: 0,
    USD: 0,
  };

  const inventoryDetails = {
    UZS: { qty: 0, products: 0, buy_value: 0, sell_value: 0 },
    USD: { qty: 0, products: 0, buy_value: 0, sell_value: 0 },
  };

  for (const inv of inventoryAgg) {
    const currency = inv._id;
    if (currency === "UZS" || currency === "USD") {
      inventoryValue[currency] = Number(inv.total_buy || 0);
      inventoryDetails[currency] = {
        qty: Number(inv.total_qty || 0),
        products: Number(inv.product_count || 0),
        buy_value: Number(inv.total_buy || 0),
        sell_value: Number(inv.total_sell || 0),
      };
    }
  }

  console.log("📦 Ombor qiymati:", inventoryValue);

  /* =====================
     BUSINESS CAPITAL
     Kassa + Ombor + Mijoz total + Investor yechgan - Taminotchi total
  ===================== */
  const businessCapital = {
    UZS:
      finalBalance.UZS.total +
      inventoryValue.UZS +
      balances.customers.total.UZS +
      investor_withdrawals.UZS.total -
      balances.suppliers.total.UZS,

    USD:
      finalBalance.USD.total +
      inventoryValue.USD +
      balances.customers.total.USD +
      investor_withdrawals.USD.total -
      balances.suppliers.total.USD,
  };

  console.log("💼 BIZNES KAPITALI:", businessCapital);

  /* =====================
     TOTAL ASSETS & LIABILITIES
  ===================== */
  const totalAssets = {
    UZS:
      finalBalance.UZS.total +
      inventoryValue.UZS +
      balances.customers.debt.UZS +
      investor_withdrawals.UZS.total +
      balances.suppliers.prepaid.UZS,
    USD:
      finalBalance.USD.total +
      inventoryValue.USD +
      balances.customers.debt.USD +
      investor_withdrawals.USD.total +
      balances.suppliers.prepaid.USD,
  };

  const totalLiabilities = {
    UZS: balances.suppliers.debt.UZS + balances.customers.prepaid.UZS,
    USD: balances.suppliers.debt.USD + balances.customers.prepaid.USD,
  };

  /* =====================
     BALANCE SHEET
  ===================== */
  const balanceSheet = {
    assets: {
      current_assets: {
        cash_and_bank: finalBalance,
        inventory: inventoryValue,
        accounts_receivable: balances.customers.debt,
        investor_withdrawals: investor_withdrawals,
        supplier_prepaid: balances.suppliers.prepaid,
      },
      total_assets: totalAssets,
    },
    liabilities: {
      accounts_payable: balances.suppliers.debt,
      customer_prepayments: balances.customers.prepaid,
      total_liabilities: totalLiabilities,
    },
    equity: {
      starting_capital: initialBalance,
      retained_earnings: {
        UZS: profit.UZS - expenses.UZS.total,
        USD: profit.USD - expenses.USD.total,
      },
      total_equity: {
        UZS: totalAssets.UZS - totalLiabilities.UZS,
        USD: totalAssets.USD - totalLiabilities.USD,
      },
    },
  };

  /* =====================
     RETURN RESPONSE
  ===================== */
  return {
    sales,
    profit: {
      sales: salesProfit,
      revaluation,
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
    starting_balance: initialBalance,
    final_balance: finalBalance,

    cashflow: {
      total: {
        UZS: cashflowMovement.UZS.total,
        USD: cashflowMovement.USD.total,
      },
      by_method: {
        UZS: {
          CASH: cashflowMovement.UZS.CASH,
          CARD: cashflowMovement.UZS.CARD,
        },
        USD: {
          CASH: cashflowMovement.USD.CASH,
          CARD: cashflowMovement.USD.CARD,
        },
      },
      breakdown: {
        expenses,
        customer_in: {
          UZS: { ...cash_in_summary.customers.UZS, total: customerIn.UZS },
          USD: { ...cash_in_summary.customers.USD, total: customerIn.USD },
        },
        supplier_out: {
          UZS: { ...cash_in_summary.suppliers.UZS, total: supplierOut.UZS },
          USD: { ...cash_in_summary.suppliers.USD, total: supplierOut.USD },
        },
        investor_withdrawals,
        starting_balance: initialBalance,
      },
    },

    inventory_value: inventoryValue,
    inventory_details: inventoryDetails,
    business_capital: businessCapital,

    business_capital_breakdown: {
      cash: finalBalance,
      inventory: inventoryValue,
      customer_total: balances.customers.total,
      investor_withdrawals: investor_withdrawals,
      supplier_total: balances.suppliers.total,
      formula:
        "Kassa + Ombor + Mijoz total + Investor yechgan - Taminotchi total",
    },

    balance_sheet: balanceSheet,
  };
}

/* =====================
   TIME SERIES
===================== */
async function getTimeSeries({ from, to, tz, group }) {
  const unit = group === "month" ? "month" : "day";

  const sales = await Sale.aggregate([
    {
      $match: { ...buildDateMatch(from, to, "saleDate"), status: "COMPLETED" },
    },
    {
      $group: {
        _id: { $dateTrunc: { date: "$saleDate", unit, timezone: tz } },
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
    (a, b) => new Date(a.date) - new Date(b.date),
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
        ...buildDateMatch(from, to, "saleDate"),
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
async function getStock({ from, to } = {}) {
  const pipeline = [];

  if (from || to) {
    const dateMatch = { purchase_date: {} };

    if (from) {
      dateMatch.purchase_date.$gte = from;
    }

    if (to) {
      dateMatch.purchase_date.$lte = to;
    }

    pipeline.push({ $match: dateMatch });
  }

  pipeline.push(
    { $unwind: "$items" },

    {
      $lookup: {
        from: "products",
        localField: "items.product_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },

    {
      $group: {
        _id: "$items.currency",

        unique_products: { $addToSet: "$items.product_id" },

        total_qty: { $sum: "$items.qty" },

        valuation_buy: {
          $sum: {
            $multiply: ["$items.qty", "$items.buy_price"],
          },
        },

        valuation_sell: {
          $sum: {
            $multiply: ["$items.qty", "$items.sell_price"],
          },
        },
      },
    },

    {
      $project: {
        _id: 0,
        currency: "$_id",
        sku: { $size: "$unique_products" },
        total_qty: 1,
        valuation_buy: 1,
        valuation_sell: 1,
      },
    },

    { $sort: { currency: 1 } },
  );

  const byCurrency = await Purchase.aggregate(pipeline);

  return { byCurrency };
}

/* =====================
   PROFIT DETAILS (CARD EYE)
===================== */
async function getProfitDetails({
  from,
  to,
  currency = "ALL",
  productId = null,
  customerId = null,
  limit = 500,
} = {}) {
  const saleMatch = {
    ...buildDateMatch(from, to, "saleDate"),
    status: "COMPLETED",
  };

  if (customerId && mongoose.isValidObjectId(customerId)) {
    saleMatch.customerId = new mongoose.Types.ObjectId(customerId);
  }

  const safeLimit = Math.max(1, Number(limit || 500));

  const sales = await Sale.find(saleMatch)
    .select("invoiceNo saleDate createdAt customerId customerSnapshot items")
    .lean();

  const saleIds = sales.map((s) => s._id).filter(Boolean);

  const returnMatch = {
    ...buildDateMatch(from, to, "createdAt"),
  };
  if (customerId && mongoose.isValidObjectId(customerId)) {
    returnMatch.customer_id = new mongoose.Types.ObjectId(customerId);
  } else if (saleIds.length) {
    returnMatch.sale_id = { $in: saleIds };
  }

  const returns = await SaleReturn.find(returnMatch)
    .select("sale_id customer_id createdAt note returnSubtotal items")
    .lean();

  const saleItemMetaMap = new Map();
  const saleMetaMap = new Map();

  for (const s of sales) {
    const sid = String(s._id);
    const saleMeta = {
      saleId: s._id,
      docNo: s.invoiceNo || "",
      date: s.saleDate || s.createdAt,
      customerId: s.customerId || null,
      customerName: s.customerSnapshot?.name || "",
    };
    saleMetaMap.set(sid, saleMeta);

    for (const it of s.items || []) {
      const key = `${sid}|${String(it.productId)}`;
      saleItemMetaMap.set(key, {
        buyPrice: Number(it.buy_price || 0),
        currency: it.currency || "UZS",
        productSnapshot: it.productSnapshot || {},
        saleMeta,
      });
    }
  }

  const rows = [];

  for (const s of sales) {
    for (const it of s.items || []) {
      if (productId && String(it.productId) !== String(productId)) continue;
      if (currency !== "ALL" && it.currency !== currency) continue;

      const qty = Number(it.qty || 0);
      const sellPrice = Number(it.sell_price || 0);
      const buyPrice = Number(it.buy_price || 0);
      const revenue = qty * sellPrice;
      const cost = qty * buyPrice;
      const profit = revenue - cost;

      rows.push({
        date: s.saleDate || s.createdAt,
        type: "SALE",
        docNo: s.invoiceNo || "",
        saleId: s._id,
        customerId: s.customerId || null,
        customerName: s.customerSnapshot?.name || "",
        productId: it.productId,
        productName: it.productSnapshot?.name || "",
        model: it.productSnapshot?.model || "",
        category: it.productSnapshot?.category || "",
        unit: it.productSnapshot?.unit || "",
        currency: it.currency,
        qty,
        sellPrice,
        buyPrice,
        revenue,
        cost,
        profit,
      });
    }
  }

  const revaluationRows = await InventoryRevaluation.find({
    ...buildDateMatch(from, to, "date"),
    ...(currency !== "ALL" ? { currency } : {}),
  })
    .select("date currency product existing_qty incoming_buy_price old_avg_buy_price delta_profit kind note purchase_id")
    .lean();

  for (const r of revaluationRows) {
    const revalType = r.kind === "LOSS" ? "REVALUATION_LOSS" : "REVALUATION_GAIN";
    rows.push({
      date: r.date,
      type: revalType,
      docNo: `RV-${String(r._id || "").slice(-6)}`,
      saleId: null,
      customerId: null,
      customerName: "",
      productId: null,
      productName: r?.product?.name || "",
      model: r?.product?.model || "",
      category: r?.product?.category || "",
      unit: r?.product?.unit || "",
      currency: r.currency,
      qty: Number(r.existing_qty || 0),
      sellPrice: 0,
      buyPrice: Number(r.incoming_buy_price || 0),
      revenue: Number(r.delta_profit || 0),
      cost: 0,
      profit: Number(r.delta_profit || 0),
      note: r.note || "",
      kind: r.kind || "",
      purchaseId: r.purchase_id || null,
      oldAvgBuyPrice: Number(r.old_avg_buy_price || 0),
    });
  }

  // Harajatlar ham foyda tafsilotlariga kiradi (net foyda uchun)
  const expenseRows = await Expense.find({
    ...buildDateMatch(from, to, "expense_date"),
    ...(currency !== "ALL" ? { currency } : {}),
  })
    .select("_id expense_date category note amount currency payment_method")
    .lean();

  for (const e of expenseRows) {
    const amt = Number(e.amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    rows.push({
      date: e.expense_date || e.createdAt || new Date(),
      type: "EXPENSE",
      docNo: `EXP-${String(e._id || "").slice(-6)}`,
      saleId: null,
      customerId: null,
      customerName: "",
      productId: null,
      productName: e.category || "Harajat",
      model: "",
      category: e.category || "",
      unit: "",
      currency: e.currency || "UZS",
      qty: 0,
      sellPrice: 0,
      buyPrice: amt,
      revenue: 0,
      cost: amt,
      profit: -amt,
      note: e.note || "",
      paymentMethod: e.payment_method || "CASH",
    });
  }

  for (const r of returns) {
    for (const it of r.items || []) {
      if (productId && String(it.product_id) !== String(productId)) continue;

      const saleIdStr = String(r.sale_id || "");
      const productIdStr = String(it.product_id || "");
      const linked = saleItemMetaMap.get(`${saleIdStr}|${productIdStr}`);
      const buyPrice = Number(linked?.buyPrice || 0);
      const sellPrice = Number(it.price || 0);
      const qty = Number(it.qty || 0);
      const itemCurrency = linked?.currency || "UZS";
      const saleMeta = saleMetaMap.get(saleIdStr) || linked?.saleMeta || {};

      if (currency !== "ALL" && itemCurrency !== currency) continue;

      const revenue = -(qty * sellPrice);
      const cost = -(qty * buyPrice);
      const profit = revenue - cost;

      rows.push({
        date: r.createdAt,
        type: "RETURN",
        docNo: saleMeta.docNo || `RET-${String(r._id || "").slice(-6)}`,
        saleId: r.sale_id || null,
        customerId: r.customer_id || saleMeta.customerId || null,
        customerName: saleMeta.customerName || "",
        productId: it.product_id,
        productName:
          linked?.productSnapshot?.name ||
          it.product_snapshot?.name ||
          "",
        model: linked?.productSnapshot?.model || "",
        category: linked?.productSnapshot?.category || "",
        unit:
          linked?.productSnapshot?.unit ||
          it.product_snapshot?.unit ||
          "",
        currency: itemCurrency,
        qty: -qty,
        sellPrice,
        buyPrice,
        revenue,
        cost,
        profit,
        note: r.note || it.reason || "",
      });
    }
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const byCurrency = {
    UZS: { revenue: 0, cost: 0, grossProfit: 0, qty: 0, rows: 0 },
    USD: { revenue: 0, cost: 0, grossProfit: 0, qty: 0, rows: 0 },
  };
  const expenseTotals = { UZS: 0, USD: 0 };

  const productMap = new Map();
  const customerMap = new Map();
  const documentMap = new Map();

  for (const r of rows) {
    if (!byCurrency[r.currency]) continue;

    byCurrency[r.currency].revenue += Number(r.revenue || 0);
    byCurrency[r.currency].cost += Number(r.cost || 0);
    byCurrency[r.currency].grossProfit += Number(r.profit || 0);
    byCurrency[r.currency].qty += Number(r.qty || 0);
    byCurrency[r.currency].rows += 1;

    if (r.type === "EXPENSE") {
      expenseTotals[r.currency] += Number(r.cost || 0);
    }

    // Harajatlar mahsulot breakdownga kirmaydi
    if (r.type === "EXPENSE") {
      const docKey = `${String(r.docNo || "")}|${String(r.saleId || "")}|${r.currency}`;
      if (r.docNo || r.saleId) {
        const dAcc = documentMap.get(docKey) || {
          docNo: r.docNo || "",
          saleId: r.saleId || null,
          customerName: r.customerName || "",
          currency: r.currency,
          revenue: 0,
          cost: 0,
          grossProfit: 0,
          transactions: 0,
        };
        dAcc.revenue += Number(r.revenue || 0);
        dAcc.cost += Number(r.cost || 0);
        dAcc.grossProfit += Number(r.profit || 0);
        dAcc.transactions += 1;
        documentMap.set(docKey, dAcc);
      }
      continue;
    }

    const productKeyName =
      String(r.productId || "").trim() ||
      `${String(r.productName || "").trim()}|${String(r.model || "").trim()}|${String(r.category || "").trim()}|${String(r.unit || "").trim()}`;

    const key2 = `${productKeyName}|${r.currency}`;
    const acc = productMap.get(key2) || {
      productId: r.productId || null,
      productName: r.productName,
      model: r.model,
      category: r.category,
      unit: r.unit,
      currency: r.currency,
      soldQty: 0,
      returnedQty: 0,
      netQty: 0,
      revenue: 0,
      cost: 0,
      grossProfit: 0,
      transactions: 0,
    };

    if (r.type === "SALE") acc.soldQty += Math.max(0, Number(r.qty || 0));
    if (r.type === "RETURN") acc.returnedQty += Math.abs(Number(r.qty || 0));

    acc.netQty += r.type === "REVALUATION" ? 0 : Number(r.qty || 0);
    acc.revenue += Number(r.revenue || 0);
    acc.cost += Number(r.cost || 0);
    acc.grossProfit += Number(r.profit || 0);
    acc.transactions += 1;

    productMap.set(key2, acc);

    const customerKey =
      String(r.customerId || "").trim() || String(r.customerName || "").trim();
    if (customerKey) {
      const ckey = `${customerKey}|${r.currency}`;
      const cAcc = customerMap.get(ckey) || {
        customerId: r.customerId || null,
        customerName: r.customerName || "",
        currency: r.currency,
        revenue: 0,
        cost: 0,
        grossProfit: 0,
        transactions: 0,
      };
      cAcc.revenue += Number(r.revenue || 0);
      cAcc.cost += Number(r.cost || 0);
      cAcc.grossProfit += Number(r.profit || 0);
      cAcc.transactions += 1;
      customerMap.set(ckey, cAcc);
    }

    const docKey = `${String(r.docNo || "")}|${String(r.saleId || "")}|${r.currency}`;
    if (r.docNo || r.saleId) {
      const dAcc = documentMap.get(docKey) || {
        docNo: r.docNo || "",
        saleId: r.saleId || null,
        customerName: r.customerName || "",
        currency: r.currency,
        revenue: 0,
        cost: 0,
        grossProfit: 0,
        transactions: 0,
      };
      dAcc.revenue += Number(r.revenue || 0);
      dAcc.cost += Number(r.cost || 0);
      dAcc.grossProfit += Number(r.profit || 0);
      dAcc.transactions += 1;
      documentMap.set(docKey, dAcc);
    }
  }

  const byProduct = Array.from(productMap.values())
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, safeLimit);

  const byCustomer = Array.from(customerMap.values())
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, safeLimit);

  const byDocument = Array.from(documentMap.values())
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, safeLimit);

  return {
    filters: {
      from: from || null,
      to: to || null,
      currency,
      productId: productId || null,
      customerId: customerId || null,
      limit: safeLimit,
    },
    summary: {
      UZS: byCurrency.UZS,
      USD: byCurrency.USD,
      expenses: expenseTotals,
      grossBeforeExpense: {
        UZS: Number(byCurrency.UZS.grossProfit || 0) + Number(expenseTotals.UZS || 0),
        USD: Number(byCurrency.USD.grossProfit || 0) + Number(expenseTotals.USD || 0),
      },
      netProfit: {
        UZS: Number(byCurrency.UZS.grossProfit || 0),
        USD: Number(byCurrency.USD.grossProfit || 0),
      },
      totalRows: rows.length,
      totalProducts: byProduct.length,
      totalCustomers: byCustomer.length,
      totalDocuments: byDocument.length,
    },
    byProduct,
    byCustomer,
    byDocument,
    transactions: rows.slice(0, safeLimit),
  };
}

/* =====================
   BUSINESS ANALYSIS (FULL)
===================== */
function ensureStatBucket() {
  return {
    revenue: 0,
    cost: 0,
    profit: 0,
    qty: 0,
    transactions: 0,
  };
}

function touchStat(map, key, seed = {}) {
  const cur = map.get(key) || { ...seed, UZS: ensureStatBucket(), USD: ensureStatBucket() };
  map.set(key, cur);
  return cur;
}

function applyStatRow(stat, currency, { revenue = 0, cost = 0, profit = 0, qty = 0 }) {
  if (!["UZS", "USD"].includes(currency)) return;
  stat[currency].revenue += Number(revenue || 0);
  stat[currency].cost += Number(cost || 0);
  stat[currency].profit += Number(profit || 0);
  stat[currency].qty += Number(qty || 0);
  stat[currency].transactions += 1;
}

function normalizeStatRow(stat) {
  const out = {
    UZS: {
      revenue: Number(stat?.UZS?.revenue || 0),
      cost: Number(stat?.UZS?.cost || 0),
      profit: Number(stat?.UZS?.profit || 0),
      qty: Number(stat?.UZS?.qty || 0),
      transactions: Number(stat?.UZS?.transactions || 0),
      marginPercent: 0,
    },
    USD: {
      revenue: Number(stat?.USD?.revenue || 0),
      cost: Number(stat?.USD?.cost || 0),
      profit: Number(stat?.USD?.profit || 0),
      qty: Number(stat?.USD?.qty || 0),
      transactions: Number(stat?.USD?.transactions || 0),
      marginPercent: 0,
    },
  };

  out.UZS.marginPercent = out.UZS.revenue
    ? Number(((out.UZS.profit / out.UZS.revenue) * 100).toFixed(2))
    : 0;
  out.USD.marginPercent = out.USD.revenue
    ? Number(((out.USD.profit / out.USD.revenue) * 100).toFixed(2))
    : 0;

  return out;
}

function sortByProfitCurrency(rows, currency = "UZS", desc = true) {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = Number(a?.stats?.[currency]?.profit || 0);
    const bv = Number(b?.stats?.[currency]?.profit || 0);
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });
}

async function getBusinessAnalysis({
  from,
  to,
  currency = "ALL",
  limit = 10,
} = {}) {
  const validCurrency = ["ALL", "UZS", "USD"].includes(currency) ? currency : "ALL";
  const topLimit = Math.min(50, Math.max(1, Number(limit || 10)));

  const saleMatch = {
    ...buildDateMatch(from, to, "saleDate"),
    status: "COMPLETED",
  };

  const sales = await Sale.find(saleMatch)
    .select("invoiceNo saleDate createdAt customerId customerSnapshot items")
    .lean();

  const returns = await SaleReturn.find({
    ...buildDateMatch(from, to, "createdAt"),
  })
    .select("sale_id customer_id createdAt items")
    .lean();

  const productIdSet = new Set();
  for (const s of sales) {
    for (const it of s.items || []) {
      if (it?.productId) productIdSet.add(String(it.productId));
    }
  }
  for (const r of returns) {
    for (const it of r.items || []) {
      if (it?.product_id) productIdSet.add(String(it.product_id));
    }
  }

  const products = await Product.find({
    _id: { $in: [...productIdSet] },
  })
    .select("_id supplier_id name model category unit warehouse_currency")
    .lean();

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const supplierIds = [
    ...new Set(products.map((p) => String(p.supplier_id || "")).filter(Boolean)),
  ];

  const suppliers = await Supplier.find({
    _id: { $in: supplierIds },
  })
    .select("_id name phone balance")
    .lean();
  const supplierMap = new Map(suppliers.map((s) => [String(s._id), s]));

  const customerIds = [
    ...new Set(
      sales.map((s) => String(s.customerId || "")).filter(Boolean).concat(
        returns.map((r) => String(r.customer_id || "")).filter(Boolean),
      ),
    ),
  ];

  const customers = await Customer.find({
    _id: { $in: customerIds },
  })
    .select("_id name phone balance")
    .lean();
  const customerMap = new Map(customers.map((c) => [String(c._id), c]));

  const saleItemMeta = new Map();
  const saleCustomerMeta = new Map();

  const customerStats = new Map();
  const productStats = new Map();
  const supplierStats = new Map();

  const overall = {
    UZS: ensureStatBucket(),
    USD: ensureStatBucket(),
  };

  for (const s of sales) {
    const saleId = String(s._id);
    const customerKey = s.customerId ? String(s.customerId) : `SNAP:${String(s.customerSnapshot?.name || "Walk-in").trim() || "Walk-in"}`;
    const customerName =
      customerMap.get(String(s.customerId || ""))?.name ||
      s.customerSnapshot?.name ||
      "Walk-in";

    saleCustomerMeta.set(saleId, { key: customerKey, name: customerName });

    for (const it of s.items || []) {
      const rowCurrency = String(it.currency || "");
      if (!["UZS", "USD"].includes(rowCurrency)) continue;
      if (validCurrency !== "ALL" && validCurrency !== rowCurrency) continue;

      const qty = Number(it.qty || 0);
      const sellPrice = Number(it.sell_price || 0);
      const buyPrice = Number(it.buy_price || 0);
      const revenue = qty * sellPrice;
      const cost = qty * buyPrice;
      const profit = revenue - cost;

      const productId = String(it.productId || "");
      const p = productMap.get(productId);
      const productKey =
        productId ||
        `PSNAP:${String(it?.productSnapshot?.name || "").trim()}|${String(it?.productSnapshot?.model || "").trim()}|${rowCurrency}`;
      const productName = p?.name || it?.productSnapshot?.name || "Noma'lum";

      const supplierId = String(p?.supplier_id || "");
      const supplier = supplierMap.get(supplierId);
      const supplierKey = supplierId || "UNKNOWN_SUPPLIER";
      const supplierName = supplier?.name || "Noma'lum zavod";

      const line = { revenue, cost, profit, qty };

      const cSeed = {
        id: s.customerId || null,
        name: customerName,
        phone: customerMap.get(String(s.customerId || ""))?.phone || "",
        balance: customerMap.get(String(s.customerId || ""))?.balance || { UZS: 0, USD: 0 },
      };
      const c = touchStat(customerStats, customerKey, cSeed);
      applyStatRow(c, rowCurrency, line);

      const pSeed = {
        id: p?._id || null,
        name: productName,
        model: p?.model || it?.productSnapshot?.model || "",
        category: p?.category || it?.productSnapshot?.category || "",
        unit: p?.unit || it?.productSnapshot?.unit || "",
        supplierId: supplier?._id || null,
        supplierName,
      };
      const pStat = touchStat(productStats, productKey, pSeed);
      applyStatRow(pStat, rowCurrency, line);

      const sSeed = {
        id: supplier?._id || null,
        name: supplierName,
        phone: supplier?.phone || "",
        balance: supplier?.balance || { UZS: 0, USD: 0 },
      };
      const sStat = touchStat(supplierStats, supplierKey, sSeed);
      applyStatRow(sStat, rowCurrency, line);

      applyStatRow(overall, rowCurrency, line);

      saleItemMeta.set(`${saleId}|${productId}`, {
        buyPrice,
        currency: rowCurrency,
        customerKey,
        customerName,
      });
    }
  }

  for (const r of returns) {
    const saleId = String(r.sale_id || "");
    const fallBackCustomer = saleCustomerMeta.get(saleId);
    const customerKey = r.customer_id
      ? String(r.customer_id)
      : fallBackCustomer?.key || "UNKNOWN_CUSTOMER";
    const customerName =
      customerMap.get(String(r.customer_id || ""))?.name ||
      fallBackCustomer?.name ||
      "Noma'lum mijoz";

    for (const it of r.items || []) {
      const productId = String(it.product_id || "");
      const meta = saleItemMeta.get(`${saleId}|${productId}`);
      const p = productMap.get(productId);

      const rowCurrency = meta?.currency || p?.warehouse_currency || "UZS";
      if (!["UZS", "USD"].includes(rowCurrency)) continue;
      if (validCurrency !== "ALL" && validCurrency !== rowCurrency) continue;

      const qtyAbs = Number(it.qty || 0);
      const qty = -qtyAbs;
      const sellPrice = Number(it.price || 0);
      const buyPrice = Number(meta?.buyPrice || 0);

      const revenue = qty * sellPrice;
      const cost = qty * buyPrice;
      const profit = revenue - cost;

      const supplierId = String(p?.supplier_id || "");
      const supplier = supplierMap.get(supplierId);
      const supplierKey = supplierId || "UNKNOWN_SUPPLIER";
      const supplierName = supplier?.name || "Noma'lum zavod";

      const line = { revenue, cost, profit, qty };

      const cSeed = {
        id: r.customer_id || null,
        name: customerName,
        phone: customerMap.get(String(r.customer_id || ""))?.phone || "",
        balance: customerMap.get(String(r.customer_id || ""))?.balance || { UZS: 0, USD: 0 },
      };
      const c = touchStat(customerStats, customerKey, cSeed);
      applyStatRow(c, rowCurrency, line);

      const productKey =
        productId ||
        `PSNAP:${String(it?.product_snapshot?.name || "").trim()}|${String(it?.product_snapshot?.unit || "").trim()}|${rowCurrency}`;
      const pSeed = {
        id: p?._id || null,
        name: p?.name || it?.product_snapshot?.name || "Noma'lum",
        model: p?.model || "",
        category: p?.category || "",
        unit: p?.unit || it?.product_snapshot?.unit || "",
        supplierId: supplier?._id || null,
        supplierName,
      };
      const pStat = touchStat(productStats, productKey, pSeed);
      applyStatRow(pStat, rowCurrency, line);

      const sSeed = {
        id: supplier?._id || null,
        name: supplierName,
        phone: supplier?.phone || "",
        balance: supplier?.balance || { UZS: 0, USD: 0 },
      };
      const sStat = touchStat(supplierStats, supplierKey, sSeed);
      applyStatRow(sStat, rowCurrency, line);

      applyStatRow(overall, rowCurrency, line);
    }
  }

  const mapToRows = (map) =>
    Array.from(map.values()).map((x) => ({
      ...x,
      stats: normalizeStatRow(x),
    }));

  const customerRows = mapToRows(customerStats);
  const productRows = mapToRows(productStats);
  const supplierRows = mapToRows(supplierStats);

  const rankCurrency = validCurrency === "ALL" ? "UZS" : validCurrency;

  const customerTop = sortByProfitCurrency(customerRows, rankCurrency, true).slice(0, topLimit);
  const customerBottom = sortByProfitCurrency(customerRows, rankCurrency, false).slice(0, topLimit);
  const productTop = sortByProfitCurrency(productRows, rankCurrency, true).slice(0, topLimit);
  const productBottom = sortByProfitCurrency(productRows, rankCurrency, false).slice(0, topLimit);
  const supplierTop = sortByProfitCurrency(supplierRows, rankCurrency, true).slice(0, topLimit);
  const supplierBottom = sortByProfitCurrency(supplierRows, rankCurrency, false).slice(0, topLimit);

  return {
    filters: {
      from: from || null,
      to: to || null,
      currency: validCurrency,
      limit: topLimit,
    },
    overview: {
      uniqueCustomers: customerRows.length,
      uniqueProducts: productRows.length,
      uniqueSuppliers: supplierRows.length,
      salesCount: sales.length,
      returnsCount: returns.length,
      totals: normalizeStatRow(overall),
    },
    rankings: {
      customers: {
        top: customerTop,
        bottom: customerBottom,
      },
      products: {
        top: productTop,
        bottom: productBottom,
      },
      suppliers: {
        top: supplierTop,
        bottom: supplierBottom,
      },
    },
    tables: {
      customers: sortByProfitCurrency(customerRows, rankCurrency, true),
      products: sortByProfitCurrency(productRows, rankCurrency, true),
      suppliers: sortByProfitCurrency(supplierRows, rankCurrency, true),
    },
  };
}

module.exports = {
  getStartingBalanceSummary,
  getOverview,
  getTimeSeries,
  getTop,
  getStock,
  getProfitDetails,
  getBusinessAnalysis,
};
