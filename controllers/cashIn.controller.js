

const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");
const Sale = require("../modules/sales/Sale");

exports.createCashIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      target_type, // CUSTOMER | SUPPLIER
      customer_id,
      supplier_id,
      amount,
      currency = "UZS",
      payment_method = "CASH",
      note,
      paymentDate,
    } = req.body || {};

    /* ================= VALIDATION ================= */
    if (!["CUSTOMER", "SUPPLIER"].includes(target_type)) {
      throw new Error("target_type CUSTOMER yoki SUPPLIER bo‘lishi kerak");
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

    const payDate = paymentDate ? new Date(paymentDate) : new Date();

    /* =================================================
       🔵 CUSTOMER CASH-IN
    ================================================= */
    if (target_type === "CUSTOMER") {
      if (!mongoose.isValidObjectId(customer_id))
        throw new Error("customer_id noto‘g‘ri");

      const customer = await Customer.findById(customer_id).session(session);
      if (!customer) throw new Error("Customer topilmadi");

      const beforeBalance = Number(customer.balance?.[currency] || 0);

      /* 🔥 FIFO SALE QARZ YOPISH */
      let remaining = payAmount;

      const sales = await Sale.find({
        customerId: customer._id,
        [`currencyTotals.${currency}.debtAmount`]: { $gt: 0 },
      })
        .sort({ saleDate: 1 })
        .session(session);

      for (const sale of sales) {
        if (remaining <= 0) break;

        const debt = Number(
          sale.currencyTotals[currency].debtAmount || 0
        );
        const used = Math.min(debt, remaining);

        sale.currencyTotals[currency].paidAmount += used;
        sale.currencyTotals[currency].debtAmount -= used;

        remaining -= used;
        await sale.save({ session });
      }

      /* 🔥 BALANCE */
      customer.balance[currency] = beforeBalance - payAmount;

      customer.payment_history.push({
        currency,
        amount: payAmount,
        direction: "PAYMENT",
        note: note || "Mijoz to‘lovi",
        date: payDate,
      });

      await customer.save({ session });

      await CashIn.create(
        [
          {
            target_type: "CUSTOMER",
            customer_id,
            amount: payAmount,
            currency,
            payment_method,
            paymentDate: payDate,
            note: note || "",
          },
        ],
        { session }
      );

      await session.commitTransaction();

      return res.json({
        ok: true,
        message: "Mijozdan to‘lov qabul qilindi",
        before_balance: beforeBalance,
        after_balance: customer.balance[currency],
      });
    }

    /* =================================================
       🟠 SUPPLIER CASH-IN
    ================================================= */
    if (target_type === "SUPPLIER") {
      if (!mongoose.isValidObjectId(supplier_id))
        throw new Error("supplier_id noto‘g‘ri");

      const supplier = await Supplier.findById(supplier_id).session(session);
      if (!supplier) throw new Error("Supplier topilmadi");

      const beforeBalance = Number(supplier.balance?.[currency] || 0);

      /* 🔥 SUPPLIER BALANCE */
      supplier.balance[currency] = beforeBalance - payAmount;

      supplier.payment_history.push({
        currency,
        amount: payAmount,
        direction: "PAYMENT",
        note: note || "Supplierga to‘lov",
        date: payDate,
      });

      await supplier.save({ session });

      await CashIn.create(
        [
          {
            target_type: "SUPPLIER",
            supplier_id,
            amount: payAmount,
            currency,
            payment_method,
            paymentDate: payDate,
            note: note || "",
          },
        ],
        { session }
      );

      await session.commitTransaction();

      return res.json({
        ok: true,
        message: "Supplierga to‘lov amalga oshirildi",
        before_balance: beforeBalance,
        after_balance: supplier.balance[currency],
      });
    }
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
    const { from, to, currency, payment_method } = req.query;

    /* =========================
       📆 DATE RANGE
       agar berilmasa → bugun
    ========================= */
    const fromDate = from
      ? new Date(new Date(from).setHours(0, 0, 0, 0))
      : new Date(new Date().setHours(0, 0, 0, 0));

    const toDate = to
      ? new Date(new Date(to).setHours(23, 59, 59, 999))
      : new Date(new Date().setHours(23, 59, 59, 999));

    /* =========================
       🔥 ASOSIY MATCH
       paymentDate ustun
    ========================= */
    const match = {
      $expr: {
        $and: [
          {
            $gte: [{ $ifNull: ["$paymentDate", "$createdAt"] }, fromDate],
          },
          {
            $lte: [{ $ifNull: ["$paymentDate", "$createdAt"] }, toDate],
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

      {
        $lookup: {
          from: "customers",
          localField: "customer_id",
          foreignField: "_id",
          as: "customer",
        },
      },
      {
        $lookup: {
          from: "suppliers",
          localField: "supplier_id",
          foreignField: "_id",
          as: "supplier",
        },
      },

      {
        $addFields: {
          target_name: {
            $cond: [
              { $eq: ["$target_type", "CUSTOMER"] },
              { $arrayElemAt: ["$customer.name", 0] },
              { $arrayElemAt: ["$supplier.name", 0] },
            ],
          },
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

      { $sort: { reportDate: -1 } },
    ]);

    /* =========================
       SUMMARY
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
      range: {
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
      },
      summary: {
        customers_paid: summary.CUSTOMER,
        suppliers_paid: summary.SUPPLIER,
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

