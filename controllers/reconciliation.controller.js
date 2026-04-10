const mongoose = require("mongoose");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");
const Sale = require("../modules/sales/Sale");
const Purchase = require("../modules/purchases/Purchase");

const CUR = ["UZS", "USD"];

function toObjId(id) {
  return new mongoose.Types.ObjectId(id);
}

function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function startOfDay(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

function toDeltaByCurrency(amount, currency) {
  return {
    UZS: currency === "UZS" ? safeNum(amount) : 0,
    USD: currency === "USD" ? safeNum(amount) : 0,
  };
}

function normalizeEvent(evt) {
  const deltaUZS = safeNum(evt?.delta?.UZS);
  const deltaUSD = safeNum(evt?.delta?.USD);
  return {
    date: evt.date ? new Date(evt.date) : new Date(),
    docType: evt.docType || "EVENT",
    docNo: evt.docNo || "",
    refId: evt.refId || null,
    description: evt.description || "",
    items: Array.isArray(evt.items) ? evt.items : [],
    delta: { UZS: deltaUZS, USD: deltaUSD },
  };
}

function addMoney(target, field, delta) {
  target[field].UZS += safeNum(delta?.UZS);
  target[field].USD += safeNum(delta?.USD);
}

function applyCurrencyFilter(value, currency) {
  if (!["UZS", "USD"].includes(currency)) return value;
  return {
    UZS: currency === "UZS" ? safeNum(value.UZS) : 0,
    USD: currency === "USD" ? safeNum(value.USD) : 0,
  };
}

function statusByBalance(balance) {
  const uzs = safeNum(balance?.UZS);
  const usd = safeNum(balance?.USD);
  return {
    UZS: uzs > 0 ? "DEBT" : uzs < 0 ? "PREPAID" : "CLEAR",
    USD: usd > 0 ? "DEBT" : usd < 0 ? "PREPAID" : "CLEAR",
  };
}

async function buildCustomerEvents(customerId) {
  const events = [];

  const sales = await Sale.find({
    customerId: toObjId(customerId),
    status: { $ne: "DELETED" },
  })
    .select("invoiceNo saleDate createdAt history currencyTotals items")
    .lean();

  for (const s of sales) {
    const saleDocNo = s.invoiceNo || "";
    const saleDate = s.saleDate || s.createdAt || new Date();
    const items = (s.items || []).map((it) => ({
      productId: it.productId || null,
      name: it?.productSnapshot?.name || "",
      qty: safeNum(it.qty),
      unit: it?.productSnapshot?.unit || "",
      price: safeNum(it.sell_price),
      currency: it.currency || "",
      subtotal: safeNum(it.subtotal),
    }));

    if (Array.isArray(s.history) && s.history.length) {
      for (const h of s.history) {
        const type = String(h.type || "");
        const mapType = {
          SALE_CREATED: "SALE",
          SALE_EDITED: "SALE_EDIT",
          RETURN_CREATED: "RETURN",
          CANCELED: "SALE_CANCEL",
          DELETED: "SALE_DELETE",
        };

        if (!mapType[type]) continue;

        const delta = {
          UZS: safeNum(h?.amountDelta?.UZS),
          USD: safeNum(h?.amountDelta?.USD),
        };

        events.push(
          normalizeEvent({
            date: h.date || saleDate,
            docType: mapType[type],
            docNo: saleDocNo,
            refId: s._id,
            description: h.note || "",
            items,
            delta,
          }),
        );
      }
    } else {
      events.push(
        normalizeEvent({
          date: saleDate,
          docType: "SALE",
          docNo: saleDocNo,
          refId: s._id,
          description: "Sotuv",
          items,
          delta: {
            UZS: safeNum(s?.currencyTotals?.UZS?.grandTotal),
            USD: safeNum(s?.currencyTotals?.USD?.grandTotal),
          },
        }),
      );
    }
  }

  const customer = await Customer.findById(customerId)
    .select("payment_history")
    .lean();

  const paymentHistory = Array.isArray(customer?.payment_history)
    ? customer.payment_history
    : [];

  for (const p of paymentHistory) {
    const direction = String(p.direction || "");
    let sign = 0;

    if (direction === "DEBT" || direction === "PAYMENT_CANCEL") sign = 1;
    if (
      direction === "PAYMENT" ||
      direction === "PREPAYMENT" ||
      direction === "PREPAID"
    ) {
      sign = -1;
    }
    if (direction === "ROLLBACK") sign = 1;

    if (sign === 0) continue;

    const d = toDeltaByCurrency(safeNum(p.amount) * sign, p.currency);

    events.push(
      normalizeEvent({
        date: p.date || new Date(),
        docType: direction,
        docNo: "",
        refId: null,
        description: p.note || "",
        delta: d,
      }),
    );
  }

  return events;
}

async function buildSupplierEvents(supplierId) {
  const events = [];

  const purchases = await Purchase.find({ supplier_id: toObjId(supplierId) })
    .select("batch_no purchase_date createdAt totals items")
    .lean();

  for (const p of purchases) {
    const items = (p.items || []).map((it) => ({
      productId: it.product_id || null,
      name: it.name || "",
      qty: safeNum(it.qty),
      unit: it.unit || "",
      price: safeNum(it.buy_price),
      currency: it.currency || "",
      subtotal: safeNum(it.row_total),
    }));

    events.push(
      normalizeEvent({
        date: p.purchase_date || p.createdAt || new Date(),
        docType: "PURCHASE",
        docNo: p.batch_no || "",
        refId: p._id,
        description: "Kirim (zavoddan olindi)",
        items,
        delta: {
          UZS: safeNum(p?.totals?.UZS),
          USD: safeNum(p?.totals?.USD),
        },
      }),
    );
  }

  const supplier = await Supplier.findById(supplierId)
    .select("payment_history")
    .lean();

  const paymentHistory = Array.isArray(supplier?.payment_history)
    ? supplier.payment_history
    : [];

  for (const p of paymentHistory) {
    const direction = String(p.direction || "");
    let sign = 0;

    if (direction === "DEBT" || direction === "ROLLBACK") sign = 1;
    if (direction === "PAYMENT" || direction === "PREPAYMENT") sign = -1;

    if (sign === 0) continue;

    events.push(
      normalizeEvent({
        date: p.date || new Date(),
        docType: direction,
        docNo: "",
        refId: p.ref_id || null,
        description: p.note || "",
        delta: toDeltaByCurrency(safeNum(p.amount) * sign, p.currency),
      }),
    );
  }

  return events;
}

function buildActResponse({ events, fromDate, toDate, currency }) {
  const sorted = [...events].sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (ta === tb) return String(a.docType).localeCompare(String(b.docType));
    return ta - tb;
  });

  let running = { UZS: 0, USD: 0 };
  const summary = {
    openingDebt: { UZS: 0, USD: 0 },
    increaseDebt: { UZS: 0, USD: 0 },
    decreaseDebt: { UZS: 0, USD: 0 },
    closingDebt: { UZS: 0, USD: 0 },
  };
  const documents = [];

  for (const e of sorted) {
    const d = applyCurrencyFilter(e.delta, currency);
    const eventDate = new Date(e.date);

    const isBefore = fromDate ? eventDate.getTime() < fromDate.getTime() : false;
    const inPeriod =
      (!fromDate || eventDate.getTime() >= fromDate.getTime()) &&
      (!toDate || eventDate.getTime() <= toDate.getTime());

    if (isBefore) {
      running.UZS += d.UZS;
      running.USD += d.USD;
      continue;
    }

    if (!inPeriod) continue;

    const increase = {
      UZS: d.UZS > 0 ? d.UZS : 0,
      USD: d.USD > 0 ? d.USD : 0,
    };
    const decrease = {
      UZS: d.UZS < 0 ? Math.abs(d.UZS) : 0,
      USD: d.USD < 0 ? Math.abs(d.USD) : 0,
    };

    addMoney(summary, "increaseDebt", increase);
    addMoney(summary, "decreaseDebt", decrease);

    running.UZS += d.UZS;
    running.USD += d.USD;

    documents.push({
      date: e.date,
      docType: e.docType,
      docNo: e.docNo,
      refId: e.refId,
      description: e.description,
      increase,
      decrease,
      balanceAfter: {
        UZS: running.UZS,
        USD: running.USD,
      },
      items: e.items,
    });
  }

  summary.openingDebt = { ...running };
  summary.openingDebt.UZS -= summary.increaseDebt.UZS - summary.decreaseDebt.UZS;
  summary.openingDebt.USD -= summary.increaseDebt.USD - summary.decreaseDebt.USD;
  summary.closingDebt = { ...running };

  return { summary, documents };
}

