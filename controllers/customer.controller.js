const mongoose = require("mongoose");
const Customer = require("../modules/Customer/Customer");
const Sale = require("../modules/sales/Sale");

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

/* =======================
   CREATE CUSTOMER
======================= */
exports.createCustomer = async (req, res) => {
  try {
    const {
      name,
      phone,
      address,
      note,
      opening_balance_uzs = 0,
      opening_balance_usd = 0,
    } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, message: "name majburiy" });
    }

    const balUzs = safeNum(opening_balance_uzs, 0);
    const balUsd = safeNum(opening_balance_usd, 0);

    const payment_history = [];

    if (balUzs !== 0) {
      payment_history.push({
        currency: "UZS",
        amount: Math.abs(balUzs),
        direction: balUzs > 0 ? "DEBT" : "PREPAYMENT",
        note:
          balUzs > 0 ? "Boshlang‘ich qarz (UZS)" : "Boshlang‘ich avans (UZS)",
      });
    }

    if (balUsd !== 0) {
      payment_history.push({
        currency: "USD",
        amount: Math.abs(balUsd),
        direction: balUsd > 0 ? "DEBT" : "PREPAYMENT",
        note:
          balUsd > 0 ? "Boshlang‘ich qarz (USD)" : "Boshlang‘ich avans (USD)",
      });
    }

    const customer = await Customer.create({
      name: name.trim(),
      phone: normalizePhone(phone),
      address: address?.trim(),
      note: note?.trim(),
      balance: {
        UZS: balUzs,
        USD: balUsd,
      },
      payment_history,
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
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "20", 10))
    );
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.isActive === "true") filter.isActive = true;
    if (req.query.isActive === "false") filter.isActive = false;

    if (req.query.search) {
      const r = new RegExp(req.query.search.trim(), "i");
      filter.$or = [{ name: r }, { phone: r }];
    }

    const [items, total] = await Promise.all([
      Customer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    let totals = {
      debt: { UZS: 0, USD: 0 },
      prepaid: { UZS: 0, USD: 0 },
    };

    items.forEach((c) => {
      if (c.balance?.UZS > 0) totals.debt.UZS += c.balance.UZS;
      if (c.balance?.UZS < 0) totals.prepaid.UZS += Math.abs(c.balance.UZS);

      if (c.balance?.USD > 0) totals.debt.USD += c.balance.USD;
      if (c.balance?.USD < 0) totals.prepaid.USD += Math.abs(c.balance.USD);
    });

    return res.json({ ok: true, page, limit, total, totals, items });
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
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const updated = await Customer.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    return res.json({
      ok: true,
      message: "Customer o'chirildi (inactive)",
      data: updated,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer delete xato",
      error: err.message,
    });
  }
};

/**
 * GET /customers/:id/sales?page=&limit=
 * Customer sotuvlari (history list)
 */
