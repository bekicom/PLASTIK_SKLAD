// controllers/sale.controller.js
const mongoose = require("mongoose");

const Sale = require("../modules/sales/Sale");
const Product = require("../modules/products/Product");
const Warehouse = require("../modules/Warehouse/Warehouse");
const Customer = require("../modules/Customer/Customer");
const Supplier = require("../modules/suppliers/Supplier");

/* =====================
   HELPERS
===================== */
function safeNumber(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMaybeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getCurrentUserId(req) {
  return req.user?._id || req.user?.id || null;
}

function cloneCustomerSnapshot(customer) {
  if (!customer) return null;
  return {
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    note: customer.note,
  };
}

function buildCurrencyTotals(items, discount = 0) {
  const currencyTotals = {
    UZS: {
      subtotal: 0,
      discount: 0,
      grandTotal: 0,
      paidAmount: 0,
      debtAmount: 0,
    },
    USD: {
      subtotal: 0,
      discount: 0,
      grandTotal: 0,
      paidAmount: 0,
      debtAmount: 0,
    },
  };

  for (const it of items) {
    if (currencyTotals[it.currency]) {
      currencyTotals[it.currency].subtotal += Number(it.subtotal || 0);
    }
  }

  const disc = Math.max(0, safeNumber(discount));
  const totalAll = currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal;

  if (disc > 0 && totalAll > 0) {
    currencyTotals.UZS.discount = +(
      disc * (currencyTotals.UZS.subtotal / totalAll)
    ).toFixed(2);
    currencyTotals.USD.discount = +(
      disc * (currencyTotals.USD.subtotal / totalAll)
    ).toFixed(2);
  }

  for (const cur of ["UZS", "USD"]) {
    currencyTotals[cur].grandTotal = Math.max(
      0,
      +(currencyTotals[cur].subtotal - currencyTotals[cur].discount).toFixed(2),
    );
  }

  return currencyTotals;
}

function buildSaleHistoryNote(type, payload = {}) {
  if (type === "SALE_CREATED") return "Sotuv yaratildi";
  if (type === "SALE_EDITED") return "Sotuv tahrirlandi";
  if (type === "RETURN_CREATED") return "Vozvrat qilindi";
  if (type === "CANCELED") return "Sotuv bekor qilindi";
  if (type === "DELETED") return "Sotuv o‘chirildi";
  return payload.note || "";
}

function buildItemBrief(items = []) {
  return (items || []).map((it) => ({
    productId: it.productId,
    name: it.productSnapshot?.name || "",
    qty: Number(it.qty || 0),
    subtotal: Number(it.subtotal || 0),
    currency: it.currency || "",
  }));
}

function buildCustomerBalanceImpact(currencyTotals = {}) {
  const uzsGrand = Number(currencyTotals.UZS?.grandTotal || 0);
  const usdGrand = Number(currencyTotals.USD?.grandTotal || 0);
  const uzsPaid = Math.min(
    Number(currencyTotals.UZS?.paidAmount || 0),
    uzsGrand,
  );
  const usdPaid = Math.min(
    Number(currencyTotals.USD?.paidAmount || 0),
    usdGrand,
  );

  return {
    UZS: Number((uzsGrand - uzsPaid).toFixed(2)),
    USD: Number((usdGrand - usdPaid).toFixed(2)),
  };
}

async function buildSaleItemsFromInput(session, items) {
  const normalizedItems = [];
  const productIds = [];
  const seen = new Set();

  for (const raw of items) {
    const productId = raw?.productId || raw?.product_id;
    if (!mongoose.isValidObjectId(productId)) {
      throw new Error("Product ID noto‘g‘ri");
    }
    const key = String(productId);
    if (seen.has(key)) {
      throw new Error("Bir xil product takrorlanmasin");
    }
    seen.add(key);
    productIds.push(key);
  }

  const products = await Product.find({
    _id: { $in: productIds },
  })
    .select("_id name model color category unit images qty buy_price sell_price warehouse_currency")
    .session(session);

  if (products.length !== productIds.length) {
    throw new Error("Ba’zi productlar topilmadi");
  }

  const productMap = new Map(products.map((p) => [String(p._id), p]));

  for (const raw of items) {
    const productId = raw?.productId || raw?.product_id;
    const product = productMap.get(String(productId));
    const qty = safeNumber(raw?.qty);
    if (qty <= 0) throw new Error("qty noto‘g‘ri");

    const sellPrice = safeNumber(
      raw?.sell_price ?? raw?.price ?? product.sell_price,
    );
    if (sellPrice <= 0) {
      throw new Error("sell_price noto‘g‘ri");
    }

    const stockQty = Number(product.qty || 0);
    if (stockQty < qty) {
      throw new Error(`Stock yetarli emas: ${product.name}`);
    }

    normalizedItems.push({
      productId: product._id,
      productSnapshot: {
        name: product.name,
        model: product.model || "",
        color: product.color || "",
        category: product.category || "",
        unit: product.unit,
        images: product.images || [],
      },
      warehouseId: null,
      currency: product.warehouse_currency,
      qty,
      sell_price: sellPrice,
      buy_price: safeNumber(product.buy_price),
      subtotal: +(qty * sellPrice).toFixed(2),
    });
  }

  const currencies = [...new Set(products.map((p) => p.warehouse_currency))];
  const warehouses = await Warehouse.find({
    currency: { $in: currencies },
  })
    .select("_id currency")
    .session(session);

  const wMap = new Map(warehouses.map((w) => [w.currency, w._id]));

  for (const item of normalizedItems) {
    const warehouseId = wMap.get(item.currency);
    if (!warehouseId) {
      throw new Error(`Warehouse topilmadi: ${item.currency}`);
    }
    item.warehouseId = warehouseId;
  }

  for (const item of normalizedItems) {
    await Product.updateOne(
      { _id: item.productId, qty: { $gte: item.qty } },
      { $inc: { qty: -item.qty } },
      { session },
    );
  }

  return normalizedItems;
}

async function restoreProductStock(session, items) {
  for (const it of items || []) {
    if (!it?.productId || !mongoose.isValidObjectId(it.productId)) continue;
    const ok = await Product.updateOne(
      { _id: it.productId },
      { $inc: { qty: Number(it.qty || 0) } },
      { session },
    );

    if (ok.modifiedCount === 0) {
      throw new Error("Product topilmadi yoki stock qaytarilmadi");
    }
  }
}

async function reapplyExistingSaleItems(session, items) {
  for (const it of items || []) {
    if (!it?.productId || !mongoose.isValidObjectId(it.productId)) {
      throw new Error("Sale item productId noto‘g‘ri");
    }

    const qty = safeNumber(it.qty);
    if (qty <= 0) throw new Error("Sale item qty noto‘g‘ri");

    const ok = await Product.updateOne(
      { _id: it.productId, qty: { $gte: qty } },
      { $inc: { qty: -qty } },
      { session },
    );

    if (ok.modifiedCount === 0) {
      throw new Error("Stock yetarli emas");
    }
  }
}

/* =====================
   CREATE SALE
===================== */
exports.createSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* =====================
       1️⃣ AUTH
    ===================== */
    const soldBy = req.user?._id || req.user?.id;
    if (!soldBy) throw new Error("Auth required");

    const {
      saleDate,
      customerId,
      customer, // yangi customer bo‘lishi mumkin
      items = [],
      discount = 0,
      note = "",
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("items bo‘sh bo‘lishi mumkin emas");
    }

    /* =====================
       2️⃣ SALE DATE
    ===================== */
    let finalSaleDate = new Date();
    if (saleDate) {
      const d = new Date(saleDate);
      if (Number.isNaN(d.getTime())) {
        throw new Error("saleDate noto‘g‘ri");
      }
      finalSaleDate = d;
    }

    /* =====================
       3️⃣ CUSTOMER
       priority:
       1) customerId
       2) customer object
       3) null (walk-in)
    ===================== */
    let finalCustomerId = null;
    let customerSnapshot = null;

    if (mongoose.isValidObjectId(customerId)) {
      const c = await Customer.findById(customerId).session(session);
      if (!c) throw new Error("Customer topilmadi");

      finalCustomerId = c._id;
      customerSnapshot = {
        name: c.name,
        phone: c.phone,
        address: c.address,
        note: c.note,
      };
    } else if (customer && customer.name) {
      const created = await Customer.create(
        [
          {
            name: customer.name,
            phone: customer.phone || "",
            address: customer.address || "",
            note: customer.note || "",
            balance: { UZS: 0, USD: 0 },
          },
        ],
        { session },
      );

      finalCustomerId = created[0]._id;
      customerSnapshot = {
        name: created[0].name,
        phone: created[0].phone,
        address: created[0].address,
        note: created[0].note,
      };
    }

    /* =====================
       4️⃣ PRODUCTS LOAD
    ===================== */
    const productIds = items.map((i) => i.productId);

    const products = await Product.find({
      _id: { $in: productIds },
    })
      .select(
        "_id name model color category unit images qty buy_price warehouse_currency",
      )
      .session(session);

    if (products.length !== productIds.length) {
      throw new Error("Ba’zi productlar topilmadi");
    }

    const pMap = new Map(products.map((p) => [String(p._id), p]));

    /* =====================
       5️⃣ STOCK CHECK
    ===================== */
    for (const it of items) {
      const p = pMap.get(String(it.productId));
      if (!p) throw new Error("Product topilmadi");

      const qty = safeNumber(it.qty);
      if (qty <= 0) throw new Error("qty noto‘g‘ri");

      if (p.qty < qty) {
        throw new Error(`Stock yetarli emas: ${p.name}`);
      }
    }

    /* =====================
       6️⃣ STOCK DECREASE
    ===================== */
    for (const it of items) {
      await Product.updateOne(
        { _id: it.productId, qty: { $gte: it.qty } },
        { $inc: { qty: -it.qty } },
        { session },
      );
    }

    /* =====================
       7️⃣ WAREHOUSES
    ===================== */
    const currencies = [...new Set(products.map((p) => p.warehouse_currency))];

    const warehouses = await Warehouse.find({
      currency: { $in: currencies },
    })
      .select("_id currency")
      .session(session);

    const wMap = new Map(warehouses.map((w) => [w.currency, w._id]));

    /* =====================
       8️⃣ SALE ITEMS
    ===================== */
    const saleItems = items.map((it) => {
      const p = pMap.get(String(it.productId));
      const qty = safeNumber(it.qty);
      const sellPrice = safeNumber(it.sell_price);

      if (sellPrice <= 0) {
        throw new Error("sell_price noto‘g‘ri");
      }

      const currency = p.warehouse_currency;
      const warehouseId = wMap.get(currency);
      if (!warehouseId) {
        throw new Error(`Warehouse topilmadi: ${currency}`);
      }

      return {
        productId: p._id,
        productSnapshot: {
          name: p.name,
          model: p.model || "",
          color: p.color || "",
          category: p.category || "",
          unit: p.unit,
          images: p.images || [],
        },
        warehouseId,
        currency,
        qty,
        sell_price: sellPrice,
        buy_price: safeNumber(p.buy_price),
        subtotal: +(qty * sellPrice).toFixed(2),
      };
    });

    /* =====================
       9️⃣ TOTALS
    ===================== */
    const currencyTotals = {
      UZS: {
        subtotal: 0,
        discount: 0,
        grandTotal: 0,
        paidAmount: 0,
        debtAmount: 0,
      },
      USD: {
        subtotal: 0,
        discount: 0,
        grandTotal: 0,
        paidAmount: 0,
        debtAmount: 0,
      },
    };

    for (const it of saleItems) {
      currencyTotals[it.currency].subtotal += it.subtotal;
    }

    const disc = Math.max(0, safeNumber(discount));
    const totalAll = currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal;

    if (disc > 0 && totalAll > 0) {
      currencyTotals.UZS.discount = +(
        disc *
        (currencyTotals.UZS.subtotal / totalAll)
      ).toFixed(2);
      currencyTotals.USD.discount = +(
        disc *
        (currencyTotals.USD.subtotal / totalAll)
      ).toFixed(2);
    }

    for (const cur of ["UZS", "USD"]) {
      currencyTotals[cur].grandTotal = Math.max(
        0,
        +(currencyTotals[cur].subtotal - currencyTotals[cur].discount).toFixed(
          2,
        ),
      );

      currencyTotals[cur].debtAmount = currencyTotals[cur].grandTotal;
    }

    /* =====================
       🔟 SALE CREATE
    ===================== */
    const invoiceNo = `S-${Date.now()}`;

    const [sale] = await Sale.create(
      [
        {
          invoiceNo,
          saleDate: finalSaleDate,
          soldBy,
          customerId: finalCustomerId,
          customerSnapshot,
          items: saleItems,
          totals: {
            subtotal: currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal,
            discount: disc,
            grandTotal:
              currencyTotals.UZS.grandTotal + currencyTotals.USD.grandTotal,
          },
          currencyTotals,
          history: [
            {
              type: "SALE_CREATED",
              date: finalSaleDate,
              by: soldBy,
              note: note || "Sotuv yaratildi",
              amountDelta: {
                UZS: Number(currencyTotals.UZS.debtAmount || 0),
                USD: Number(currencyTotals.USD.debtAmount || 0),
              },
              payload: {
                customerId: finalCustomerId,
                items: buildItemBrief(saleItems),
                totals: {
                  subtotal:
                    currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal,
                  discount: disc,
                  grandTotal:
                    currencyTotals.UZS.grandTotal +
                    currencyTotals.USD.grandTotal,
                },
              },
            },
          ],
          note,
          status: "COMPLETED",
        },
      ],
      { session },
    );

    /* =====================
       1️⃣1️⃣ CUSTOMER BALANCE
       🔥 FAQAT BALANCE
    ===================== */
    if (finalCustomerId) {
      const customerDoc =
        await Customer.findById(finalCustomerId).session(session);

      if (customerDoc) {
        customerDoc.balance.UZS =
          Number(customerDoc.balance.UZS || 0) +
          Number(currencyTotals.UZS.debtAmount || 0);

        customerDoc.balance.USD =
          Number(customerDoc.balance.USD || 0) +
          Number(currencyTotals.USD.debtAmount || 0);

        await customerDoc.save({ session });
      }
    }

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      message: "Sale yaratildi",
      sale,
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};

