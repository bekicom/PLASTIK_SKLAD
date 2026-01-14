// controllers/cashIn.controller.js

const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Sale = require("../modules/sales/Sale");

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
      paymentDate, // 🆕
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
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      throw new Error("amount musbat bo‘lishi kerak");
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
      .sort({ createdAt: 1 }) // FIFO
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
       2️⃣ CUSTOMER BALANCE
       + → qarz
       - → avans
    ========================= */
    customer.balance[currency] = prevBalance - payAmount;

    /* =========================
       3️⃣ PAYMENT HISTORY
    ========================= */
    customer.payment_history.push({
      currency,
      amount: payAmount,
      direction: "PAYMENT",
      note: note || "Mijoz to‘lovi",
      date: paymentDate ? new Date(paymentDate) : new Date(),
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
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
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

    /* =========================
       🔥 ASOSIY MATCH
       paymentDate bo‘lsa → shuni oladi
       bo‘lmasa → createdAt
    ========================= */
    const match = {
      $expr: {
        $and: [
          {
            $gte: [{ $ifNull: ["$paymentDate", "$createdAt"] }, from],
          },
          {
            $lte: [{ $ifNull: ["$paymentDate", "$createdAt"] }, to],
          },
        ],
      },
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

          // 🔥 REPORT SANASI (frontend uchun)
          reportDate: {
            $ifNull: ["$paymentDate", "$createdAt"],
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

      // 🔥 HISOBOT SANASI BO‘YICHA SORT
      { $sort: { reportDate: -1 } },
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
    const { amount, currency, payment_method, note, paymentDate } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      throw new Error("CashIn ID noto‘g‘ri");
    }

    const cashIn = await CashIn.findById(id).session(session);
    if (!cashIn) throw new Error("Cash-in topilmadi");

    if (cashIn.target_type !== "CUSTOMER") {
      throw new Error("Faqat CUSTOMER cash-in tahrirlanadi");
    }

    const newAmount = Number(amount);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      throw new Error("amount musbat bo‘lishi kerak");
    }

    if (!["UZS", "USD"].includes(currency)) {
      throw new Error("currency noto‘g‘ri");
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      throw new Error("payment_method noto‘g‘ri");
    }

    const customer = await Customer.findById(cashIn.customer_id).session(
      session
    );
    if (!customer) throw new Error("Customer topilmadi");

    /* =========================
       1️⃣ ESKI TA’SIRNI ORQAGA QAYTARISH
    ========================= */
    customer.balance[cashIn.currency] += cashIn.amount;

    /* =========================
       2️⃣ YANGI TA’SIR
    ========================= */
    customer.balance[currency] -= newAmount;

    customer.payment_history.push({
      currency,
      amount: newAmount,
      direction: "PAYMENT",
      note: note || "Cash-in tahrirlandi",
      date: paymentDate ? new Date(paymentDate) : new Date(),
    });

    cashIn.amount = newAmount;
    cashIn.currency = currency;
    cashIn.payment_method = payment_method;
    cashIn.note = note || cashIn.note;
    cashIn.paymentDate = paymentDate
      ? new Date(paymentDate)
      : cashIn.paymentDate;

    await customer.save({ session });
    await cashIn.save({ session });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Cash-in muvaffaqiyatli tahrirlandi",
      balance: customer.balance,
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