exports.getCustomerSales = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "20", 10))
    );
    const skip = (page - 1) * limit;

    const cid = asObjectId(id);

    const filter = { customerId: cid };

    const [rows, total] = await Promise.all([
      Sale.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);

    return res.json({ ok: true, page, limit, total, items: rows });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer sales xato",
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

    const customer = await Customer.findById(id).select(
      "name phone address note createdAt"
    );
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    // 1) Agent orderlar bo‘yicha summary
    const [orderAgg] = await Order.aggregate([
      { $match: { customer_id: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$customer_id",
          ordersCount: { $sum: 1 },
          newCount: { $sum: { $cond: [{ $eq: ["$status", "NEW"] }, 1, 0] } },
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

    // 2) Sales bo‘yicha summary (agar Sale modelda customer_id bo‘lsa)
    const [saleAgg] = await Sale.aggregate([
      { $match: { customer_id: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$customer_id",
          salesCount: { $sum: 1 },
          // ⚠️ Sale modelingizda total field nomi boshqacha bo‘lsa o‘zgartiring
          salesTotalSum: { $sum: { $ifNull: ["$total", 0] } },
          lastSaleAt: { $max: "$createdAt" },
        },
      },
    ]);

    // 3) Oxirgi orderlar ro‘yxati (history)
    const lastOrders = await Order.find({ customer_id: id })
      .populate("agent_id", "name phone login")
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({
      ok: true,
      data: {
        customer,
        orders: {
          ordersCount: orderAgg?.ordersCount || 0,
          newCount: orderAgg?.newCount || 0,
          confirmedCount: orderAgg?.confirmedCount || 0,
          canceledCount: orderAgg?.canceledCount || 0,
          totals: {
            UZS: orderAgg?.totalUZS || 0,
            USD: orderAgg?.totalUSD || 0,
          },
          lastOrderAt: orderAgg?.lastOrderAt || null,
        },
        sales: {
          salesCount: saleAgg?.salesCount || 0,
          total: saleAgg?.salesTotalSum || 0,
          lastSaleAt: saleAgg?.lastSaleAt || null,
        },
        history: {
          lastOrders,
        },
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, message: "Server xatoligi", error: error.message });
  }
};

exports.payCustomerDebt = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let out = null;

    await session.withTransaction(async () => {
      const { id } = req.params;
      const { amount, currency = "UZS", note } = req.body || {};
      const userId = req.user?._id || req.user?.id || req.userId;

      if (!mongoose.isValidObjectId(id))
        throw new Error("customer id noto‘g‘ri");
      if (!["UZS", "USD"].includes(currency))
        throw new Error("currency noto‘g‘ri (UZS/USD)");

      const payAmount = Number(amount);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        throw new Error("amount noto‘g‘ri (0 dan katta bo‘lsin)");
      }

      const customer = await Customer.findById(id).session(session);
      if (!customer) throw new Error("Customer topilmadi");

      // ✅ Sale bo‘yicha match (SIZDA customerId)
      const matchBase = {
        customerId: new mongoose.Types.ObjectId(id),
        status: "COMPLETED",
      };

      const debtPath = `$currencyTotals.${currency}.debtAmount`;
      const paidPath = `$currencyTotals.${currency}.paidAmount`;
      const grandPath = `$currencyTotals.${currency}.grandTotal`;

      // ✅ Avval umumiy qarzni Sale’dan hisoblaymiz
      const [sumAgg] = await Sale.aggregate([
        { $match: matchBase },
        {
          $group: {
            _id: null,
            grand: { $sum: { $ifNull: [grandPath, 0] } },
            paid: { $sum: { $ifNull: [paidPath, 0] } },
            debt: { $sum: { $ifNull: [debtPath, 0] } },
            salesCount: { $sum: 1 },
          },
        },
      ]).session(session);

      const currentDebt = safeNum(sumAgg?.debt, 0);
      if (currentDebt <= 0)
        throw new Error(`Bu hozmakda ${currency} qarz yo‘q`);

      const appliedTotal = Math.min(payAmount, currentDebt);
      const change = Math.max(0, payAmount - currentDebt);

      // ✅ FIFO uchun qarzi bor sale’lar
      const debtFieldSale = `currencyTotals.${currency}.debtAmount`;
      const paidFieldSale = `currencyTotals.${currency}.paidAmount`;

      const sales = await Sale.find({
        ...matchBase,
        [debtFieldSale]: { $gt: 0 },
      })
        .sort({ createdAt: 1 })
        .select("invoiceNo createdAt currencyTotals")
        .lean()
        .session(session);

      let remaining = appliedTotal;
      const bulkOps = [];
      const allocations = [];

      for (const s of sales) {
        if (remaining <= 0) break;

        const cur = (s.currencyTotals && s.currencyTotals[currency]) || {};
        const debt = safeNum(cur.debtAmount, 0);
        const paid = safeNum(cur.paidAmount, 0);
        if (debt <= 0) continue;

        const apply = Math.min(remaining, debt);
        remaining -= apply;

        const newPaid = paid + apply;
        const newDebt = Math.max(0, debt - apply);

        allocations.push({
          sale_id: s._id,
          invoiceNo: s.invoiceNo,
          applied: apply,
          before_debt: debt,
          after_debt: newDebt,
          sale_createdAt: s.createdAt,
        });

        bulkOps.push({
          updateOne: {
            filter: { _id: s._id },
            update: {
              $set: {
                [paidFieldSale]: newPaid,
                [debtFieldSale]: newDebt,
              },
            },
          },
        });
      }

      if (bulkOps.length) await Sale.bulkWrite(bulkOps, { session });

      // ✅ Customer.total_debt_* ni sinxron qilib qo‘yamiz (majburiy emas, lekin qulay)
      const debtFieldCustomer =
        currency === "UZS" ? "total_debt_uzs" : "total_debt_usd";
      customer[debtFieldCustomer] = Math.max(0, currentDebt - appliedTotal);

      // ✅ payment_history bo‘lsa yozamiz (senda qo‘shilgan bo‘lsa)
      if (Array.isArray(customer.payment_history)) {
        customer.payment_history.push({
          currency,
          amount_uzs: currency === "UZS" ? appliedTotal : 0,
          amount_usd: currency === "USD" ? appliedTotal : 0,
          note: `${note || "Qarz to‘lovi"}${
            change > 0 ? ` (Ortiqcha: ${change})` : ""
          }`,
          date: new Date(),
          allocations: allocations.map((a) => ({
            sale_id: a.sale_id,
            applied: a.applied,
            before_debt: a.before_debt,
            after_debt: a.after_debt,
          })),
          createdBy: userId, // agar schema’da yo‘q bo‘lsa olib tashla
        });
      }

      await customer.save({ session });

      out = {
        ok: true,
        message: "To‘lov qabul qilindi (FIFO)",
        customer: {
          id: customer._id,
          name: customer.name,
          phone: customer.phone,
          total_debt_uzs: safeNum(customer.total_debt_uzs, 0),
          total_debt_usd: safeNum(customer.total_debt_usd, 0),
        },
        payment: {
          currency,
          requested_amount: payAmount,
          applied_amount: appliedTotal,
          change,
          previous_debt: currentDebt,
          remaining_debt: Math.max(0, currentDebt - appliedTotal),
        },
        allocations,
      };
    });

    return res.json(out);
  } catch (err) {
    return res
      .status(400)
      .json({ ok: false, message: err?.message || "To‘lovda xato" });
  } finally {
    session.endSession();
  }
};