exports.editSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new Error("Sale ID noto‘g‘ri");
    }

    const sale = await Sale.findById(id).session(session);
    if (!sale) throw new Error("Sale topilmadi");
    if (sale.status !== "COMPLETED") {
      throw new Error("Faqat COMPLETED sale tahrirlanadi");
    }

    const oldItems = (sale.items || []).map((it) => ({ ...it.toObject() }));
    const oldCurrencyTotals = sale.currencyTotals || {};
    const oldCustomerId = sale.customerId ? String(sale.customerId) : null;
    const oldSaleDate = sale.saleDate;
    const oldDebt = {
      UZS: Number(oldCurrencyTotals.UZS?.debtAmount || 0),
      USD: Number(oldCurrencyTotals.USD?.debtAmount || 0),
    };
    const oldBalanceImpact = buildCustomerBalanceImpact(oldCurrencyTotals);

    const hasCustomerPatch =
      Object.prototype.hasOwnProperty.call(req.body || {}, "customerId") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "customer");
    const hasItemsPatch = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "items",
    );
    const hasSaleDatePatch = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "saleDate",
    );
    const hasDiscountPatch = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "discount",
    );

    const nextSaleDate = hasSaleDatePatch
      ? parseMaybeDate(req.body.saleDate)
      : sale.saleDate;
    if (hasSaleDatePatch && !nextSaleDate) {
      throw new Error("saleDate noto‘g‘ri");
    }

    const nextDiscount = hasDiscountPatch
      ? safeNumber(req.body.discount)
      : Number(sale.totals?.discount || 0);

    const nextNote =
      Object.prototype.hasOwnProperty.call(req.body || {}, "note")
        ? String(req.body.note || "")
        : sale.note || "";

    /* =========================
       1. OLD BALANCE + STOCK ROLLBACK
    ========================= */
    if (oldCustomerId) {
      const oldCustomer = await Customer.findById(oldCustomerId).session(
        session,
      );
      if (oldCustomer) {
        oldCustomer.balance.UZS =
          Number(oldCustomer.balance?.UZS || 0) - oldBalanceImpact.UZS;
        oldCustomer.balance.USD =
          Number(oldCustomer.balance?.USD || 0) - oldBalanceImpact.USD;
        await oldCustomer.save({ session });
      }
    }

    await restoreProductStock(session, oldItems);

    /* =========================
       2. NEW CUSTOMER
    ========================= */
    let nextCustomerId = sale.customerId || null;
    let nextCustomerSnapshot = sale.customerSnapshot || null;
    let nextCustomerDoc = null;

    if (hasCustomerPatch) {
      const customerId = req.body.customerId;
      const customerRaw = req.body.customer;

      if (mongoose.isValidObjectId(customerId)) {
        nextCustomerDoc = await Customer.findById(customerId).session(session);
        if (!nextCustomerDoc) throw new Error("Customer topilmadi");
      } else if (customerRaw && typeof customerRaw === "object") {
        const name = String(customerRaw.name || "").trim();
        const phone = String(customerRaw.phone || "").trim();
        const address = String(customerRaw.address || "").trim();
        const note = String(customerRaw.note || "").trim();

        if (!name) {
          throw new Error("customer name majburiy");
        }

        if (phone) {
          const existing = await Customer.findOne({ phone }).session(session);
          if (existing) {
            nextCustomerDoc = existing;
          }
        }

        if (!nextCustomerDoc) {
          nextCustomerDoc = await Customer.create(
            [
              {
                name,
                phone,
                address,
                note,
                balance: { UZS: 0, USD: 0 },
              },
            ],
            { session },
          ).then((rows) => rows[0]);
        }
      } else if (customerId === null || customerRaw === null) {
        nextCustomerDoc = null;
      } else {
        throw new Error("customerId yoki customer noto‘g‘ri");
      }

      nextCustomerId = nextCustomerDoc ? nextCustomerDoc._id : null;
      nextCustomerSnapshot = nextCustomerDoc
        ? cloneCustomerSnapshot(nextCustomerDoc)
        : null;
    } else if (nextCustomerId) {
      nextCustomerDoc = await Customer.findById(nextCustomerId).session(session);
    }

    /* =========================
       3. ITEMS
    ========================= */
    let nextItems = oldItems;
    if (hasItemsPatch) {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        throw new Error("items bo‘sh bo‘lishi mumkin emas");
      }

      nextItems = await buildSaleItemsFromInput(session, req.body.items);
    } else {
      await reapplyExistingSaleItems(session, oldItems);
    }

    /* =========================
       4. TOTALS
    ========================= */
    const nextCurrencyTotals = buildCurrencyTotals(nextItems, nextDiscount);
    nextCurrencyTotals.UZS.paidAmount = Math.min(
      Number(oldCurrencyTotals.UZS?.paidAmount || 0),
      Number(nextCurrencyTotals.UZS.grandTotal || 0),
    );
    nextCurrencyTotals.USD.paidAmount = Math.min(
      Number(oldCurrencyTotals.USD?.paidAmount || 0),
      Number(nextCurrencyTotals.USD.grandTotal || 0),
    );
    nextCurrencyTotals.UZS.debtAmount = Math.max(
      0,
      nextCurrencyTotals.UZS.grandTotal - nextCurrencyTotals.UZS.paidAmount,
    );
    nextCurrencyTotals.USD.debtAmount = Math.max(
      0,
      nextCurrencyTotals.USD.grandTotal - nextCurrencyTotals.USD.paidAmount,
    );

    const newDebt = {
      UZS: Number(nextCurrencyTotals.UZS.debtAmount || 0),
      USD: Number(nextCurrencyTotals.USD.debtAmount || 0),
    };
    const newBalanceImpact = buildCustomerBalanceImpact(nextCurrencyTotals);

    /* =========================
       5. BALANCE TRANSFER
    ========================= */
    const changedCustomer = String(nextCustomerId || "") !== String(oldCustomerId || "");

    if (nextCustomerDoc) {
      if (oldCustomerId && String(nextCustomerDoc._id) === oldCustomerId) {
        nextCustomerDoc.balance.UZS =
          Number(nextCustomerDoc.balance?.UZS || 0) + newBalanceImpact.UZS;
        nextCustomerDoc.balance.USD =
          Number(nextCustomerDoc.balance?.USD || 0) + newBalanceImpact.USD;
      } else {
        nextCustomerDoc.balance.UZS =
          Number(nextCustomerDoc.balance?.UZS || 0) + newBalanceImpact.UZS;
        nextCustomerDoc.balance.USD =
          Number(nextCustomerDoc.balance?.USD || 0) + newBalanceImpact.USD;
      }
      await nextCustomerDoc.save({ session });
    }

    if (changedCustomer && oldCustomerId) {
      const oldCustomer = await Customer.findById(oldCustomerId).session(
        session,
      );
      if (oldCustomer) {
        await oldCustomer.save({ session });
      }

      if (nextCustomerDoc) {
        await nextCustomerDoc.save({ session });
      }
    }

    /* =========================
       6. SAVE SALE
    ========================= */
    sale.saleDate = nextSaleDate;
    sale.customerId = nextCustomerId;
    sale.customerSnapshot = nextCustomerSnapshot;
    sale.items = nextItems;
    sale.totals = {
      subtotal: nextCurrencyTotals.UZS.subtotal + nextCurrencyTotals.USD.subtotal,
      discount: nextDiscount,
      grandTotal:
        nextCurrencyTotals.UZS.grandTotal + nextCurrencyTotals.USD.grandTotal,
    };
    sale.currencyTotals = nextCurrencyTotals;
    sale.note = nextNote;
    sale.editedAt = new Date();
    sale.editedBy = getCurrentUserId(req);
    sale.editReason = String(req.body.editReason || req.body.reason || "").slice(
      0,
      500,
    );
    sale.revision = Number(sale.revision || 0) + 1;
    sale.history = Array.isArray(sale.history) ? sale.history : [];
    sale.history.push({
      type: "SALE_EDITED",
      date: new Date(),
      by: getCurrentUserId(req),
      note: sale.editReason || "Sotuv tahrirlandi",
      amountDelta: {
        UZS: newDebt.UZS - oldDebt.UZS,
        USD: newDebt.USD - oldDebt.USD,
      },
      payload: {
        oldCustomerId,
        newCustomerId: nextCustomerId ? String(nextCustomerId) : null,
        oldSaleDate,
        newSaleDate: nextSaleDate,
        oldItems: buildItemBrief(oldItems),
        newItems: buildItemBrief(nextItems),
        oldTotals: {
          UZS: oldDebt.UZS,
          USD: oldDebt.USD,
        },
        newTotals: {
          UZS: newDebt.UZS,
          USD: newDebt.USD,
        },
        oldBalanceImpact,
        newBalanceImpact: {
          UZS: newBalanceImpact.UZS,
          USD: newBalanceImpact.USD,
        },
      },
    });

    await sale.save({ session });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Sale yangilandi",
      sale,
      debt: newDebt,
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};

