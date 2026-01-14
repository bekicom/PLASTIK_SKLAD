const mongoose = require("mongoose");
const Customer = require("../modules/Customer/Customer");
const Sale = require("../modules/sales/Sale");
const Order = require("../modules/orders/Order");


/* =======================
   HELPERS
======================= */
function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/\s+/g, "").trim();
}

function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}



exports.createCustomer = async (req, res) => {
  try {
    const {
      name,
      phone,
      address,
      note,
      balance = {}, // 🔥 ASOSIY
    } = req.body || {};

    if (!name) {
      return res.status(400).json({
        ok: false,
        message: "name majburiy",
      });
    }

    const balUZS = Number(balance.UZS || 0);
    const balUSD = Number(balance.USD || 0);

    const payment_history = [];

    if (balUZS !== 0) {
      payment_history.push({
        currency: "UZS",
        amount: Math.abs(balUZS),
        direction: balUZS > 0 ? "DEBT" : "PREPAYMENT",
        note:
          balUZS > 0
            ? "Boshlang‘ich qarz (UZS)"
            : "Boshlang‘ich avans (UZS)",
        date: new Date(),
      });
    }

    if (balUSD !== 0) {
      payment_history.push({
        currency: "USD",
        amount: Math.abs(balUSD),
        direction: balUSD > 0 ? "DEBT" : "PREPAYMENT",
        note:
          balUSD > 0
            ? "Boshlang‘ich qarz (USD)"
            : "Boshlang‘ich avans (USD)",
        date: new Date(),
      });
    }

    const customer = await Customer.create({
      name: String(name).trim(),
      phone: normalizePhone(phone),
      address: address?.trim() || "",
      note: note?.trim() || "",
      balance: {
        UZS: balUZS,
        USD: balUSD,
      },
      payment_history,
      isActive: true,
    });

    return res.status(201).json({
      ok: true,
      message: "Customer yaratildi",
      customer,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};



/* =======================
   GET CUSTOMERS (LIST)
======================= */
exports.getCustomers = async (req, res) => {
  try {
    const match = {};

    if (req.query.isActive === "true") match.isActive = true;
    if (req.query.isActive === "false") match.isActive = false;

    if (req.query.search) {
      const r = new RegExp(req.query.search.trim(), "i");
      match.$or = [{ name: r }, { phone: r }];
    }

    const items = await Customer.aggregate([
      { $match: match },

      /* 🔗 SALES */
      {
        $lookup: {
          from: "sales",
          let: { customerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$customerId", "$$customerId"] },
                    { $eq: ["$status", "COMPLETED"] },
                  ],
                },
              },
            },
            {
              $project: {
                uzsDebt: { $ifNull: ["$currencyTotals.UZS.debtAmount", 0] },
                usdDebt: { $ifNull: ["$currencyTotals.USD.debtAmount", 0] },
              },
            },
          ],
          as: "sales",
        },
      },

      /* 🔥 DEBT */
      {
        $addFields: {
          debt: {
            UZS: { $sum: "$sales.uzsDebt" },
            USD: { $sum: "$sales.usdDebt" },
          },
        },
      },

      /* 🔥 STATUS */
      {
        $addFields: {
          status: {
            UZS: {
              $cond: [
                { $gt: ["$debt.UZS", 0] },
                "DEBT",
                {
                  $cond: [{ $lt: ["$balance.UZS", 0] }, "PREPAID", "CLEAR"],
                },
              ],
            },
            USD: {
              $cond: [
                { $gt: ["$debt.USD", 0] },
                "DEBT",
                {
                  $cond: [{ $lt: ["$balance.USD", 0] }, "PREPAID", "CLEAR"],
                },
              ],
            },
          },
        },
      },

      /* ⭐ PAYMENT HISTORY SORT */
      {
        $addFields: {
          payment_history: {
            $sortArray: {
              input: "$payment_history",
              sortBy: { date: -1 },
            },
          },
        },
      },

      /* 🧹 CLEAN */
      {
        $project: {
          sales: 0,
          __v: 0,
        },
      },

      { $sort: { createdAt: -1 } },
    ]);

    /* =====================
       TOTALS
    ===================== */
    const totals = {
      debt: { UZS: 0, USD: 0 },
      prepaid: { UZS: 0, USD: 0 },
    };

    for (const c of items) {
      totals.debt.UZS += Number(c.debt?.UZS || 0);
      totals.debt.USD += Number(c.debt?.USD || 0);

      if (c.balance?.UZS < 0) totals.prepaid.UZS += Math.abs(c.balance.UZS);
      if (c.balance?.USD < 0) totals.prepaid.USD += Math.abs(c.balance.USD);
    }

    return res.json({
      ok: true,
      total: items.length,
      totals,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customers olishda xato",
      error: err.message,
    });
  }
};





