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
   OVERVIEW (DASHBOARD) - ✅ FINAL CORRECT VERSION
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

  // ✅ Boshlang'ich balans (starting balance)
  const initialBalance = {
    UZS: Number(startingBalance?.UZS || 0),
    USD: Number(startingBalance?.USD || 0),
  };

  console.log("💰 initialBalance o'rnatildi:", initialBalance);

  /* =====================
     SALES (UNIQUE SALE COUNT)
  ===================== */
  const saleMatch = {
    ...buildDateMatch(from, to, "createdAt"),
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
    },
  };

  const customerFilter = buildDateMatch(from, to, "createdAt");
  const customers = await Customer.find(customerFilter, { balance: 1 }).lean();

  for (const c of customers) {
    const bu = Number(c.balance?.UZS || 0);
    const bd = Number(c.balance?.USD || 0);

    if (bu > 0) balances.customers.debt.UZS += bu;
    else if (bu < 0) balances.customers.prepaid.UZS += Math.abs(bu);

    if (bd > 0) balances.customers.debt.USD += bd;
    else if (bd < 0) balances.customers.prepaid.USD += Math.abs(bd);
  }

  // ✅ Total = debt - prepaid
  balances.customers.total.UZS =
    balances.customers.debt.UZS - balances.customers.prepaid.UZS;
  balances.customers.total.USD =
    balances.customers.debt.USD - balances.customers.prepaid.USD;

  console.log("👥 Mijozlar balansi:", balances.customers);

  const supplierPipeline = [];
  const supplierDateMatch = buildDateMatch(from, to, "createdAt");

  if (Object.keys(supplierDateMatch).length > 0) {
    supplierPipeline.push({ $match: supplierDateMatch });
  }

  supplierPipeline.push(
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
  );

  const supplierBalanceAgg = await Supplier.aggregate(supplierPipeline);

  balances.suppliers.debt.UZS = Number(supplierBalanceAgg[0]?.debtUZS || 0);
  balances.suppliers.debt.USD = Number(supplierBalanceAgg[0]?.debtUSD || 0);
  balances.suppliers.prepaid.UZS = Number(
    supplierBalanceAgg[0]?.prepaidUZS || 0,
  );
  balances.suppliers.prepaid.USD = Number(
    supplierBalanceAgg[0]?.prepaidUSD || 0,
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
     CASHFLOW
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

  const cashflowMovement = {
    UZS:
      customerIn.UZS -
      supplierOut.UZS -
      expenses.UZS.total -
      investor_withdrawals.UZS.total,

    USD:
      customerIn.USD -
      supplierOut.USD -
      expenses.USD.total -
      investor_withdrawals.USD.total,
  };

  const finalBalance = {
    UZS: initialBalance.UZS + cashflowMovement.UZS,
    USD: initialBalance.USD + cashflowMovement.USD,
  };

  console.log("✅ Faqat oqim:", cashflowMovement);
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
     ✅✅✅ BUSINESS CAPITAL - TO'G'RI FORMULA!
     Kassa + Ombor + Mijoz total + Investor yechgan + Taminotchi prepaid - Taminotchi qarzi
  ===================== */
  const businessCapital = {
    UZS:
      finalBalance.UZS + // 💰 Kassa
      inventoryValue.UZS + // 📦 Ombor
      balances.customers.total.UZS + // 👥 Mijoz total (debt - prepaid)
      investor_withdrawals.UZS.total + // 💼 Investor yechgan (+)
      balances.suppliers.prepaid.UZS - // 🏭 Taminotchi prepaid (+)
      balances.suppliers.debt.UZS, // 🏭 Taminotchi qarzi (-)

    USD:
      finalBalance.USD +
      inventoryValue.USD +
      balances.customers.total.USD +
      investor_withdrawals.USD.total +
      balances.suppliers.prepaid.USD -
      balances.suppliers.debt.USD,
  };

  console.log("💼 BIZNES KAPITALI (to'g'ri formula):", businessCapital);

  /* =====================
     TOTAL ASSETS & LIABILITIES
  ===================== */
  const totalAssets = {
    UZS:
      finalBalance.UZS +
      inventoryValue.UZS +
      balances.customers.debt.UZS +
      investor_withdrawals.UZS.total +
      balances.suppliers.prepaid.UZS,
    USD:
      finalBalance.USD +
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
      total: cashflowMovement,
      by_method: {
        UZS: {
          CASH:
            cash_in_summary.customers.UZS.CASH -
            cash_in_summary.suppliers.UZS.CASH -
            expenses.UZS.CASH -
            investor_withdrawals.UZS.CASH,
          CARD:
            cash_in_summary.customers.UZS.CARD -
            cash_in_summary.suppliers.UZS.CARD -
            expenses.UZS.CARD -
            investor_withdrawals.UZS.CARD,
        },
        USD: {
          CASH:
            cash_in_summary.customers.USD.CASH -
            cash_in_summary.suppliers.USD.CASH -
            expenses.USD.CASH -
            investor_withdrawals.USD.CASH,
          CARD:
            cash_in_summary.customers.USD.CARD -
            cash_in_summary.suppliers.USD.CARD -
            expenses.USD.CARD -
            investor_withdrawals.USD.CARD,
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
      supplier_prepaid: balances.suppliers.prepaid,
      supplier_debt: balances.suppliers.debt,
      formula:
        "Kassa + Ombor + Mijoz total + Investor yechgan + Taminotchi prepaid - Taminotchi qarzi",
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

module.exports = {
  getOverview,
  getTimeSeries,
  getTop,
  getStock,
};