// controllers/sale.controller.js

exports.getSales = async (req, res) => {
  try {
    const { from, to, customerId, soldBy, status } = req.query;

    const filter = {};

    /* =====================
       STATUS
       default: DELETED kelmaydi
    ===================== */
    if (status) {
      const st = String(status).toUpperCase();

      if (st === "DELETED") {
        // faqat ataylab so‘ralsa
        filter.status = "DELETED";
      } else {
        filter.status = st;
      }
    } else {
      // default holatda DELETED ni yashiramiz
      filter.status = { $ne: "DELETED" };
    }

    /* =====================
       CUSTOMER
    ===================== */
    if (customerId && mongoose.isValidObjectId(customerId)) {
      filter.customerId = customerId;
    }

    /* =====================
       SOLD BY (AGENT / CASHIER)
    ===================== */
    if (soldBy && mongoose.isValidObjectId(soldBy)) {
      filter.soldBy = soldBy;
    }

    /* =====================
       DATE FILTER (SALE DATE)
    ===================== */
    if (from || to) {
      filter.saleDate = {};
      if (from) filter.saleDate.$gte = new Date(from);
      if (to) filter.saleDate.$lte = new Date(to);
    }

    /* =====================
       QUERY
    ===================== */
    const rows = await Sale.find(filter)
      .sort({ saleDate: -1, createdAt: -1 })
      .populate("soldBy", "name phone login")
      .populate("customerId", "name phone address note")
      .populate({
        path: "items.warehouseId",
        select: "name currency",
      })
      .select("invoiceNo saleDate createdAt soldBy customerId customerSnapshot items totals currencyTotals status note canceledAt cancelReason history")
      .lean();

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows.map((sale) => ({
      _id: sale._id,
      invoiceNo: sale.invoiceNo,
      status: sale.status,
      saleDate: sale.saleDate,
      createdAt: sale.createdAt,
      canceledAt: sale.canceledAt || null,

      agent: sale.soldBy
        ? {
            _id: sale.soldBy._id,
            name: sale.soldBy.name,
            phone: sale.soldBy.phone,
            login: sale.soldBy.login,
          }
        : null,

      customer: sale.customerId
        ? {
            _id: sale.customerId._id,
            name: sale.customerId.name,
            phone: sale.customerId.phone,
            address: sale.customerId.address,
            note: sale.customerId.note,
          }
        : sale.customerSnapshot || null,

      items: sale.items.map((it) => ({
        product_id: it.productId,

        warehouse: it.warehouseId
          ? {
              _id: it.warehouseId._id,
              name: it.warehouseId.name,
              currency: it.warehouseId.currency,
            }
          : null,

        product_snapshot: it.productSnapshot,

        qty: it.qty,
        sell_price_snapshot: it.sell_price,
        buy_price_snapshot: it.buy_price,
        subtotal: it.subtotal,
        currency_snapshot: it.currency,
      })),

      totals: sale.totals,
      currencyTotals: sale.currencyTotals,
      payments: sale.payments || [],
      note: sale.note || "",
      history: Array.isArray(sale.history) ? sale.history : [],
    }));

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("getSales error:", err);
    return res.status(500).json({
      ok: false,
      message: "Sotuvlar ro‘yxatini olishda xato",
    });
  }
};

exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ message: "ID noto'g'ri" });

    const sale = await Sale.findById(id)
      .populate("customerId", "name phone address note")
      .select("invoiceNo saleDate createdAt soldBy customerId customerSnapshot items totals currencyTotals status note canceledAt cancelReason history editedAt editedBy editReason revision")
      .lean();
    if (!sale) return res.status(404).json({ message: "Sale topilmadi" });

    return res.json({
      ok: true,
      item: {
        ...sale,
        history: Array.isArray(sale.history) ? sale.history : [],
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Sale olishda xato", error: err.message });
  }
};

exports.cancelSale = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const sale = await Sale.findById(req.params.id).session(session);
      if (!sale) throw new Error("Sale topilmadi");

      if (sale.status === "CANCELED") {
        throw new Error("Sale allaqachon bekor qilingan");
      }

      /* =====================
         1️⃣ PRODUCT STOCK QAYTARISH
      ===================== */
      for (const it of sale.items) {
        const product = await Product.findOne({
          _id: it.productId,
          warehouse_currency: it.currency,
        }).session(session);

        if (!product) throw new Error("Product topilmadi");

        product.qty += it.qty;
        await product.save({ session });
      }

      /* =====================
         2️⃣ CUSTOMER DEBT QAYTARISH
      ===================== */
      if (sale.customerId) {
        const customer = await Customer.findById(sale.customerId).session(
          session,
        );

        if (customer && sale.currencyTotals) {
          if (!customer.balance) {
            customer.balance = { UZS: 0, USD: 0 };
          }

          for (const cur of ["UZS", "USD"]) {
            const debt = sale.currencyTotals[cur]?.debtAmount || 0;

            if (debt > 0) {
              customer.balance[cur] = (customer.balance[cur] || 0) - debt;

              if (customer.balance[cur] < 0) {
                customer.balance[cur] = 0;
              }
            }
          }

          await customer.save({ session });
        }
      }

      /* =====================
         3️⃣ SALE CANCELED
      ===================== */
      sale.status = "CANCELED";
      sale.canceledAt = new Date();
      sale.cancelReason = req.body?.reason || "Sale bekor qilindi";

      await sale.save({ session });
    });

    return res.json({
      ok: true,
      message: "Sale muvaffaqiyatli bekor qilindi",
    });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      message: e.message,
    });
  } finally {
    session.endSession();
  }
};