/* =======================
   GET CUSTOMER BY ID
======================= */
exports.getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ ok: false, message: "ID noto‘g‘ri" });

    const customer = await Customer.findById(id).lean();
    if (!customer)
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });

    return res.json({ ok: true, customer });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer olishda xato",
      error: err.message,
    });
  }
};

/* =======================
   UPDATE CUSTOMER
======================= */
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ ok: false, message: "ID noto‘g‘ri" });

    const patch = {};
    if (req.body.name !== undefined) patch.name = req.body.name.trim();
    if (req.body.phone !== undefined)
      patch.phone = normalizePhone(req.body.phone);
    if (req.body.address !== undefined) patch.address = req.body.address.trim();
    if (req.body.note !== undefined) patch.note = req.body.note.trim();
    if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;

    const updated = await Customer.findByIdAndUpdate(id, patch, {
      new: true,
    });

    if (!updated)
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });

    return res.json({
      ok: true,
      message: "Customer yangilandi",
      customer: updated,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer update xato",
      error: err.message,
    });
  }
};

/* =======================
   UPDATE CUSTOMER BALANCE
======================= */
exports.updateCustomerBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { currency, amount, note } = req.body;

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ message: "ID noto‘g‘ri" });
    if (!["UZS", "USD"].includes(currency))
      return res.status(400).json({ message: "currency noto‘g‘ri" });

    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0)
      return res.status(400).json({ message: "amount noto‘g‘ri" });

    const customer = await Customer.findById(id);
    if (!customer)
      return res.status(404).json({ message: "Customer topilmadi" });

    customer.balance[currency] += delta;

    customer.payment_history.push({
      currency,
      amount: Math.abs(delta),
      direction: delta > 0 ? "DEBT" : "PAYMENT",
      note: note || "Balance o‘zgartirildi",
      date: new Date(),
    });

    await customer.save();

    return res.json({
      ok: true,
      message: "Balance yangilandi",
      balance: customer.balance,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Balance update xato",
      error: err.message,
    });
  }
};

/**
 * DELETE /customers/:id  (soft delete)
 */
exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "Customer ID noto‘g‘ri",
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Customer topilmadi",
      });
    }

    // 🔥 AGAR QARZI BO‘LSA → O‘CHIRILMAYDI
    if (
      Number(customer.balance?.UZS || 0) !== 0 ||
      Number(customer.balance?.USD || 0) !== 0
    ) {
      return res.status(400).json({
        ok: false,
        message: "Customer balansida qarz/avans bor, o‘chirish mumkin emas",
      });
    }

    await Customer.deleteOne({ _id: id });

    return res.json({
      ok: true,
      message: "Customer butunlay o‘chirildi",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer delete xato",
      error: err.message,
    });
  }
};




