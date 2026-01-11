// controllers/cashIn.controller.js

const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");
const Purchase = require("../modules/purchases/Purchase");
const Sale = require("../modules/sales/Sale");

exports.createCashIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      target_type, // CUSTOMER | SUPPLIER

      // kim
      customer_id,
      supplier_id,

      // qaysi hujjat
      document_type, // SALE | PURCHASE
      document_id, // sale_id | purchase_id

      amount,
      currency = "UZS",
      payment_method = "CASH",
      note,
    } = req.body || {};

    /* =========================
       VALIDATION
    ========================= */
    if (!["CUSTOMER", "SUPPLIER"].includes(target_type)) {
      throw new Error("target_type noto‘g‘ri");
    }

    if (!["SALE", "PURCHASE"].includes(document_type)) {
      throw new Error("document_type noto‘g‘ri (SALE | PURCHASE)");
    }

    if (!["UZS", "USD"].includes(currency)) {
      throw new Error("currency noto‘g‘ri");
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      throw new Error("payment_method noto‘g‘ri");
    }

    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      throw new Error("amount noto‘g‘ri");
    }

    if (!mongoose.isValidObjectId(document_id)) {
      throw new Error("document_id noto‘g‘ri");
    }

    /* =========================
       TARGET & DOCUMENT LOAD
    ========================= */
    let targetDoc;
    let documentDoc;
    let label;

    if (target_type === "SUPPLIER") {
      if (!mongoose.isValidObjectId(supplier_id)) {
        throw new Error("supplier_id noto‘g‘ri");
      }

      targetDoc = await Supplier.findById(supplier_id).session(session);
      if (!targetDoc) throw new Error("Supplier topilmadi");

      if (document_type !== "PURCHASE") {
        throw new Error(
          "SUPPLIER uchun document_type = PURCHASE bo‘lishi kerak"
        );
      }

      documentDoc = await Purchase.findById(document_id).session(session);
      if (!documentDoc) throw new Error("Purchase (batch) topilmadi");

      label = "Zavod";
    }

    if (target_type === "CUSTOMER") {
      if (!mongoose.isValidObjectId(customer_id)) {
        throw new Error("customer_id noto‘g‘ri");
      }

      targetDoc = await Customer.findById(customer_id).session(session);
      if (!targetDoc) throw new Error("Customer topilmadi");

      if (document_type !== "SALE") {
        throw new Error("CUSTOMER uchun document_type = SALE bo‘lishi kerak");
      }

      documentDoc = await Sale.findById(document_id).session(session);
      if (!documentDoc) throw new Error("Sale topilmadi");

      label = "Mijoz";
    }

    /* =========================
       🔥 PAYMENT LOGIC
    ========================= */
    let remainingPay = payAmount;
    let used = 0;

    // 🏭 SUPPLIER → PURCHASE (BATCH)
    if (target_type === "SUPPLIER") {
      const debt = Number(documentDoc.remaining?.[currency] || 0);
      if (debt <= 0) {
        throw new Error("Bu batch bo‘yicha qarz yo‘q");
      }

      used = Math.min(debt, remainingPay);

      documentDoc.paid[currency] += used;
      documentDoc.remaining[currency] -= used;

      documentDoc.status =
        documentDoc.remaining.UZS === 0 && documentDoc.remaining.USD === 0
          ? "PAID"
          : "PARTIAL";

      remainingPay -= used;

      await documentDoc.save({ session });

      // ortiqcha pul → supplier.balance
      if (remainingPay > 0) {
        targetDoc.balance[currency] =
          Number(targetDoc.balance?.[currency] || 0) + remainingPay;
      }
    }

    // 👤 CUSTOMER → SALE
    if (target_type === "CUSTOMER") {
      const cur = documentDoc.currencyTotals[currency];
      const debt = Number(cur?.debtAmount || 0);
      if (debt <= 0) {
        throw new Error("Bu sale bo‘yicha qarz yo‘q");
      }

      used = Math.min(debt, remainingPay);

      cur.paidAmount += used;
      cur.debtAmount -= used;

      remainingPay -= used;

      await documentDoc.save({ session });

      // ortiqcha pul → customer.balance
      if (remainingPay > 0) {
        targetDoc.balance[currency] =
          Number(targetDoc.balance?.[currency] || 0) + remainingPay;
      }
    }

    /* =========================
       PAYMENT HISTORY
    ========================= */
    targetDoc.payment_history.push({
      currency,
      amount: payAmount,
      direction: "PAYMENT",
      method: payment_method,
      note: note || `${label} uchun to‘lov (${document_type}: ${document_id})`,
      date: new Date(),
    });

    await targetDoc.save({ session });

    /* =========================
       CASH-IN LOG
    ========================= */
    await CashIn.create(
      [
        {
          target_type,
          customer_id: customer_id || null,
          supplier_id: supplier_id || null,
          document_type,
          document_id,
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
      message: "To‘lov muvaffaqiyatli bajarildi",
      target: {
        type: target_type,
        id: targetDoc._id,
        name: targetDoc.name,
      },
      document: {
        type: document_type,
        id: document_id,
      },
      payment: {
        currency,
        amount: payAmount,
        used,
        excess: remainingPay,
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
    const oldTargetType = cashIn.target_type;

    const newAmount = Number(amount);

    if (!Number.isFinite(newAmount) || newAmount === 0) {
      throw new Error("amount 0 bo‘lishi mumkin emas");
    }

    if (!["UZS", "USD"].includes(currency)) {
      throw new Error("currency noto‘g‘ri");
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      throw new Error("payment_method noto‘g‘ri");
    }

    /* =========================
       TARGET LOAD
    ========================= */
    let targetDoc;
    let label;

    if (oldTargetType === "CUSTOMER") {
      targetDoc = await Customer.findById(cashIn.customer_id).session(session);
      label = "Mijoz";
    } else {
      targetDoc = await Supplier.findById(cashIn.supplier_id).session(session);
      label = "Zavod";
    }

    if (!targetDoc) throw new Error(`${label} topilmadi`);

    /* =========================
       1️⃣ ESKI TA’SIRNI ORQAGA QAYTARISH
    ========================= */
    targetDoc.balance[oldCurrency] =
      Number(targetDoc.balance?.[oldCurrency] || 0) + oldAmount;

    /* =========================
       2️⃣ SALE QARZNI ORQAGA OCHISH
       (FAqat CUSTOMER + oldAmount > 0)
    ========================= */
    if (oldTargetType === "CUSTOMER" && oldAmount > 0) {
      const paidField = `currencyTotals.${oldCurrency}.paidAmount`;
      const debtField = `currencyTotals.${oldCurrency}.debtAmount`;

      const sales = await Sale.find({
        customerId: targetDoc._id,
        status: "COMPLETED",
        [paidField]: { $gt: 0 },
      })
        .sort({ createdAt: -1 }) // LIFO qaytarish
        .session(session);

      let remaining = oldAmount;

      for (const s of sales) {
        if (remaining <= 0) break;

        const paid = Number(s.currencyTotals[oldCurrency].paidAmount || 0);
        const used = Math.min(paid, remaining);

        s.currencyTotals[oldCurrency].paidAmount -= used;
        s.currencyTotals[oldCurrency].debtAmount += used;

        remaining -= used;
        await s.save({ session });
      }
    }

    /* =========================
       3️⃣ YANGI TA’SIRNI QO‘LLASH
    ========================= */
    targetDoc.balance[currency] =
      Number(targetDoc.balance?.[currency] || 0) - newAmount;

    /* =========================
       4️⃣ FIFO SALE QARZ YOPISH
       (FAqat CUSTOMER + newAmount > 0)
    ========================= */
    if (oldTargetType === "CUSTOMER" && newAmount > 0) {
      const paidField = `currencyTotals.${currency}.paidAmount`;
      const debtField = `currencyTotals.${currency}.debtAmount`;

      const sales = await Sale.find({
        customerId: targetDoc._id,
        status: "COMPLETED",
        [debtField]: { $gt: 0 },
      })
        .sort({ createdAt: 1 }) // FIFO
        .session(session);

      let remaining = newAmount;

      for (const s of sales) {
        if (remaining <= 0) break;

        const debt = Number(s.currencyTotals[currency].debtAmount || 0);
        const used = Math.min(debt, remaining);

        s.currencyTotals[currency].paidAmount += used;
        s.currencyTotals[currency].debtAmount -= used;

        remaining -= used;
        await s.save({ session });
      }
    }

    /* =========================
       5️⃣ CASH-IN UPDATE
    ========================= */
    cashIn.amount = newAmount;
    cashIn.currency = currency;
    cashIn.payment_method = payment_method;
    cashIn.note = note || cashIn.note;

    await targetDoc.save({ session });
    await cashIn.save({ session });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Cash-in muvaffaqiyatli tahrirlandi",
      before: {
        amount: oldAmount,
        currency: oldCurrency,
      },
      after: {
        amount: newAmount,
        currency,
      },
      target: {
        type: oldTargetType,
        id: targetDoc._id,
        name: targetDoc.name,
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
