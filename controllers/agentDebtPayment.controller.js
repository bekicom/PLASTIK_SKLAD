const mongoose = require("mongoose");
const AgentDebtPayment = require("../modules/agentDebtPayments/AgentDebtPayment");
const Customer = require("../modules/Customer/Customer");
const Sale = require("../modules/sales/Sale");
const CashIn = require("../modules/cashIn/CashIn");

function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function currentUserId(req) {
  return req.user?._id || req.user?.id || null;
}

async function applyCustomerDebtPayment({
  session,
  customer,
  amount,
  currency,
  paymentDate,
  note,
  refId = null,
}) {
  let remaining = amount;

  const debtField = `currencyTotals.${currency}.debtAmount`;
  const paidField = `currencyTotals.${currency}.paidAmount`;

  const sales = await Sale.find({
    customerId: customer._id,
    status: "COMPLETED",
    [debtField]: { $gt: 0 },
  })
    .sort({ saleDate: 1, createdAt: 1 })
    .session(session);

  for (const sale of sales) {
    if (remaining <= 0) break;

    const debt = Number(sale.currencyTotals?.[currency]?.debtAmount || 0);
    if (debt <= 0) continue;

    const used = Math.min(debt, remaining);
    sale.currencyTotals[currency].paidAmount =
      Number(sale.currencyTotals[currency].paidAmount || 0) + used;
    sale.currencyTotals[currency].debtAmount = debt - used;
    remaining -= used;
    await sale.save({ session });
  }

  customer.balance[currency] = Number(customer.balance?.[currency] || 0) - amount;
  customer.payment_history.push({
    currency,
    amount,
    direction: "PAYMENT",
    note,
    ref_id: refId || undefined,
    date: paymentDate,
  });
  await customer.save({ session });
}

// AGENT creates pending request
exports.createAgentDebtPaymentRequest = async (req, res) => {
  try {
    const {
      customer_id,
      amount,
      currency = "UZS",
      payment_method = "CASH",
      paymentDate,
      note = "",
    } = req.body || {};

    const agentId = currentUserId(req);
    if (!agentId || !mongoose.isValidObjectId(agentId)) {
      return res.status(401).json({
        ok: false,
        message: "Agent auth topilmadi",
      });
    }

    if (!mongoose.isValidObjectId(customer_id)) {
      return res.status(400).json({
        ok: false,
        message: "customer_id noto‘g‘ri",
      });
    }

    if (!["UZS", "USD"].includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto‘g‘ri (UZS/USD)",
      });
    }

    if (!["CASH", "CARD"].includes(payment_method)) {
      return res.status(400).json({
        ok: false,
        message: "payment_method noto‘g‘ri (CASH/CARD)",
      });
    }

    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount 0 dan katta bo‘lsin",
      });
    }

    const customer = await Customer.findById(customer_id).select("_id name balance");
    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Customer topilmadi",
      });
    }

    const payDate = paymentDate ? new Date(paymentDate) : new Date();
    if (Number.isNaN(payDate.getTime())) {
      return res.status(400).json({
        ok: false,
        message: "paymentDate noto‘g‘ri",
      });
    }

    const row = await AgentDebtPayment.create({
      agent_id: agentId,
      customer_id,
      amount: payAmount,
      currency,
      payment_method,
      paymentDate: payDate,
      note: String(note || "").trim(),
      status: "PENDING",
    });

    return res.status(201).json({
      ok: true,
      message: "Agent to‘lov so‘rovi yuborildi (PENDING)",
      item: row,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Agent so‘rov yaratishda xato",
      error: error.message,
    });
  }
};

