const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");

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
      payment_method = "CASH", // 🔥 YANGI
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
       BALANCE UPDATE
       (+amount → qarz yopiladi)
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

    const pipeline = [
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

      // 🎯 TARGET INFO
      {
        $addFields: {
          target_name: {
            $cond: [
              { $gt: [{ $size: "$customer" }, 0] },
              { $arrayElemAt: ["$customer.name", 0] },
              { $arrayElemAt: ["$supplier.name", 0] },
            ],
          },
        },
      },

      // 🧹 KERAKSIZ MAYDONLARNI OLIB TASHLAYMIZ
      {
        $project: {
          customer: 0,
          supplier: 0,
          __v: 0,
        },
      },

      // 🕒 YANGILARI OLDIN
      { $sort: { createdAt: -1 } },
    ];

    const list = await CashIn.aggregate(pipeline);

    // 📊 SUMMARY (sodda js bilan)
    const summary = {
      count: list.length,
      totals: {
        UZS: 0,
        USD: 0,
      },
    };

    for (const item of list) {
      summary.totals[item.currency] += item.amount;
    }

    return res.json({
      ok: true,
      date: from.toISOString().slice(0, 10),
      summary,
      report: list, // ✅ FLAT LIST
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Cash-in report olishda xato",
      error: error.message,
    });
  }
};
