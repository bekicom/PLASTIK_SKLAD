const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");

exports.createCashIn = async (req, res) => {
  try {
    const {
      target_type, // CUSTOMER | SUPPLIER
      customer_id,
      supplier_id,
      amount,
      currency = "UZS",
      note,
    } = req.body || {};

    if (!["CUSTOMER", "SUPPLIER"].includes(target_type)) {
      return res.status(400).json({
        ok: false,
        message: "target_type noto‘g‘ri",
      });
    }

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto‘g‘ri",
      });
    }

    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 bo‘lmasin",
      });
    }

    /* =========================
       TARGET ANIQLASH
    ========================= */
    let doc;
    let label;

    if (target_type === "CUSTOMER") {
      if (!mongoose.isValidObjectId(customer_id)) {
        return res.status(400).json({
          ok: false,
          message: "customer_id noto‘g‘ri",
        });
      }
      doc = await Customer.findById(customer_id);
      label = "Mijoz";
    } else {
      if (!mongoose.isValidObjectId(supplier_id)) {
        return res.status(400).json({
          ok: false,
          message: "supplier_id noto‘g‘ri",
        });
      }
      doc = await Supplier.findById(supplier_id);
      label = "Zavod";
    }

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: `${label} topilmadi`,
      });
    }

    /* =========================
       BALANCE HISOBI 🔥
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
      direction: delta > 0 ? "PAYMENT" : "DEBT",
      note:
        note || (delta > 0 ? `${label}dan to‘lov` : `${label}ga qarz yozildi`),
      date: new Date(),
    });

    await doc.save();

    /* =========================
       CASH-IN LOG
    ========================= */
    await CashIn.create({
      target_type,
      customer_id: customer_id || null,
      supplier_id: supplier_id || null,
      amount: delta,
      currency,
    });

    return res.json({
      ok: true,
      message: "Cash-in muvaffaqiyatli",
      target: {
        type: target_type,
        id: doc._id,
        name: doc.name,
      },
      balance: {
        currency,
        previous: prevBalance,
        current: newBalance,
      },
      change: delta,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};



/* =========================
   GET CASH-IN REPORT
========================= */
exports.getCashInReportAll = async (req, res) => {
  try {
    const { date, currency } = req.query;

    // 📆 Sana (default: bugun)
    const day = date ? new Date(date) : new Date();
    const from = new Date(day.setHours(0, 0, 0, 0));
    const to = new Date(day.setHours(23, 59, 59, 999));

    const match = {
      createdAt: { $gte: from, $lte: to },
    };

    if (currency) {
      match.currency = currency;
    }

    const pipeline = [
      { $match: match },

      // 🔗 MIJOZ ULASH
      {
        $lookup: {
          from: "customers",
          localField: "customer_id",
          foreignField: "_id",
          as: "customer",
        },
      },

      // 🔗 ZAVOD ULASH
      {
        $lookup: {
          from: "suppliers",
          localField: "supplier_id",
          foreignField: "_id",
          as: "supplier",
        },
      },

      // 🎯 KIM EKANINI ANIQLAYMIZ
      {
        $addFields: {
          target_name: {
            $cond: [
              { $gt: [{ $size: "$customer" }, 0] },
              { $arrayElemAt: ["$customer.name", 0] },
              { $arrayElemAt: ["$supplier.name", 0] },
            ],
          },
          target_type: {
            $cond: [
              { $gt: [{ $size: "$customer" }, 0] },
              "CUSTOMER",
              "SUPPLIER",
            ],
          },
        },
      },

      // 🧾 KERAKLI FIELDLAR
      {
        $project: {
          amount: 1,
          currency: 1,
          createdAt: 1,
          target_name: 1,
          target_type: 1,
        },
      },

      // 📊 UMUMIY HISOB
      {
        $group: {
          _id: "$currency",
          total_amount: { $sum: "$amount" },
          count: { $sum: 1 },
          items: {
            $push: {
              name: "$target_name",
              type: "$target_type",
              amount: "$amount",
              date: "$createdAt",
            },
          },
        },
      },
    ];

    const report = await CashIn.aggregate(pipeline);

    return res.json({
      ok: true,
      date: from.toISOString().slice(0, 10),
      report,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
