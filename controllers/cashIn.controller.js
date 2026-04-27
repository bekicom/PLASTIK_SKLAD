const mongoose = require("mongoose");
const CashIn = require("../modules/cashIn/CashIn");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");
const Sale = require("../modules/sales/Sale");

function removeHistoryEntry(entity, cashIn, fallbackDirection = "PAYMENT") {
  const cashDate = new Date(cashIn.paymentDate || cashIn.createdAt).toISOString();
  entity.payment_history = (entity.payment_history || []).filter((h) => {
    if (h.ref_id) {
      return String(h.ref_id) !== String(cashIn._id);
    }

    const sameCurrency = h.currency === cashIn.currency;
    const sameAmount = Number(h.amount) === Number(cashIn.amount);
    const sameDate = new Date(h.date).toISOString() === cashDate;
    const sameDirection = h.direction === fallbackDirection;

    return !(sameCurrency && sameAmount && sameDate && sameDirection);
  });
}

function pushPaymentHistory(entity, cashIn, note) {
  entity.payment_history = Array.isArray(entity.payment_history)
    ? entity.payment_history
    : [];
  entity.payment_history.push({
    currency: cashIn.currency,
    amount: Number(cashIn.amount || 0),
    direction: "PAYMENT",
    note,
    ref_id: cashIn._id,
    date: cashIn.paymentDate || new Date(),
  });
}