exports.getCustomerSales = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ ok: false, message: "Customer ID noto‘g‘ri" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "20", 10))
    );
    const skip = (page - 1) * limit;

    const onlyDebt = req.query.onlyDebt === "true";
    const currencyFilter =
      req.query.currency && ["UZS", "USD"].includes(req.query.currency)
        ? req.query.currency
        : null;

    /* =====================
       FILTER
    ===================== */
    const filter = {
      customerId: new mongoose.Types.ObjectId(id),
      status: "COMPLETED",
    };

    if (onlyDebt) {
      if (currencyFilter) {
        filter[`currencyTotals.${currencyFilter}.debtAmount`] = { $gt: 0 };
      } else {
        filter.$or = [
          { "currencyTotals.UZS.debtAmount": { $gt: 0 } },
          { "currencyTotals.USD.debtAmount": { $gt: 0 } },
        ];
      }
    }

    /* =====================
       QUERY
    ===================== */
    const [rows, total] = await Promise.all([
      Sale.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("invoiceNo createdAt items totals currencyTotals payments note")
        .lean(),
      Sale.countDocuments(filter),
    ]);

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows.map((s) => {
      const remUZS = Number(s.currencyTotals?.UZS?.debtAmount || 0);
      const remUSD = Number(s.currencyTotals?.USD?.debtAmount || 0);

      let status = "PAID";
      if (remUZS > 0 || remUSD > 0) {
        const paidUZS = Number(s.currencyTotals?.UZS?.paidAmount || 0);
        const paidUSD = Number(s.currencyTotals?.USD?.paidAmount || 0);
        status = paidUZS > 0 || paidUSD > 0 ? "PARTIAL" : "DEBT";
      }

      return {
        _id: s._id,
        invoiceNo: s.invoiceNo,
        createdAt: s.createdAt,
        status,

        totals: s.totals,
        currencyTotals: s.currencyTotals,

        remaining: {
          UZS: remUZS,
          USD: remUSD,
        },

        items: (s.items || []).map((it) => ({
          productId: it.productId,
          name: it.productSnapshot?.name,
          unit: it.productSnapshot?.unit,
          qty: Number(it.qty),
          price: Number(it.sell_price),
          currency: it.currency,
          subtotal: Number(it.subtotal),
        })),

        note: s.note || "",
      };
    });

    return res.json({
      ok: true,
      page,
      limit,
      total,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer sales olishda xato",
      error: err.message,
    });
  }
};


/**
 * GET /customers/:id/statement?dateFrom=&dateTo=
 * Kunma-kun: total, paid, debt (UZS/USD)
 */
exports.getCustomerStatement = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const match = {
      customerId: asObjectId(id),
      status: "COMPLETED",
    };

    if (req.query.dateFrom || req.query.dateTo) {
      match.createdAt = {};
      if (req.query.dateFrom)
        match.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) match.createdAt.$lte = new Date(req.query.dateTo);
    }

    const rows = await Sale.aggregate([
      { $match: match },
      {
        $addFields: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        },
      },
      {
        $group: {
          _id: "$day",

          uzsGrand: {
            $sum: { $ifNull: ["$currencyTotals.UZS.grandTotal", 0] },
          },
          uzsPaid: { $sum: { $ifNull: ["$currencyTotals.UZS.paidAmount", 0] } },
          uzsDebt: { $sum: { $ifNull: ["$currencyTotals.UZS.debtAmount", 0] } },

          usdGrand: {
            $sum: { $ifNull: ["$currencyTotals.USD.grandTotal", 0] },
          },
          usdPaid: { $sum: { $ifNull: ["$currencyTotals.USD.paidAmount", 0] } },
          usdDebt: { $sum: { $ifNull: ["$currencyTotals.USD.debtAmount", 0] } },

          salesCount: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    // outputni chiroyliroq qilish
    const items = rows.map((r) => ({
      day: r._id,
      salesCount: Number(r.salesCount || 0),
      UZS: {
        grandTotal: Number(r.uzsGrand || 0),
        paidAmount: Number(r.uzsPaid || 0),
        debtAmount: Number(r.uzsDebt || 0),
      },
      USD: {
        grandTotal: Number(r.usdGrand || 0),
        paidAmount: Number(r.usdPaid || 0),
        debtAmount: Number(r.usdDebt || 0),
      },
    }));

    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Statement xato",
      error: err.message,
    });
  }
};

