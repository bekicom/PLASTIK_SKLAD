// controllers/cashIn.controller.js

const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");
const Purchase = require("../modules/purchases/Purchase");
const Sale = require("../modules/sales/Sale");

// controllers/cashIn.controller.js

// controllers/cashIn.controller.js (CUSTOMER)

exports.createCashIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      target_type,
      customer_id,
      amount,
      currency = "UZS",
      payment_method = "CASH",
      note,
    } = req.body || {};

    /* =========================
       VALIDATION
    ========================= */
    if (target_type !== "CUSTOMER") {
      throw new Error("Faqat CUSTOMER cash-in ruxsat etilgan");
    }

    if (!mongoose.isValidObjectId(customer_id)) {
      throw new Error("customer_id noto‘g‘ri");
    }

    if (!["UZS", "USD"].includes(currency)) {
      throw new Error("currency noto‘g‘ri");
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      throw new Error("payment_method noto‘g‘ri");
    }

    const payAmount = Number(amount);
 if (!Number.isFinite(payAmount) || payAmount === 0) {
   throw new Error("amount 0 bo‘lishi mumkin emas");
 }


    /* =========================
       LOAD CUSTOMER
    ========================= */
    const customer = await Customer.findById(customer_id).session(session);
    if (!customer) throw new Error("Customer topilmadi");

    const prevBalance = Number(customer.balance?.[currency] || 0);

    /* =========================
       1️⃣ SALE QARZLARINI FIFO YOPISH
    ========================= */
    let remaining = payAmount;

    const debtField = `currencyTotals.${currency}.debtAmount`;
    const paidField = `currencyTotals.${currency}.paidAmount`;

    const sales = await Sale.find({
      customerId: customer._id,
      status: "COMPLETED",
      [debtField]: { $gt: 0 },
    })
      .sort({ createdAt: 1 }) // FIFO 🔥
      .session(session);

    for (const s of sales) {
      if (remaining <= 0) break;

      const debt = Number(s.currencyTotals[currency].debtAmount || 0);
      if (debt <= 0) continue;

      const used = Math.min(debt, remaining);

      s.currencyTotals[currency].paidAmount += used;
      s.currencyTotals[currency].debtAmount -= used;

      remaining -= used;
      await s.save({ session });
    }

    /* =========================
       2️⃣ CUSTOMER BALANCE UPDATE
       🔥 ASOSIY FORMULA
    ========================= */
    customer.balance[currency] = prevBalance - payAmount;

    /* =========================
       3️⃣ PAYMENT HISTORY
    ========================= */
    customer.payment_history.push({
      currency,
      amount: payAmount,
      direction: "PAYMENT",
      method: payment_method,
      note: note || "Mijoz to‘lovi",
      date: new Date(),
    });

    await customer.save({ session });

    /* =========================
       4️⃣ CASH-IN LOG
    ========================= */
    await CashIn.create(
      [
        {
          target_type: "CUSTOMER",
          customer_id,
          amount: payAmount,
          currency,
          payment_method,
          note: note || "",
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Mijozdan to‘lov qabul qilindi",
      before_balance: prevBalance,
      after_balance: customer.balance[currency],
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};




/* =========================
   GET CASH-IN REPORT (DAY)
========================= */
exports.getCashInReportAll = async (req, res) => {
  try {
    const { date, currency, payment_method } = req.query;

    // 📆 Sana (default: bugun)
    const baseDay = date ? new Date(date) : new Date();
    const from = new Date(baseDay.setHours(0, 0, 0, 0));
    const to = new Date(baseDay.setHours(23, 59, 59, 999));

    const match = {
      createdAt: { $gte: from, $lte: to },
    };

    if (currency && ["UZS", "USD"].includes(currency)) {
      match.currency = currency;
    }

    if (payment_method && ["CASH", "CARD"].includes(payment_method)) {
      match.payment_method = payment_method;
    }

    /* =========================
       LIST
    ========================= */
    const list = await CashIn.aggregate([
      { $match: match },

      // 🔗 CUSTOMER
      {
        $lookup: {
          from: "customers",
          localField: "customer_id",
          foreignField: "_id",
          as: "customer",
        },
      },

      // 🔗 SUPPLIER
      {
        $lookup: {
          from: "suppliers",
          localField: "supplier_id",
          foreignField: "_id",
          as: "supplier",
        },
      },

      // 🎯 TARGET NAME
      {
        $addFields: {
          target_name: {
            $cond: [
              { $eq: ["$target_type", "CUSTOMER"] },
              { $arrayElemAt: ["$customer.name", 0] },
              { $arrayElemAt: ["$supplier.name", 0] },
            ],
          },
        },
      },

      {
        $project: {
          customer: 0,
          supplier: 0,
          __v: 0,
        },
      },

      { $sort: { createdAt: -1 } },
    ]);

    /* =========================
       SUMMARY (MIJOZ / ZAVOD)
    ========================= */
    const summary = {
      CUSTOMER: { UZS: 0, USD: 0 },
      SUPPLIER: { UZS: 0, USD: 0 },
    };

    for (const it of list) {
      if (!summary[it.target_type]) continue;
      summary[it.target_type][it.currency] += Number(it.amount) || 0;
    }

    return res.json({
      ok: true,
      date: from.toISOString().slice(0, 10),
      summary: {
        customers_paid: summary.CUSTOMER, // 💰 mijozlardan tushgan
        suppliers_paid: summary.SUPPLIER, // 🏭 zavodlarga berilgan
      },
      report: list,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Cash-in report olishda xato",
      error: error.message,
    });
  }
};

/* =========================
   EDIT CASH-IN
========================= */
exports.editCashIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { amount, currency, payment_method, note } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      throw new Error("CashIn ID noto‘g‘ri");
    }

    const cashIn = await CashIn.findById(id).session(session);
    if (!cashIn) throw new Error("Cash-in topilmadi");

    const oldAmount = Number(cashIn.amount);
    const oldCurrency = cashIn.currency;

    const newAmount = Number(amount);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      throw new Error("amount noto‘g‘ri");
    }

    if (!["UZS", "USD"].includes(currency)) {
      throw new Error("currency noto‘g‘ri");
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      throw new Error("payment_method noto‘g‘ri");
    }

    const supplier = await Supplier.findById(cashIn.supplier_id).session(
      session
    );
    if (!supplier) throw new Error("Supplier topilmadi");

    /* =========================
       1️⃣ ESKI TA’SIRNI ORQAGA QAYTARISH
    ========================= */
    supplier.balance[oldCurrency] =
      Number(supplier.balance?.[oldCurrency] || 0) + oldAmount;

    /* =========================
       2️⃣ YANGI TA’SIRNI QO‘LLASH
    ========================= */
    supplier.balance[currency] =
      Number(supplier.balance?.[currency] || 0) - newAmount;

    supplier.payment_history.push({
      currency,
      amount: newAmount,
      direction: "PREPAYMENT",
      method: payment_method,
      note: note || "Cash-in tahrirlandi",
      date: new Date(),
    });

    cashIn.amount = newAmount;
    cashIn.currency = currency;
    cashIn.payment_method = payment_method;
    cashIn.note = note || cashIn.note;

    await supplier.save({ session });
    await cashIn.save({ session });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Cash-in muvaffaqiyatli tahrirlandi",
      before: { amount: oldAmount, currency: oldCurrency },
      after: { amount: newAmount, currency },
      balance: supplier.balance,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: error.message,
    });
  } finally {
    session.endSession();
  }
};