exports.createCashIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      target_type,
      customer_id,
      supplier_id,
      amount,
      currency = "UZS",
      payment_method = "CASH",
      note,
      paymentDate,
    } = req.body;

    if (!["CUSTOMER", "SUPPLIER"].includes(target_type)) {
      throw new Error("target_type noto‘g‘ri");
    }

    if (!["UZS", "USD"].includes(currency)) {
      throw new Error("currency noto‘g‘ri");
    }

    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      throw new Error("amount noto‘g‘ri");
    }

    const payDate = paymentDate ? new Date(paymentDate) : new Date();

    /* =========================
       CUSTOMER
    ========================= */
    if (target_type === "CUSTOMER") {
      const customer = await Customer.findById(customer_id).session(session);
      if (!customer) throw new Error("Customer topilmadi");

      let remaining = payAmount;

      const sales = await Sale.find({
        customerId: customer._id,
        [`currencyTotals.${currency}.debtAmount`]: { $gt: 0 },
      })
        .sort({ saleDate: 1 })
        .session(session);

      for (const sale of sales) {
        if (remaining <= 0) break;

        const debt = sale.currencyTotals[currency].debtAmount;
        const used = Math.min(debt, remaining);

        sale.currencyTotals[currency].paidAmount += used;
        sale.currencyTotals[currency].debtAmount -= used;

        remaining -= used;
        await sale.save({ session });
      }

      customer.balance[currency] =
        Number(customer.balance[currency] || 0) - payAmount;

      const cashDocs = await CashIn.create(
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

      pushPaymentHistory(customer, cashDocs[0], note || "Mijoz to‘lovi");

      await customer.save({ session });
      await session.commitTransaction();

      return res.json({ ok: true, message: "Customer cash-in OK" });
    }

    /* =========================
       SUPPLIER
    ========================= */
    if (target_type === "SUPPLIER") {
      const supplier = await Supplier.findById(supplier_id).session(session);
      if (!supplier) throw new Error("Supplier topilmadi");

      supplier.balance[currency] =
        Number(supplier.balance[currency] || 0) - payAmount;

      const cashDocs = await CashIn.create(
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

      supplier.payment_history.push({
        currency,
        amount: payAmount,
        direction: "PAYMENT",
        note: note || "Supplierga to‘lov",
        ref_id: cashDocs[0]._id,
        date: payDate,
      });

      await supplier.save({ session });
      await session.commitTransaction();

      return res.json({ ok: true, message: "Supplier cash-in OK" });
    }
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ ok: false, message: err.message });
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
       agar from/to YO'Q bo'lsa → 2025-yil Dekabr 1-dan
    ========================= */
    const defaultStartDate = new Date("2025-12-01T00:00:00.000Z");

    const fromDate = from
      ? new Date(new Date(from).setHours(0, 0, 0, 0))
      : defaultStartDate;

    const toDate = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : null;

    /* =========================
       🔥 ASOSIY MATCH
       doim paymentDate ustun
    ========================= */
    const match = {
      $expr: {
        $and: [
          // 2025-Dekabr 1-dan katta yoki teng bo'lishi SHART
          {
            $gte: [{ $ifNull: ["$paymentDate", "$createdAt"] }, fromDate],
          },
          ...(toDate
            ? [{ $lte: [{ $ifNull: ["$paymentDate", "$createdAt"] }, toDate] }]
            : []),
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
          target_phone: {
            $cond: [
              { $eq: ["$target_type", "CUSTOMER"] },
              { $arrayElemAt: ["$customer.phone", 0] },
              { $arrayElemAt: ["$supplier.phone", 0] },
            ],
          },
          target_address: {
            $ifNull: [
              {
                $cond: [
                  { $eq: ["$target_type", "CUSTOMER"] },
                  { $arrayElemAt: ["$customer.address", 0] },
                  { $arrayElemAt: ["$supplier.address", 0] },
                ],
              },
              "",
            ],
          },
          // frontend backward-compatible field
          address: {
            $ifNull: [
              {
                $cond: [
                  { $eq: ["$target_type", "CUSTOMER"] },
                  { $arrayElemAt: ["$customer.address", 0] },
                  { $arrayElemAt: ["$supplier.address", 0] },
                ],
              },
              "",
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
    ]);

    /* =========================
       SUMMARY
    ========================= */
    const summary = {
      CUSTOMER: { UZS: 0, USD: 0 },
      SUPPLIER: { UZS: 0, USD: 0 },
    };

    for (const it of list) {
      summary[it.target_type][it.currency] += Number(it.amount) || 0;
    }

    return res.json({
      ok: true,
      range: {
        from: from || "2025-12-01",
        to: to || "ALL",
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
    const {
      amount,
      currency,
      payment_method,
      note,
      paymentDate,
      target_type,
      customer_id,
      supplier_id,
    } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      throw new Error("CashIn ID noto‘g‘ri");
    }

    const cashIn = await CashIn.findById(id).session(session);
    if (!cashIn) throw new Error("Cash-in topilmadi");

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

    const newPayDate = paymentDate ? new Date(paymentDate) : cashIn.paymentDate;
    const oldAmount = Number(cashIn.amount || 0);
    const oldCurrency = cashIn.currency;
    const newTargetType = target_type
      ? String(target_type).toUpperCase()
      : cashIn.target_type;

    if (!["CUSTOMER", "SUPPLIER"].includes(newTargetType)) {
      throw new Error("target_type noto‘g‘ri");
    }

    const newCustomerId =
      newTargetType === "CUSTOMER" ? customer_id || cashIn.customer_id : null;
    const newSupplierId =
      newTargetType === "SUPPLIER" ? supplier_id || cashIn.supplier_id : null;

    if (
      newTargetType === "CUSTOMER" &&
      !mongoose.isValidObjectId(newCustomerId)
    ) {
      throw new Error("customer_id noto‘g‘ri");
    }

    if (
      newTargetType === "SUPPLIER" &&
      !mongoose.isValidObjectId(newSupplierId)
    ) {
      throw new Error("supplier_id noto‘g‘ri");
    }

    // 1) ESKI TARGET ROLLBACK
    if (cashIn.target_type === "CUSTOMER") {
      const oldCustomer = await Customer.findById(cashIn.customer_id).session(
        session,
      );
      if (!oldCustomer) throw new Error("Customer topilmadi");

      /* =========================
         1️⃣ OLD ROLLBACK (balance + sale paid rollback)
      ========================= */
      oldCustomer.balance[oldCurrency] =
        Number(oldCustomer.balance?.[oldCurrency] || 0) + oldAmount;

      let rollbackRemain = oldAmount;
      const oldSales = await Sale.find({
        customerId: oldCustomer._id,
        [`currencyTotals.${oldCurrency}.paidAmount`]: { $gt: 0 },
      })
        .sort({ saleDate: -1 }) // LIFO rollback
        .session(session);

      for (const sale of oldSales) {
        if (rollbackRemain <= 0) break;
        const paid = Number(sale.currencyTotals[oldCurrency].paidAmount || 0);
        if (paid <= 0) continue;

        const move = Math.min(paid, rollbackRemain);
        sale.currencyTotals[oldCurrency].paidAmount -= move;
        sale.currencyTotals[oldCurrency].debtAmount += move;
        rollbackRemain -= move;
        await sale.save({ session });
      }

      removeHistoryEntry(oldCustomer, cashIn, "PAYMENT");

      /* =========================
         2️⃣ NEW APPLY (balance + sale debt close)
      ========================= */
      await oldCustomer.save({ session });
    } else if (cashIn.target_type === "SUPPLIER") {
      const oldSupplier = await Supplier.findById(cashIn.supplier_id).session(
        session,
      );
      if (!oldSupplier) throw new Error("Supplier topilmadi");

      oldSupplier.balance[oldCurrency] =
        Number(oldSupplier.balance?.[oldCurrency] || 0) + oldAmount;
      removeHistoryEntry(oldSupplier, cashIn, "PAYMENT");
      await oldSupplier.save({ session });
    }

    // 2) YANGI TARGET APPLY
    if (newTargetType === "CUSTOMER") {
      const customer = await Customer.findById(newCustomerId).session(session);
      if (!customer) throw new Error("Yangi customer topilmadi");

      customer.balance[currency] =
        Number(customer.balance?.[currency] || 0) - newAmount;

      let applyRemain = newAmount;
      const newSales = await Sale.find({
        customerId: customer._id,
        [`currencyTotals.${currency}.debtAmount`]: { $gt: 0 },
      })
        .sort({ saleDate: 1 })
        .session(session);

      for (const sale of newSales) {
        if (applyRemain <= 0) break;
        const debt = Number(sale.currencyTotals[currency].debtAmount || 0);
        if (debt <= 0) continue;

        const move = Math.min(debt, applyRemain);
        sale.currencyTotals[currency].paidAmount += move;
        sale.currencyTotals[currency].debtAmount -= move;
        applyRemain -= move;
        await sale.save({ session });
      }

      cashIn.amount = newAmount;
      cashIn.currency = currency;
      cashIn.payment_method = payment_method;
      cashIn.note = note || cashIn.note;
      cashIn.paymentDate = newPayDate || cashIn.paymentDate;
      cashIn.target_type = newTargetType;
      cashIn.customer_id = newTargetType === "CUSTOMER" ? newCustomerId : null;
      cashIn.supplier_id = newTargetType === "SUPPLIER" ? newSupplierId : null;

      pushPaymentHistory(customer, cashIn, note || "Cash-in tahrirlandi");

      await customer.save({ session });
    } else {
      const supplier = await Supplier.findById(newSupplierId).session(session);
      if (!supplier) throw new Error("Yangi supplier topilmadi");

      supplier.balance[currency] =
        Number(supplier.balance?.[currency] || 0) - newAmount;

      cashIn.amount = newAmount;
      cashIn.currency = currency;
      cashIn.payment_method = payment_method;
      cashIn.note = note || cashIn.note;
      cashIn.paymentDate = newPayDate || cashIn.paymentDate;
      cashIn.target_type = newTargetType;
      cashIn.customer_id = newTargetType === "CUSTOMER" ? newCustomerId : null;
      cashIn.supplier_id = newTargetType === "SUPPLIER" ? newSupplierId : null;

      removeHistoryEntry(supplier, cashIn, "PAYMENT");
      supplier.payment_history = Array.isArray(supplier.payment_history)
        ? supplier.payment_history
        : [];
      supplier.payment_history.push({
        currency: cashIn.currency,
        amount: Number(cashIn.amount || 0),
        direction: "PAYMENT",
        note: note || "Supplier cash-in tahrirlandi",
        ref_id: cashIn._id,
        date: cashIn.paymentDate || new Date(),
      });

      await supplier.save({ session });
    }

    await cashIn.save({ session });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Cash-in muvaffaqiyatli tahrirlandi",
      target_type: cashIn.target_type,
      customer_id: cashIn.customer_id || null,
      supplier_id: cashIn.supplier_id || null,
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


exports.deleteCashIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new Error("CashIn ID noto‘g‘ri");
    }

    const cashIn = await CashIn.findById(id).session(session);
    if (!cashIn) throw new Error("Cash-in topilmadi");

    const { target_type, currency, amount } = cashIn;
    const cashDate = new Date(
      cashIn.paymentDate || cashIn.createdAt
    ).toISOString();

    
    if (target_type === "SUPPLIER") {
      const supplier = await Supplier.findById(cashIn.supplier_id).session(
        session
      );
      if (!supplier) throw new Error("Supplier topilmadi");

      // 1️⃣ BALANCE QAYTARISH
      supplier.balance[currency] =
        Number(supplier.balance?.[currency] || 0) + Number(amount);

      // 2️⃣ PAYMENT HISTORY DAN O‘CHIRISH (eng ishonchli)
      supplier.payment_history = (supplier.payment_history || []).filter(
        (h) => {
          // ref_id bo‘lsa: direction nima bo‘lishidan qat’i nazar o‘chiramiz
          if (h.ref_id) return String(h.ref_id) !== String(cashIn._id);

          // fallback: eski recordlar uchun (date/currency/amount)
          const sameCurrency = h.currency === currency;
          const sameAmount = Number(h.amount) === Number(amount);
          const sameDate = new Date(h.date).toISOString() === cashDate;

          // PAYMENT yoki ROLLBACK bo‘lsa ham olib tashlaymiz (cashIn bilan bog‘liq bo‘lsa)
          const isRelated =
            h.direction === "PAYMENT" || h.direction === "ROLLBACK";

          if (sameCurrency && sameAmount && sameDate && isRelated) return false;

          return true;
        }
      );

      await supplier.save({ session });
    }

    /* =========================
       🔵 CUSTOMER (TO‘LIQ ROLLBACK)
    ========================= */
    if (target_type === "CUSTOMER") {
      const customer = await Customer.findById(cashIn.customer_id).session(
        session
      );
      if (!customer) throw new Error("Customer topilmadi");

      // 1️⃣ BALANCE QAYTARISH
      customer.balance[currency] =
        Number(customer.balance[currency] || 0) + Number(amount);

      // 2️⃣ SALE LARDAN QARZNI QAYTA OCHISH (LIFO)
      let remaining = Number(amount);

      const sales = await Sale.find({
        customerId: customer._id,
        [`currencyTotals.${currency}.paidAmount`]: { $gt: 0 },
      })
        .sort({ saleDate: -1 }) // 🔥 LIFO
        .session(session);

      for (const sale of sales) {
        if (remaining <= 0) break;

        const paid = Number(sale.currencyTotals[currency].paidAmount || 0);
        if (paid <= 0) continue;

        const rollback = Math.min(paid, remaining);

        sale.currencyTotals[currency].paidAmount -= rollback;
        sale.currencyTotals[currency].debtAmount += rollback;

        remaining -= rollback;
        await sale.save({ session });
      }

      // 3️⃣ PAYMENT HISTORY DAN O‘CHIRISH (ref_id + fallback)
      customer.payment_history = customer.payment_history.filter((h) => {
        if (h.ref_id) {
          return String(h.ref_id) !== String(cashIn._id);
        }

        const sameCurrency = h.currency === currency;
        const sameAmount = Number(h.amount) === Number(amount);
        const sameDate = new Date(h.date).toISOString() === cashDate;
        const isPayment = h.direction === "PAYMENT";

        if (sameCurrency && sameAmount && sameDate && isPayment) {
          return false;
        }

        return true;
      });

      await customer.save({ session });
    }

    /* =========================
       🗑 CASH-IN O‘CHIRISH
    ========================= */
    await CashIn.deleteOne({ _id: cashIn._id }).session(session);

    await session.commitTransaction();

    return res.json({
      ok: true,
      message:
        "Cash-in o‘chirildi: balance, sale va payment_history to‘liq qaytarildi",
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