exports.getCounterparties = async (req, res) => {
  try {
    const type = String(req.query.type || "CUSTOMER").toUpperCase();
    const q = String(req.query.q || "").trim();
    const debtStatus = String(req.query.debt_status || "").toUpperCase();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));

    const searchFilter = q
      ? { $or: [{ name: new RegExp(q, "i") }, { phone: new RegExp(q, "i") }] }
      : {};

    if (type === "SUPPLIER") {
      const suppliers = await Supplier.find(searchFilter)
        .select("name phone address note balance")
        .sort({ name: 1 })
        .limit(limit)
        .lean();

      const items = suppliers
        .map((s) => ({
          _id: s._id,
          name: s.name,
          phone: s.phone || "",
          address: s.address || "",
          note: s.note || "",
          balance: {
            UZS: safeNum(s?.balance?.UZS),
            USD: safeNum(s?.balance?.USD),
          },
          status: statusByBalance(s.balance),
        }))
        .filter((x) => {
          if (!["DEBT", "CLEAR", "PREPAID"].includes(debtStatus)) return true;
          return x.status.UZS === debtStatus || x.status.USD === debtStatus;
        });

      return res.json({ ok: true, type, total: items.length, items });
    }

    const customers = await Customer.find(searchFilter)
      .select("name phone address note balance isActive")
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    const items = customers
      .map((c) => ({
        _id: c._id,
        name: c.name,
        phone: c.phone || "",
        address: c.address || "",
        note: c.note || "",
        isActive: c.isActive !== false,
        balance: {
          UZS: safeNum(c?.balance?.UZS),
          USD: safeNum(c?.balance?.USD),
        },
        status: statusByBalance(c.balance),
      }))
      .filter((x) => {
        if (!["DEBT", "CLEAR", "PREPAID"].includes(debtStatus)) return true;
        return x.status.UZS === debtStatus || x.status.USD === debtStatus;
      });

    return res.json({ ok: true, type: "CUSTOMER", total: items.length, items });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Counterparty list olishda xato",
      error: error.message,
    });
  }
};

