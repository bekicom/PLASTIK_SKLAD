const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Customer = require("../modules/Customer/Customer");
const Sale = require("../modules/sales/Sale");
const Order = require("../modules/orders/Order");
const SaleReturn = require("../modules/returns/SaleReturn");
const Product = require("../modules/products/Product");

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
    const { name, phone, address, note, balance = {}, login, password } =
      req.body || {};

    if (!name) {
      return res.status(400).json({
        ok: false,
        message: "name majburiy",
      });
    }

    const balUZS = Number(balance.UZS || 0);
    const balUSD = Number(balance.USD || 0);
    const cleanLogin = login ? String(login).trim().toLowerCase() : "";

    if ((cleanLogin && !password) || (!cleanLogin && password)) {
      return res.status(400).json({
        ok: false,
        message: "login va password birga yuborilishi kerak",
      });
    }

    if (cleanLogin) {
      const existsLogin = await Customer.findOne({ login: cleanLogin }).lean();
      if (existsLogin) {
        return res.status(409).json({
          ok: false,
          message: "Bu login band",
        });
      }
    }

    const customer = await Customer.create({
      name: String(name).trim(),
      phone: normalizePhone(phone),
      login: cleanLogin || undefined,
      password: cleanLogin ? await bcrypt.hash(String(password), 10) : undefined,
      address: address?.trim() || "",
      note: note?.trim() || "",
      registered_from: "ADMIN",
      role: cleanLogin ? "MOBILE" : "WEB",
      status: "ACTIVE",

      // 🔥 ASOSIY YECHIM
      opening_balance: {
        UZS: balUZS,
        USD: balUSD,
      },

      // 🔁 ISHCHI BALANS (hozircha opening bilan teng)
      balance: {
        UZS: balUZS,
        USD: balUSD,
      },

      payment_history: [], // ❌ bu yerga yozilmaydi
      isActive: true,
    });

    const customerSafe = customer.toObject();
    delete customerSafe.password;

    return res.status(201).json({
      ok: true,
      message: "Customer yaratildi",
      customer: customerSafe,
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

    /* =====================
       BASIC FILTERS
    ===================== */
    if (req.query.isActive === "true") match.isActive = true;
    if (req.query.isActive === "false") match.isActive = false;

    if (
      req.query.status &&
      ["PENDING", "ACTIVE", "BLOCKED", "REJECTED"].includes(req.query.status)
    ) {
      match.status = req.query.status;
    }

    if (req.query.search) {
      const r = new RegExp(req.query.search.trim(), "i");
      match.$or = [{ name: r }, { phone: r }];
    }

    let items = await Customer.aggregate([
      { $match: match },

      /* =====================
         REAL DEBT (BALANCE > 0)
      ===================== */
      {
        $addFields: {
          debt: {
            UZS: { $max: ["$balance.UZS", 0] },
            USD: { $max: ["$balance.USD", 0] },
          },
        },
      },

      /* =====================
         DEBT STATUS
      ===================== */
      {
        $addFields: {
          debt_status: {
            $cond: [
              {
                $or: [
                  { $gt: ["$balance.UZS", 0] },
                  { $gt: ["$balance.USD", 0] },
                ],
              },
              "DEBT",
              "CLEAR",
            ],
          },
        },
      },

      /* =====================
         DEBT STATUS FILTER
      ===================== */
      ...(req.query.debt_status === "DEBT"
        ? [
            {
              $match: {
                $or: [
                  { "balance.UZS": { $gt: 0 } },
                  { "balance.USD": { $gt: 0 } },
                ],
              },
            },
          ]
        : []),

      ...(req.query.debt_status === "CLEAR"
        ? [
            {
              $match: {
                "balance.UZS": { $lte: 0 },
                "balance.USD": { $lte: 0 },
              },
            },
          ]
        : []),

      {
        $project: {
          __v: 0,
        },
      },

      { $sort: { createdAt: -1 } },
    ]);

    const customerIds = items.map((c) => c._id).filter(Boolean);

    let returnsSummaryByCustomer = new Map();
    let recentReturnsByCustomer = new Map();

    if (customerIds.length) {
      const returnsSummary = await SaleReturn.aggregate([
        {
          $match: {
            customer_id: { $in: customerIds },
          },
        },
        {
          $lookup: {
            from: "warehouses",
            localField: "warehouse_id",
            foreignField: "_id",
            as: "warehouse",
          },
        },
        {
          $addFields: {
            currency: {
              $ifNull: [{ $arrayElemAt: ["$warehouse.currency", 0] }, "UZS"],
            },
          },
        },
        {
          $group: {
            _id: {
              customer_id: "$customer_id",
              currency: "$currency",
            },
            total_amount: { $sum: { $ifNull: ["$returnSubtotal", 0] } },
            count: { $sum: 1 },
          },
        },
      ]);

      for (const r of returnsSummary) {
        const cid = String(r._id.customer_id);
        const cur = r._id.currency;
        if (!returnsSummaryByCustomer.has(cid)) {
          returnsSummaryByCustomer.set(cid, {
            UZS: 0,
            USD: 0,
            count: 0,
          });
        }

        const row = returnsSummaryByCustomer.get(cid);
        if (cur === "UZS" || cur === "USD") {
          row[cur] += Number(r.total_amount || 0);
        }
        row.count += Number(r.count || 0);
      }

      const recentReturns = await SaleReturn.find({
        customer_id: { $in: customerIds },
      })
        .sort({ createdAt: -1 })
        .limit(300)
        .populate("warehouse_id", "name currency")
        .select("customer_id sale_id returnSubtotal items note createdAt warehouse_id")
        .lean();

      const recentReturnProductIds = [];
      const recentReturnSaleIds = [];
      for (const rr of recentReturns) {
        if (rr.sale_id) recentReturnSaleIds.push(String(rr.sale_id));
        for (const it of rr.items || []) {
          if (it?.product_id) recentReturnProductIds.push(String(it.product_id));
        }
      }

      const uniqueProductIds = [...new Set(recentReturnProductIds)];
      const uniqueSaleIds = [...new Set(recentReturnSaleIds)];

      const [products, sales] = await Promise.all([
        uniqueProductIds.length
          ? Product.find({ _id: { $in: uniqueProductIds } })
              .select("_id name unit")
              .lean()
          : [],
        uniqueSaleIds.length
          ? Sale.find({ _id: { $in: uniqueSaleIds } })
              .select("_id items")
              .lean()
          : [],
      ]);

      const productMap = new Map(products.map((p) => [String(p._id), p]));
      const saleItemSnapshotMap = new Map();
      for (const s of sales) {
        for (const it of s.items || []) {
          saleItemSnapshotMap.set(
            `${String(s._id)}|${String(it.productId)}`,
            it.productSnapshot || {},
          );
        }
      }

      for (const rr of recentReturns) {
        const cid = String(rr.customer_id || "");
        if (!cid) continue;

        if (!recentReturnsByCustomer.has(cid)) {
          recentReturnsByCustomer.set(cid, []);
        }

        const arr = recentReturnsByCustomer.get(cid);
        if (arr.length >= 5) continue; // har customer uchun oxirgi 5 ta qaytarish

        arr.push({
          _id: rr._id,
          sale_id: rr.sale_id || null,
          date: rr.createdAt,
          warehouse: rr.warehouse_id
            ? {
                _id: rr.warehouse_id._id,
                name: rr.warehouse_id.name,
                currency: rr.warehouse_id.currency,
              }
            : null,
          returnSubtotal: Number(rr.returnSubtotal || 0),
          note: rr.note || "",
          items: (rr.items || []).map((it) => ({
            product_id: it.product_id,
            name:
              (
                ((saleItemSnapshotMap.get(
                  `${String(rr.sale_id || "")}|${String(it.product_id || "")}`,
                ) || {}).name) ||
                (productMap.get(String(it.product_id || "")) || {}).name ||
                ""
              ),
            unit:
              (
                ((saleItemSnapshotMap.get(
                  `${String(rr.sale_id || "")}|${String(it.product_id || "")}`,
                ) || {}).unit) ||
                (productMap.get(String(it.product_id || "")) || {}).unit ||
                ""
              ),
            qty: Number(it.qty || 0),
            price: Number(it.price || 0),
            subtotal: Number(it.subtotal || 0),
            reason: it.reason || "",
          })),
        });
      }
    }

    /* =====================
       RESPONSE CLEANUP
       🔥 FAQAT PAYMENT KO‘RINADI
    ===================== */
    items = items.map((c) => ({
      ...c,

      /* === opening balance (DB dagi real qiymat) === */
      opening_balance: {
        UZS: Number(c.opening_balance?.UZS || 0),
        USD: Number(c.opening_balance?.USD || 0),
      },

      /* === PAYMENT HISTORY (PAYMENT + RETURN/ROLLBACK ham ko‘rinsin) === */
      payment_history: Array.isArray(c.payment_history)
        ? c.payment_history.filter((h) =>
            [
              "PAYMENT",
              "ROLLBACK",
              "PAYMENT_CANCEL",
              "PREPAID",
              "PREPAYMENT",
              "DEBT",
            ].includes(h.direction),
          )
        : [],

      payment_summary: (() => {
        const summary = {
          paid: { UZS: 0, USD: 0 },
          rollback: { UZS: 0, USD: 0 },
          net_paid: { UZS: 0, USD: 0 },
        };

        const hist = Array.isArray(c.payment_history) ? c.payment_history : [];
        for (const h of hist) {
          const cur = h.currency;
          const amt = Number(h.amount || 0);
          if (!["UZS", "USD"].includes(cur) || amt <= 0) continue;

          if (h.direction === "PAYMENT" || h.direction === "PREPAID" || h.direction === "PREPAYMENT") {
            summary.paid[cur] += amt;
            summary.net_paid[cur] += amt;
          } else if (h.direction === "ROLLBACK" || h.direction === "PAYMENT_CANCEL") {
            summary.rollback[cur] += amt;
            summary.net_paid[cur] -= amt;
          }
        }

        return summary;
      })(),

      returns: returnsSummaryByCustomer.get(String(c._id)) || {
        UZS: 0,
        USD: 0,
        count: 0,
      },

      returns_history: recentReturnsByCustomer.get(String(c._id)) || [],
    }));

    /* =====================
       TOTALS
    ===================== */
    const totals = {
      debt: { UZS: 0, USD: 0 },
      returns: { UZS: 0, USD: 0, count: 0 },
    };

    for (const c of items) {
      totals.debt.UZS += Number(c.debt?.UZS || 0);
      totals.debt.USD += Number(c.debt?.USD || 0);
      totals.returns.UZS += Number(c.returns?.UZS || 0);
      totals.returns.USD += Number(c.returns?.USD || 0);
      totals.returns.count += Number(c.returns?.count || 0);
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

    if (req.body.login !== undefined) {
      const cleanLogin = String(req.body.login || "")
        .trim()
        .toLowerCase();
      if (!cleanLogin) {
        patch.login = undefined;
      } else {
        const existsLogin = await Customer.findOne({
          login: cleanLogin,
          _id: { $ne: id },
        }).lean();

        if (existsLogin) {
          return res.status(409).json({
            ok: false,
            message: "Bu login band",
          });
        }

        patch.login = cleanLogin;
      }
    }

    if (req.body.password !== undefined) {
      const rawPassword = String(req.body.password || "");
      if (rawPassword.length < 4) {
        return res.status(400).json({
          ok: false,
          message: "password kamida 4 ta belgi bo‘lsin",
        });
      }
      patch.password = await bcrypt.hash(rawPassword, 10);
    }

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

    // 🔥 BALANCE
    customer.balance[currency] -= delta;
    // delta > 0 → qarz kamayadi
    // delta < 0 → avans oshadi

    // 🔥 FAQAT PAYMENT
    customer.payment_history.push({
      currency,
      amount: Math.abs(delta),
      direction: "PAYMENT",
      note: note || "Mijoz to‘lovi",
      date: new Date(),
    });

    await customer.save();

    return res.json({
      ok: true,
      message: "To‘lov qabul qilindi",
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

exports.updateCustomerOpeningBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { opening_balance = {}, note, set_as_baseline = false } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "ID noto‘g‘ri",
      });
    }

    const hasUZS = Object.prototype.hasOwnProperty.call(opening_balance, "UZS");
    const hasUSD = Object.prototype.hasOwnProperty.call(opening_balance, "USD");

    if (!hasUZS && !hasUSD) {
      return res.status(400).json({
        ok: false,
        message: "opening_balance.UZS yoki opening_balance.USD yuboring",
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Customer topilmadi",
      });
    }

    if (!customer.opening_balance) customer.opening_balance = { UZS: 0, USD: 0 };

    const changes = [];
    for (const cur of ["UZS", "USD"]) {
      if (!Object.prototype.hasOwnProperty.call(opening_balance, cur)) continue;

      const nextOpening = Number(opening_balance[cur]);
      if (!Number.isFinite(nextOpening)) {
        return res.status(400).json({
          ok: false,
          message: `${cur} opening balance noto‘g‘ri`,
        });
      }

      const prevOpening = Number(customer.opening_balance?.[cur] || 0);
      const currentBalance = Number(customer.balance?.[cur] || 0);
      const operationalBalance = currentBalance - prevOpening; // opening'dan tashqari qism

      let nextBalance = currentBalance;
      let delta = 0;
      if (!set_as_baseline) {
        nextBalance = operationalBalance + nextOpening;
        delta = nextBalance - currentBalance;
      }

      customer.opening_balance[cur] = nextOpening;
      customer.balance[cur] = nextBalance;

      if (delta !== 0) {
        customer.payment_history.push({
          currency: cur,
          amount: Math.abs(delta),
          direction: delta > 0 ? "DEBT" : "PAYMENT",
          note:
            note ||
            `Boshlang'ich balans tahrirlandi (${prevOpening} → ${nextOpening})`,
          date: new Date(),
        });
      }

      changes.push({
        currency: cur,
        previous_opening_balance: prevOpening,
        current_opening_balance: nextOpening,
        set_as_baseline: !!set_as_baseline,
        operational_balance: operationalBalance,
        delta,
        current_balance: nextBalance,
      });
    }

    await customer.save();

    return res.json({
      ok: true,
      message: "Customer boshlang‘ich balansi yangilandi",
      customer: {
        id: customer._id,
        name: customer.name,
        opening_balance: customer.opening_balance,
        balance: customer.balance,
      },
      changes,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Customer boshlang‘ich balansini tahrirlashda xato",
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
        .select(
          "invoiceNo createdAt saleDate items totals currencyTotals payments note history",
        )
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
        saleDate: s.saleDate || s.createdAt,
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
        history: Array.isArray(s.history) ? s.history : [],
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
      .select("invoiceNo saleDate createdAt items totals currencyTotals note history")
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
        history: Array.isArray(s.history) ? s.history : [],
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
            : uzsDebt > 0 && (s.currencyTotals.UZS.paidAmount || 0) > 0
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
      return res
        .status(400)
        .json({ ok: false, message: "customer id noto‘g‘ri" });
    }

    const customerId = new mongoose.Types.ObjectId(id);

    /* =====================
       DATE FILTER
    ===================== */
    const dateFilter = {};
    if (req.query.from) dateFilter.$gte = new Date(req.query.from);
    if (req.query.to) dateFilter.$lte = new Date(req.query.to);

    /* =====================
       1️⃣ SALES → QARZ MANBAI
    ===================== */
    const sales = await Sale.find({
      customerId,
      status: { $ne: "DELETED" },
    })
      .select("invoiceNo saleDate currencyTotals history items status")
      .lean();

    const saleEvents = [];

    for (const s of sales) {
      const history = Array.isArray(s.history) && s.history.length ? s.history : null;

      if (history) {
        for (const h of history) {
          if (h.type === "SALE_CREATED") {
            saleEvents.push({
              type: "SALE",
              date: h.date || s.saleDate,
              ref: s.invoiceNo,
              note: h.note || "Sotuv (qarz)",
              UZS: Number(h.amountDelta?.UZS || 0),
              USD: Number(h.amountDelta?.USD || 0),
              kind: "DEBT",
            });
          }

          if (h.type === "SALE_EDITED") {
            saleEvents.push({
              type: "SALE_EDIT",
              date: h.date || s.saleDate,
              ref: s.invoiceNo,
              note: h.note || "Sotuv tahrirlandi",
              UZS: Number(h.amountDelta?.UZS || 0),
              USD: Number(h.amountDelta?.USD || 0),
              kind: "ADJUST",
            });
          }

          if (h.type === "RETURN_CREATED") {
            saleEvents.push({
              type: "RETURN",
              date: h.date || s.saleDate,
              ref: s.invoiceNo,
              note: h.note || "Vozvrat",
              UZS: Number(h.amountDelta?.UZS || 0),
              USD: Number(h.amountDelta?.USD || 0),
              kind: "RETURN",
            });
          }
        }
      } else {
        saleEvents.push({
          type: "SALE",
          date: s.saleDate,
          ref: s.invoiceNo,
          note: "Sotuv (qarz)",
          UZS: Number(s.currencyTotals?.UZS?.grandTotal || 0),
          USD: Number(s.currencyTotals?.USD?.grandTotal || 0),
          kind: "DEBT",
        });
      }
    }

    /* =====================
       2️⃣ PAYMENTS → FAQAT PAYMENT
    ===================== */
    const customer = await Customer.findById(id)
      .select("payment_history")
      .lean();

    const paymentEvents = (customer.payment_history || [])
      .filter((p) =>
        ["PAYMENT", "DEBT", "ROLLBACK", "PREPAID", "PAYMENT_CANCEL"].includes(
          p.direction,
        ),
      )
      .map((p) => ({
        type: p.direction,
        date: p.date,
        ref: p.note || "",
        note:
          p.direction === "DEBT"
            ? "Qarz yozildi"
            : p.direction === "PAYMENT"
              ? "To‘lov"
              : p.direction === "PAYMENT_CANCEL"
                ? "To‘lov bekor qilindi"
                : "Qaytarish / rollback",
        UZS:
          p.currency === "UZS"
            ? Number(p.amount || 0)
            : 0,
        USD:
          p.currency === "USD"
            ? Number(p.amount || 0)
            : 0,
        kind:
          p.direction === "DEBT"
            ? "DEBT"
            : ["PAYMENT", "ROLLBACK", "PAYMENT_CANCEL", "PREPAID"].includes(
                p.direction,
              )
              ? "PAYMENT"
              : "PAYMENT",
      }));

    /* =====================
       3️⃣ MERGE + SORT
    ===================== */
    let timelineRaw = [...saleEvents, ...paymentEvents].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    if (Object.keys(dateFilter).length) {
      timelineRaw = timelineRaw.filter((e) => {
        const t = new Date(e.date).getTime();
        if (dateFilter.$gte && t < new Date(dateFilter.$gte).getTime()) {
          return false;
        }
        if (dateFilter.$lte && t > new Date(dateFilter.$lte).getTime()) {
          return false;
        }
        return true;
      });
    }

    /* =====================
       4️⃣ RUNNING DEBT
    ===================== */
    let debtUZS = 0;
    let debtUSD = 0;

    const timeline = timelineRaw.map((e) => {
      if (e.kind === "DEBT") {
        debtUZS += e.UZS;
        debtUSD += e.USD;
      } else if (e.kind === "PAYMENT") {
        debtUZS -= e.UZS;
        debtUSD -= e.USD;
      } else if (e.kind === "ADJUST") {
        debtUZS += e.UZS;
        debtUSD += e.USD;
      } else if (e.kind === "RETURN") {
        debtUZS += e.UZS;
        debtUSD += e.USD;
      }

      return {
        type: e.type,
        date: e.date,
        ref: e.ref,
        note: e.note,
        change: {
          UZS:
            e.kind === "DEBT" || e.kind === "ADJUST" || e.kind === "RETURN"
              ? e.UZS
              : -e.UZS,
          USD:
            e.kind === "DEBT" || e.kind === "ADJUST" || e.kind === "RETURN"
              ? e.USD
              : -e.USD,
        },
        debtAfter: {
          UZS: debtUZS,
          USD: debtUSD,
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