exports.searchSalesByProduct = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.status(400).json({
        ok: false,
        message: "q (product nomi) majburiy",
      });
    }

    const rx = new RegExp(escapeRegex(q), "i");

    /* =====================
       FILTER
    ===================== */
    const filter = {
      status: "COMPLETED",
      "items.productSnapshot.name": rx,
      "items.qty": { $gt: 0 }, // 🔥 faqat qaytariladiganlar
    };

    if (
      req.query.customerId &&
      mongoose.isValidObjectId(req.query.customerId)
    ) {
      filter.customerId = new mongoose.Types.ObjectId(req.query.customerId);
    }

    if (
      req.query.warehouseId &&
      mongoose.isValidObjectId(req.query.warehouseId)
    ) {
      filter["items.warehouseId"] = new mongoose.Types.ObjectId(
        req.query.warehouseId,
      );
    }

    /* =====================
       QUERY
    ===================== */
    const rows = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .select(
        "invoiceNo createdAt status customerSnapshot customerId items totals currencyTotals",
      )
      .populate("customerId", "name phone address note")
      .lean();

    const productIdSet = new Set();
    for (const s of rows) {
      for (const it of s.items || []) {
        if (it?.productId) productIdSet.add(String(it.productId));
      }
    }

    const products = await Product.find({
      _id: { $in: [...productIdSet] },
    })
      .select("_id supplier_id")
      .lean();

    const supplierIdSet = new Set(
      products.map((p) => String(p.supplier_id || "")).filter(Boolean),
    );

    const suppliers = await Supplier.find({
      _id: { $in: [...supplierIdSet] },
    })
      .select("_id name phone address")
      .lean();

    const supplierById = new Map(
      suppliers.map((s) => [String(s._id), s]),
    );
    const supplierByProductId = new Map(
      products.map((p) => [
        String(p._id),
        supplierById.get(String(p.supplier_id)) || null,
      ]),
    );

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows
      .map((s) => {
        const matchedItems = (s.items || []).filter(
          (it) =>
            rx.test(String(it.productSnapshot?.name || "")) &&
            safeNumber(it.qty) > 0 &&
            (!req.query.warehouseId ||
              String(it.warehouseId) === String(req.query.warehouseId)),
        );

        if (matchedItems.length === 0) return null;

        return {
          _id: s._id,
          invoiceNo: s.invoiceNo,
          createdAt: s.createdAt,
          status: s.status,
          customer: s.customerId
            ? {
                _id: s.customerId._id,
                name: s.customerId.name || "",
                phone: s.customerId.phone || "",
                address: s.customerId.address || "",
                note: s.customerId.note || "",
              }
            : s.customerSnapshot || null,
          totals: s.totals,
          currencyTotals: s.currencyTotals,
          matchedItems: matchedItems.map((it) => {
            const supplier = supplierByProductId.get(String(it.productId));
            return {
              ...it,
              supplier: supplier
                ? {
                    _id: supplier._id,
                    name: supplier.name || "",
                    phone: supplier.phone || "",
                    address: supplier.address || "",
                  }
                : null,
            };
          }),
        };
      })
      .filter(Boolean);

    return res.json({
      ok: true,
      q,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Product bo‘yicha sales qidirishda xato",
      error: err.message,
    });
  }
};