exports.getActSverka = async (req, res) => {
  try {
    const { id } = req.params;
    const type = String(req.params.type || "CUSTOMER").toUpperCase();
    const currency = String(req.query.currency || "ALL").toUpperCase();
    const fromDate = startOfDay(req.query.from);
    const toDate = endOfDay(req.query.to);

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    if (!["CUSTOMER", "SUPPLIER"].includes(type)) {
      return res.status(400).json({
        ok: false,
        message: "type CUSTOMER yoki SUPPLIER bo'lishi kerak",
      });
    }

    if (!["ALL", "UZS", "USD"].includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency ALL, UZS yoki USD bo'lishi kerak",
      });
    }

    let counterparty = null;
    let events = [];

    if (type === "CUSTOMER") {
      counterparty = await Customer.findById(id)
        .select("name phone address note balance")
        .lean();
      if (!counterparty) {
        return res
          .status(404)
          .json({ ok: false, message: "Mijoz topilmadi" });
      }
      events = await buildCustomerEvents(id);
    } else {
      counterparty = await Supplier.findById(id)
        .select("name phone address note balance")
        .lean();
      if (!counterparty) {
        return res
          .status(404)
          .json({ ok: false, message: "Zavod topilmadi" });
      }
      events = await buildSupplierEvents(id);
    }

    const { summary, documents } = buildActResponse({
      events,
      fromDate,
      toDate,
      currency,
    });

    return res.json({
      ok: true,
      type,
      counterparty: {
        _id: counterparty._id,
        name: counterparty.name || "",
        phone: counterparty.phone || "",
        address: counterparty.address || "",
        note: counterparty.note || "",
        currentBalance: {
          UZS: safeNum(counterparty?.balance?.UZS),
          USD: safeNum(counterparty?.balance?.USD),
        },
      },
      period: {
        from: fromDate,
        to: toDate,
      },
      filters: {
        currency,
        organization: req.query.organization || null,
      },
      summary,
      totalDocuments: documents.length,
      documents,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Akt sverka hisoblashda xato",
      error: error.message,
    });
  }
};