exports.getCustomerSummary = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ ok: false, message: "customer id noto‘g‘ri" });
    }

    const customerId = new mongoose.Types.ObjectId(id);

    /* =========================
       1. CUSTOMER
    ========================= */
    const customer = await Customer.findById(id)
      .select("name phone address note createdAt balance")
      .lean();

    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    /* =========================
       2. ORDERS SUMMARY
    ========================= */
    const [orderAgg] = await Order.aggregate([
      { $match: { customerId } },
      {
        $group: {
          _id: "$customerId",
          ordersCount: { $sum: 1 },
          newCount: {
            $sum: { $cond: [{ $eq: ["$status", "NEW"] }, 1, 0] },
          },
          confirmedCount: {
            $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] },
          },
          canceledCount: {
            $sum: { $cond: [{ $eq: ["$status", "CANCELED"] }, 1, 0] },
          },
          totalUZS: { $sum: { $ifNull: ["$total_uzs", 0] } },
          totalUSD: { $sum: { $ifNull: ["$total_usd", 0] } },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ]);

    /* =========================
       3. SALES AGGREGATION 🔥
    ========================= */
    const [salesAgg] = await Sale.aggregate([
      { $match: { customerId, status: "COMPLETED" } },
      {
        $group: {
          _id: "$customerId",
          salesCount: { $sum: 1 },

          totalUZS: {
            $sum: { $ifNull: ["$currencyTotals.UZS.grandTotal", 0] },
          },
          totalUSD: {
            $sum: { $ifNull: ["$currencyTotals.USD.grandTotal", 0] },
          },

          paidUZS: {
            $sum: { $ifNull: ["$currencyTotals.UZS.paidAmount", 0] },
          },
          paidUSD: {
            $sum: { $ifNull: ["$currencyTotals.USD.paidAmount", 0] },
          },

          debtUZS: {
            $sum: { $ifNull: ["$currencyTotals.UZS.debtAmount", 0] },
          },
          debtUSD: {
            $sum: { $ifNull: ["$currencyTotals.USD.debtAmount", 0] },
          },

          // 🔥 MUHIM: createdAt emas
          lastSaleAt: { $max: "$saleDate" },
        },
      },
    ]);

    /* =========================
       4. LAST SALES (DETAIL)
    ========================= */
    const lastSalesRaw = await Sale.find({
      customerId,
      status: "COMPLETED",
    })
      .sort({ saleDate: -1 }) // 🔥 ASOSIY SANA
      .limit(10)
      .lean();

    const lastSales = lastSalesRaw.map((s) => {
      const remUZS = Number(s.currencyTotals?.UZS?.debtAmount || 0);
      const remUSD = Number(s.currencyTotals?.USD?.debtAmount || 0);

      let saleStatus = "PAID";
      if (remUZS > 0 || remUSD > 0) {
        const paid =
          Number(s.currencyTotals?.UZS?.paidAmount || 0) +
          Number(s.currencyTotals?.USD?.paidAmount || 0);
        saleStatus = paid > 0 ? "PARTIAL" : "DEBT";
      }

      return {
        _id: s._id,
        invoiceNo: s.invoiceNo,

        // 🔥 frontend ishlatadigan sana
        saleDate: s.saleDate || s.createdAt,

        status: saleStatus,

        totals: s.totals,
        currencyTotals: s.currencyTotals,

        remaining: {
          UZS: remUZS,
          USD: remUSD,
        },

        // 🔥 FAQAT SNAPSHOT
        items: (s.items || []).map((it) => ({
          productId: it.productId,

          name: it.productSnapshot?.name || "",
          model: it.productSnapshot?.model || "",
          color: it.productSnapshot?.color || "",
          category: it.productSnapshot?.category || "",
          unit: it.productSnapshot?.unit || "",

          qty: it.qty,
          price: it.sell_price,
          currency: it.currency,
          subtotal: it.subtotal,
        })),

        note: s.note || "",
      };
    });

    const salesSummary = salesAgg || {};

    /* =========================
       5. RESPONSE
    ========================= */
    return res.json({
      ok: true,
      data: {
        customer: {
          ...customer,
          balance: customer.balance || { UZS: 0, USD: 0 },
        },

        orders: {
          total: orderAgg?.ordersCount || 0,
          NEW: orderAgg?.newCount || 0,
          CONFIRMED: orderAgg?.confirmedCount || 0,
          CANCELED: orderAgg?.canceledCount || 0,
          totals: {
            UZS: orderAgg?.totalUZS || 0,
            USD: orderAgg?.totalUSD || 0,
          },
          lastOrderAt: orderAgg?.lastOrderAt || null,
        },

        sales: {
          total: salesSummary.salesCount || 0,
          totals: {
            UZS: salesSummary.totalUZS || 0,
            USD: salesSummary.totalUSD || 0,
          },
          paid: {
            UZS: salesSummary.paidUZS || 0,
            USD: salesSummary.paidUSD || 0,
          },
          debt: {
            UZS: salesSummary.debtUZS || 0,
            USD: salesSummary.debtUSD || 0,
          },
          lastSaleAt: salesSummary.lastSaleAt || null,
        },

        history: {
          lastSales,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Customer summary olishda xato",
      error: error.message,
    });
  }
};