// ADMIN/CASHIER list (pending or all)
exports.getAgentDebtPaymentRequests = async (req, res) => {
  try {
    const {
      status = "PENDING",
      customer_id,
      agent_id,
      from,
      to,
      page = 1,
      limit = 50,
    } = req.query || {};

    const filter = {};
    if (status && status !== "ALL") filter.status = status;
    if (customer_id && mongoose.isValidObjectId(customer_id))
      filter.customer_id = customer_id;
    if (agent_id && mongoose.isValidObjectId(agent_id)) filter.agent_id = agent_id;

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (fromDate && Number.isFinite(fromDate.getTime())) {
      fromDate.setHours(0, 0, 0, 0);
      filter.paymentDate = filter.paymentDate || {};
      filter.paymentDate.$gte = fromDate;
    }
    if (toDate && Number.isFinite(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      filter.paymentDate = filter.paymentDate || {};
      filter.paymentDate.$lte = toDate;
    }

    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (p - 1) * l;

    const [items, total] = await Promise.all([
      AgentDebtPayment.find(filter)
        .populate("agent_id", "name phone login role")
        .populate("customer_id", "name phone balance")
        .populate("approvedBy", "name login role")
        .populate("rejectedBy", "name login role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l)
        .lean(),
      AgentDebtPayment.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      page: p,
      limit: l,
      total,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Agent to‘lov so‘rovlarini olishda xato",
      error: error.message,
    });
  }
};

// AGENT own list
exports.getMyAgentDebtPaymentRequests = async (req, res) => {
  try {
    const agentId = currentUserId(req);
    const { status = "ALL" } = req.query || {};

    const filter = { agent_id: agentId };
    if (status !== "ALL") filter.status = status;

    const items = await AgentDebtPayment.find(filter)
      .populate("customer_id", "name phone balance")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Agentning so‘rovlarini olishda xato",
      error: error.message,
    });
  }
};

// ADMIN approves and only then debt decreases
exports.approveAgentDebtPaymentRequest = async (req, res) => {
  const { id } = req.params;
  const approverId = currentUserId(req);
  const { decisionNote = "" } = req.body || {};

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({
      ok: false,
      message: "request id noto‘g‘ri",
    });
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result = null;

      await session.withTransaction(async () => {
        const row = await AgentDebtPayment.findById(id).session(session);
        if (!row) throw new Error("So‘rov topilmadi");
        if (row.status !== "PENDING") {
          throw new Error("Faqat PENDING so‘rov tasdiqlanadi");
        }

        const customer = await Customer.findById(row.customer_id).session(session);
        if (!customer) throw new Error("Customer topilmadi");

        const paymentDate = row.paymentDate || new Date();
        const payAmount = safeNum(row.amount, 0);
        const currency = row.currency;

        const cashDocs = await CashIn.create(
          [
            {
              target_type: "CUSTOMER",
              customer_id: row.customer_id,
              amount: payAmount,
              currency,
              payment_method: row.payment_method,
              paymentDate,
              note: row.note || "Agent orqali mijoz to‘lovi (tasdiqlandi)",
            },
          ],
          { session },
        );

        await applyCustomerDebtPayment({
          session,
          customer,
          amount: payAmount,
          currency,
          paymentDate,
          note: row.note || "Agent orqali mijoz to‘lovi (tasdiqlandi)",
          refId: cashDocs[0]._id,
        });

        row.status = "APPROVED";
        row.approvedBy = approverId || null;
        row.approvedAt = new Date();
        row.decisionNote = String(decisionNote || "").trim();
        row.cash_in_id = cashDocs[0]._id;
        await row.save({ session });

        result = {
          item: row.toObject(),
          cash_in_id: cashDocs[0]._id,
          customer_balance: customer.balance,
        };
      });

      await session.endSession();
      return res.json({
        ok: true,
        message: "So‘rov tasdiqlandi, mijoz qarzidan yechildi",
        ...result,
      });
    } catch (error) {
      lastError = error;
      await session.endSession();
      const msg = String(error?.message || "");
      if (!msg.includes("Unable to acquire IX lock") || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 120 * attempt));
    }
  }

  return res.status(400).json({
    ok: false,
    message: lastError?.message || "Tasdiqlashda xato",
  });
};

// ADMIN rejects request
exports.rejectAgentDebtPaymentRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const rejectorId = currentUserId(req);
    const { decisionNote = "" } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "request id noto‘g‘ri",
      });
    }

    const row = await AgentDebtPayment.findById(id);
    if (!row) {
      return res.status(404).json({
        ok: false,
        message: "So‘rov topilmadi",
      });
    }

    if (row.status !== "PENDING") {
      return res.status(400).json({
        ok: false,
        message: "Faqat PENDING so‘rov rad qilinadi",
      });
    }

    row.status = "REJECTED";
    row.rejectedBy = rejectorId || null;
    row.rejectedAt = new Date();
    row.decisionNote = String(decisionNote || "").trim();
    await row.save();

    return res.json({
      ok: true,
      message: "So‘rov rad qilindi",
      item: row,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "So‘rovni rad qilishda xato",
      error: error.message,
    });
  }
};
