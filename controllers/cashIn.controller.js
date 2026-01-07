const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");

const Sale = require("../modules/sales/Sale");  

/* =========================
   CREATE CASH-IN
========================= */
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
    } = req.body || {};

    /* =========================
       VALIDATION
    ========================= */
    if (!["CUSTOMER", "SUPPLIER"].includes(target_type)) {
      throw new Error("target_type noto‘g‘ri (CUSTOMER | SUPPLIER)");
    }

    if (!["UZS", "USD"].includes(currency)) {
      throw new Error("currency noto‘g‘ri (UZS | USD)");
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      throw new Error("payment_method noto‘g‘ri (CASH | CARD)");
    }

    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new Error("amount 0 bo‘lmasligi kerak");
    }

    /* =========================
       TARGET ANIQLASH
    ========================= */
    let doc;
    let label;

    if (target_type === "CUSTOMER") {
      if (!mongoose.isValidObjectId(customer_id)) {
        throw new Error("customer_id noto‘g‘ri");
      }
      doc = await Customer.findById(customer_id).session(session);
      label = "Mijoz";
    } else {
      if (!mongoose.isValidObjectId(supplier_id)) {
        throw new Error("supplier_id noto‘g‘ri");
      }
      doc = await Supplier.findById(supplier_id).session(session);
      label = "Zavod";
    }

    if (!doc) {
      throw new Error(`${label} topilmadi`);
    }

    /* =========================
       🔥 SALE QARZINI YOPISH (FIFO)
       FAQAT MIJOZ + PUL KELSA
    ========================= */
    if (target_type === "CUSTOMER" && delta > 0) {
      const debtField = `currencyTotals.${currency}.debtAmount`;
      const paidField = `currencyTotals.${currency}.paidAmount`;

      const sales = await Sale.find({
        customerId: doc._id,
        status: "COMPLETED",
        [debtField]: { $gt: 0 },
      })
        .sort({ createdAt: 1 }) // FIFO
        .select("_id currencyTotals")
        .session(session);

      let remaining = delta;
      const bulkOps = [];

      for (const s of sales) {
        if (remaining <= 0) break;

        const cur = s.currencyTotals[currency];
        const debt = Number(cur.debtAmount || 0);
        const paid = Number(cur.paidAmount || 0);

        if (debt <= 0) continue;

        const used = Math.min(debt, remaining);
        remaining -= used;

        bulkOps.push({
          updateOne: {
            filter: { _id: s._id },
            update: {
              $set: {
                [paidField]: paid + used,
                [debtField]: debt - used,
              },
            },
          },
        });
      }

      if (bulkOps.length) {
        await Sale.bulkWrite(bulkOps, { session });
      }
    }

    /* =========================
       CUSTOMER / SUPPLIER BALANCE
       FORMULA: old - delta
    ========================= */
    const prevBalance = Number(doc.balance?.[currency] || 0);
    const newBalance = prevBalance - delta;
    doc.balance[currency] = newBalance;

    /* =========================
       PAYMENT HISTORY
    ========================= */
    doc.payment_history.push({
      currency,
      amount: Math.abs(delta),
      direction: delta > 0 ? "PAYMENT" : "ADJUSTMENT",
      method: payment_method,
      note:
        note ||
        (delta > 0
          ? `${label}dan to‘lov (${payment_method})`
          : `${label} balansiga tuzatish`),
      date: new Date(),
    });

    await doc.save({ session });

    /* =========================
       CASH-IN LOG
    ========================= */
    await CashIn.create(
      [
        {
          target_type,
          customer_id: customer_id || null,
          supplier_id: supplier_id || null,
          amount: delta,
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
      message: "Cash-in muvaffaqiyatli",
      target: {
        type: target_type,
        id: doc._id,
        name: doc.name,
      },
      payment: {
        currency,
        amount: delta,
        method: payment_method,
      },
      balance: {
        previous: prevBalance,
        current: newBalance,
      },
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