exports.payCustomerDebt = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(async () => {
      const { id } = req.params;
      const { amount, currency = "UZS", note } = req.body || {};

      if (!mongoose.isValidObjectId(id)) {
        throw new Error("customer id noto‘g‘ri");
      }

      if (!["UZS", "USD"].includes(currency)) {
        throw new Error("currency noto‘g‘ri (UZS/USD)");
      }

      const delta = Number(amount);

      // 🔥 FAQAT 0 BO‘LMASIN
      if (!Number.isFinite(delta) || delta === 0) {
        throw new Error("amount 0 ga teng bo‘lmasin");
      }

      const customer = await Customer.findById(id).session(session);
      if (!customer) throw new Error("Customer topilmadi");

      /* =========================
         1. OLDINGI BALANCE
         + → qarz
         - → avans
      ========================= */
      const prevBalance = Number(customer.balance?.[currency] || 0);
      const currentDebt = Math.max(0, prevBalance);

      /* =========================
         2. AGAR amount > 0 bo‘lsa
         → qarz yopiladi (FIFO)
      ========================= */
      if (delta > 0 && currentDebt > 0) {
        const applied = Math.min(delta, currentDebt);

        const debtField = `currencyTotals.${currency}.debtAmount`;
        const paidField = `currencyTotals.${currency}.paidAmount`;

        const sales = await Sale.find({
          customerId: customer._id,
          status: "COMPLETED",
          [debtField]: { $gt: 0 },
        })
          .sort({ createdAt: 1 })
          .select("currencyTotals")
          .lean()
          .session(session);

        let remaining = applied;
        const bulkOps = [];

        for (const s of sales) {
          if (remaining <= 0) break;

          const cur = s.currencyTotals[currency];
          const debt = Number(cur.debtAmount || 0);
          const paid = Number(cur.paidAmount || 0);

          if (debt <= 0) continue;

          const use = Math.min(remaining, debt);
          remaining -= use;

          bulkOps.push({
            updateOne: {
              filter: { _id: s._id },
              update: {
                $set: {
                  [paidField]: paid + use,
                  [debtField]: debt - use,
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
         3. CUSTOMER BALANCE
         🔥 ASOSIY FORMULA
      ========================= */
      customer.balance[currency] = prevBalance - delta;
      // delta > 0  → balance kamayadi
      // delta < 0  → balance oshadi

      /* =========================
         4. PAYMENT HISTORY
      ========================= */
      customer.payment_history.push({
        currency,
        amount: Math.abs(delta),
        direction: delta > 0 ? "PAYMENT" : "DEBT",
        note:
          note ||
          (delta > 0 ? "Qarz to‘lovi / avans" : "Mijozdan qarz yozildi"),
        date: new Date(),
      });

      await customer.save({ session });

      result = {
        ok: true,
        message: "Customer balance yangilandi",
        customer: {
          id: customer._id,
          name: customer.name,
          balance: customer.balance,
        },
        change: {
          currency,
          amount: delta,
          previous_balance: prevBalance,
          current_balance: customer.balance[currency],
        },
      };
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      ok: false,
      message: err.message || "To‘lovda xato",
    });
  } finally {
    session.endSession();
  }
};


// controllers/customer.controller.js

exports.getCustomerDebtSales = async (req, res) => {
  try {
    const { id } = req.params;
    const { currency } = req.query;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ ok: false, message: "customer id noto‘g‘ri" });
    }

    const match = {
      customerId: new mongoose.Types.ObjectId(id),
      status: { $ne: "CANCELED" },
      $or: [
        { "currencyTotals.UZS.debtAmount": { $gt: 0 } },
        { "currencyTotals.USD.debtAmount": { $gt: 0 } },
      ],
    };

    if (currency && ["UZS", "USD"].includes(currency)) {
      match[`currencyTotals.${currency}.debtAmount`] = { $gt: 0 };
    }

    const rows = await Sale.find(match)
      .sort({ createdAt: 1 }) // FIFO 🔥
      .lean();

    const totals = { UZS: 0, USD: 0 };

    const items = rows.map((s) => {
      const uzsDebt = Number(s.currencyTotals?.UZS?.debtAmount || 0);
      const usdDebt = Number(s.currencyTotals?.USD?.debtAmount || 0);

      totals.UZS += uzsDebt;
      totals.USD += usdDebt;

      return {
        _id: s._id,
        invoiceNo: s.invoiceNo,
        createdAt: s.createdAt,
        status:
          uzsDebt === 0 && usdDebt === 0
            ? "PAID"
            : uzsDebt > 0 &&
              (s.currencyTotals.UZS.paidAmount || 0) > 0
            ? "PARTIAL"
            : "DEBT",

        remaining: {
          UZS: uzsDebt,
          USD: usdDebt,
        },

        items: (s.items || []).map((it) => ({
          productId: it.productId,
          name: it.productSnapshot?.name || "",
          unit: it.productSnapshot?.unit || "",
          qty: it.qty,
          price: it.sell_price,
          currency: it.currency,
          subtotal: it.subtotal,
        })),
      };
    });

    return res.json({
      ok: true,
      total: items.length,
      totals,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer debt sales olishda xato",
      error: err.message,
    });
  }
};
// controllers/customer.controller.js
exports.getCustomerTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "customer id noto‘g‘ri" });
    }

    const customerId = new mongoose.Types.ObjectId(id);

    /* =====================
       DATE FILTER
    ===================== */
    const dateFilter = {};
    if (req.query.from) dateFilter.$gte = new Date(req.query.from);
    if (req.query.to) dateFilter.$lte = new Date(req.query.to);

    /* =====================
       1️⃣ SALES
    ===================== */
    const sales = await Sale.find({
      customerId,
      status: "COMPLETED",
      ...(Object.keys(dateFilter).length ? { saleDate: dateFilter } : {}),
    })
      .select("invoiceNo saleDate currencyTotals")
      .lean();

    const saleEvents = sales.map((s) => ({
      type: "SALE",
      date: s.saleDate || s.createdAt,
      ref: s.invoiceNo,
      UZS: {
        debit: Number(s.currencyTotals?.UZS?.debtAmount || 0),
        credit: 0,
      },
      USD: {
        debit: Number(s.currencyTotals?.USD?.debtAmount || 0),
        credit: 0,
      },
    }));

    /* =====================
       2️⃣ PAYMENTS (history)
    ===================== */
    const customer = await Customer.findById(id)
      .select("payment_history")
      .lean();

    const paymentEvents = (customer.payment_history || []).map((p) => ({
      type: p.direction === "PAYMENT" ? "PAYMENT" : p.direction,
      date: p.date,
      note: p.note || "",
      UZS: {
        debit: p.currency === "UZS" && p.direction !== "PAYMENT" ? p.amount : 0,
        credit: p.currency === "UZS" && p.direction === "PAYMENT" ? p.amount : 0,
      },
      USD: {
        debit: p.currency === "USD" && p.direction !== "PAYMENT" ? p.amount : 0,
        credit: p.currency === "USD" && p.direction === "PAYMENT" ? p.amount : 0,
      },
    }));

    /* =====================
       3️⃣ MERGE + SORT
    ===================== */
    const timelineRaw = [...saleEvents, ...paymentEvents].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    /* =====================
       4️⃣ RUNNING BALANCE
    ===================== */
    let balUZS = 0;
    let balUSD = 0;

    const timeline = timelineRaw.map((e) => {
      balUZS += (e.UZS.debit || 0) - (e.UZS.credit || 0);
      balUSD += (e.USD.debit || 0) - (e.USD.credit || 0);

      return {
        ...e,
        balanceAfter: {
          UZS: balUZS,
          USD: balUSD,
        },
      };
    });

    return res.json({
      ok: true,
      customerId: id,
      total: timeline.length,
      timeline,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer timeline olishda xato",
      error: err.message,
    });
  }
};
