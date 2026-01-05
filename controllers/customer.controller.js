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
    const filter = {};

    if (req.query.isActive === "true") filter.isActive = true;
    if (req.query.isActive === "false") filter.isActive = false;

    if (req.query.search) {
      const r = new RegExp(req.query.search.trim(), "i");
      filter.$or = [{ name: r }, { phone: r }];
    }

    const items = await Customer.find(filter).sort({ createdAt: -1 }).lean();

    const total = items.length;

    // 🔥 BALANCE ASOSIDA TOTALS
    const totals = {
      debt: { UZS: 0, USD: 0 },
      prepaid: { UZS: 0, USD: 0 },
    };

    items.forEach((c) => {
      const uzs = Number(c.balance?.UZS || 0);
      const usd = Number(c.balance?.USD || 0);

      if (uzs > 0) totals.debt.UZS += uzs;
      if (uzs < 0) totals.prepaid.UZS += Math.abs(uzs);

      if (usd > 0) totals.debt.USD += usd;
      if (usd < 0) totals.prepaid.USD += Math.abs(usd);
    });

    return res.json({
      ok: true,
      total,
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
      { $match: { customerId: new mongoose.Types.ObjectId(id) } },
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
       3. ORDERS LIST (DETAIL 🔥)
    ========================= */
    const ordersListRaw = await Order.find({ customerId: id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({
        path: "items.productId",
        select: "name model category unit",
      })
      .lean();

    const ordersList = ordersListRaw.map((o) => ({
      _id: o._id,
      status: o.status,
      createdAt: o.createdAt,
      items: (o.items || []).map((it) => ({
        product_id: it.productId?._id || null,
        name: it.productId?.name || "",
        model: it.productId?.model || "",
        category: it.productId?.category || "",
        unit: it.productId?.unit || "",
        qty: it.qty,
        price: it.price,
        currency: it.currency,
        subtotal: it.subtotal,
      })),
      total_uzs: o.total_uzs || 0,
      total_usd: o.total_usd || 0,
    }));

    /* =========================
       4. SALES SUMMARY
    ========================= */
    const [saleAgg] = await Sale.aggregate([
      { $match: { customerId: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$customerId",
          salesCount: { $sum: 1 },
          uzsTotal: {
            $sum: { $ifNull: ["$currencyTotals.UZS.grandTotal", 0] },
          },
          usdTotal: {
            $sum: { $ifNull: ["$currencyTotals.USD.grandTotal", 0] },
          },
          lastSaleAt: { $max: "$createdAt" },
        },
      },
    ]);

    /* =========================
       5. LAST SALES (DETAIL 🔥)
    ========================= */
    const lastSalesRaw = await Sale.find({ customerId: id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({
        path: "items.productId",
        select: "name model category unit",
      })
      .lean();

    const lastSales = lastSalesRaw.map((s) => ({
      _id: s._id,
      invoiceNo: s.invoiceNo,
      status: s.status,
      createdAt: s.createdAt,
      items: (s.items || []).map((it) => ({
        product_id: it.productId?._id || null,
        name: it.productId?.name || "",
        model: it.productId?.model || "",
        category: it.productId?.category || "",
        unit: it.productId?.unit || "",
        qty: it.qty,
        sell_price: it.sell_price,
        currency: it.currency,
        subtotal: it.subtotal,
      })),
      totals: s.totals || {},
      currencyTotals: s.currencyTotals || {},
      note: s.note || "",
    }));

    /* =========================
       6. RESPONSE
    ========================= */
    return res.json({
      ok: true,
      data: {
        customer,

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
          list: ordersList, // 🔥 DETAIL QO‘SHILDI
        },

        sales: {
          total: saleAgg?.salesCount || 0,
          totals: {
            UZS: saleAgg?.uzsTotal || 0,
            USD: saleAgg?.usdTotal || 0,
          },
          lastSaleAt: saleAgg?.lastSaleAt || null,
        },

        history: {
          lastSales, // 🔥 ITEMS BILAN
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