// edit sales

exports.adjustSaleItemQty = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { saleId } = req.params;
    const { productId, newQty } = req.body;

    /* =====================
       VALIDATION
    ===================== */
    if (!mongoose.isValidObjectId(saleId)) throw new Error("Sale ID noto‘g‘ri");
    if (!mongoose.isValidObjectId(productId))
      throw new Error("Product ID noto‘g‘ri");

    const qty = Number(newQty);
    if (!Number.isFinite(qty) || qty < 0)
      throw new Error("newQty noto‘g‘ri (0 yoki katta bo‘lishi kerak)");

    /* =====================
       LOAD SALE
    ===================== */
    const sale = await Sale.findById(saleId).session(session);
    if (!sale) throw new Error("Sale topilmadi");
    if (sale.status !== "COMPLETED")
      throw new Error("Faqat COMPLETED sale tahrirlanadi");

    const itemIndex = sale.items.findIndex(
      (it) => String(it.productId) === String(productId),
    );
    if (itemIndex === -1) throw new Error("Sale ichida bunday product yo‘q");

    const item = sale.items[itemIndex];
    const oldQty = Number(item.qty);
    const delta = qty - oldQty;

    if (delta === 0) throw new Error("Qty o‘zgarmagan");

    /* =====================
       STOCK ADJUST
    ===================== */
    const product = await Product.findById(productId).session(session);
    if (!product) throw new Error("Product topilmadi");

    if (delta > 0) {
      // ko‘proq sotilyapti
      if (product.qty < delta) throw new Error("Stock yetarli emas");
      product.qty -= delta;
    } else {
      // kam sotilyapti (yoki 0)
      product.qty += Math.abs(delta);
    }

    await product.save({ session });

    /* =====================
       SALE ITEM UPDATE
    ===================== */
    if (qty === 0) {
      // ITEMNI BUTUNLAY O‘CHIRAMIZ
      sale.items.splice(itemIndex, 1);
    } else {
      item.qty = qty;
      item.subtotal = +(qty * item.sell_price).toFixed(2);
    }

    /* =====================
       TOTALS RECALC
    ===================== */
    let uzsSubtotal = 0;
    let usdSubtotal = 0;

    for (const it of sale.items) {
      if (it.currency === "UZS") uzsSubtotal += it.subtotal;
      if (it.currency === "USD") usdSubtotal += it.subtotal;
    }

    const oldDebtUZS = sale.currencyTotals.UZS.debtAmount || 0;
    const oldDebtUSD = sale.currencyTotals.USD.debtAmount || 0;

    sale.currencyTotals.UZS.subtotal = uzsSubtotal;
    sale.currencyTotals.USD.subtotal = usdSubtotal;

    sale.currencyTotals.UZS.grandTotal = Math.max(
      0,
      uzsSubtotal - (sale.currencyTotals.UZS.discount || 0),
    );
    sale.currencyTotals.USD.grandTotal = Math.max(
      0,
      usdSubtotal - (sale.currencyTotals.USD.discount || 0),
    );

    sale.currencyTotals.UZS.debtAmount = Math.max(
      0,
      sale.currencyTotals.UZS.grandTotal -
        (sale.currencyTotals.UZS.paidAmount || 0),
    );
    sale.currencyTotals.USD.debtAmount = Math.max(
      0,
      sale.currencyTotals.USD.grandTotal -
        (sale.currencyTotals.USD.paidAmount || 0),
    );

    sale.totals.subtotal = uzsSubtotal + usdSubtotal;
    sale.totals.grandTotal =
      sale.currencyTotals.UZS.grandTotal + sale.currencyTotals.USD.grandTotal;

    /* =====================
       CUSTOMER BALANCE FIX
    ===================== */
    if (sale.customerId) {
      const customer = await Customer.findById(sale.customerId).session(
        session,
      );

      if (customer) {
        const extraUZS = oldDebtUZS - sale.currencyTotals.UZS.debtAmount;
        const extraUSD = oldDebtUSD - sale.currencyTotals.USD.debtAmount;

        if (extraUZS > 0) {
          customer.balance.UZS += extraUZS;
          customer.payment_history.push({
            currency: "UZS",
            amount: extraUZS,
            direction: "PAYMENT",
            note: `Sale ${sale.invoiceNo} qty kamaytirildi`,
          });
        }

        if (extraUSD > 0) {
          customer.balance.USD += extraUSD;
          customer.payment_history.push({
            currency: "USD",
            amount: extraUSD,
            direction: "PAYMENT",
            note: `Sale ${sale.invoiceNo} qty kamaytirildi`,
          });
        }

        await customer.save({ session });
      }
    }

    /* =====================
       SALE STATUS
    ===================== */
    if (sale.items.length === 0) {
      sale.returnStatus = "FULL_RETURN";
      sale.isHidden = true;
    } else {
      sale.returnStatus = "PARTIAL_RETURN";
      sale.isHidden = false;
    }

    await sale.save({ session });
    await session.commitTransaction();

    return res.json({
      ok: true,
      message:
        qty === 0
          ? "Sale item butunlay olib tashlandi"
          : "Sale item qty muvaffaqiyatli o‘zgartirildi",
      newQty: qty,
      delta,
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};

// DELETE SALE (FULL ROLLBACK)
exports.deleteSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new Error("Sale ID noto‘g‘ri");
    }

    const sale = await Sale.findById(id).session(session);
    if (!sale) throw new Error("Sale topilmadi");

    if (sale.status === "DELETED") {
      throw new Error("Sale allaqachon o‘chirilgan");
    }

    /* =====================
       1️⃣ PRODUCT STOCK QAYTARISH
    ===================== */
    for (const it of sale.items) {
      const product = await Product.findById(it.productId).session(session);
      if (!product) {
        throw new Error("Product topilmadi");
      }

      product.qty += it.qty;
      await product.save({ session });
    }

    /* =====================
       2️⃣ CUSTOMER BALANCE ROLLBACK
    ===================== */
   if (sale.customerId && sale.currencyTotals) {
     const customer = await Customer.findById(sale.customerId).session(session);

     if (customer) {
       for (const cur of ["UZS", "USD"]) {
         const debt = Number(sale.currencyTotals[cur]?.debtAmount || 0);
         const paid = Number(sale.currencyTotals[cur]?.paidAmount || 0);

         // ❌ QARZNI BEKOR QILAMIZ (agar bo‘lsa)
         if (debt > 0) {
           customer.balance[cur] -= debt;
         }

         // ✅ TO‘LANGAN PUL → PREPAID BO‘LIB QOLADI
         if (paid > 0) {
           customer.balance[cur] -= paid; // bu minus bo‘lib qoladi (prepaid)
         }

         // tarixga yozamiz
      }

       await customer.save({ session });
     }
   }


    /* =====================
       3️⃣ SALE MARK AS DELETED
    ===================== */
    sale.status = "DELETED";
    sale.deletedAt = new Date();
    sale.deleteReason = req.body?.reason || "Xato kiritilgan sale o‘chirildi";

    await sale.save({ session });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Sale to‘liq rollback qilinib o‘chirildi",
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};
