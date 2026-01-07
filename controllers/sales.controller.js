const mongoose = require("mongoose");

const Sale = require("../modules/sales/Sale");
const Product = require("../modules/products/Product");
const Warehouse = require("../modules/Warehouse/Warehouse");
const Customer = require("../modules/Customer/Customer");

// Counter (invoiceNo uchun)
const Counter =
  mongoose.models.Counter ||
  mongoose.model(
    "Counter",
    new mongoose.Schema(
      {
        key: { type: String, required: true, unique: true },
        seq: { type: Number, default: 0 },
      },
      { timestamps: true }
    )
  );

/**
 * Utils
 */
function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function escapeRegex(text = "") {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizePhone(phone) {
  if (!phone) return undefined;
  return String(phone).replace(/\s+/g, "").trim();
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeNumber(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}


exports.createSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const soldBy = req.user?._id || req.user?.id;
    if (!soldBy) throw new Error("Auth required");

    const {
      items,
      customerId,
      customer,
      payments = [],
      discount = 0,
      note,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items bo'sh bo'lishi mumkin emas");
    }

    /* =========================
       0. CUSTOMER ANIQLASH / YARATISH
    ========================= */
    let finalCustomerId = null;

    if (mongoose.isValidObjectId(customerId)) {
      finalCustomerId = customerId;
    }

    if (!finalCustomerId && customer?.name) {
      const [newCustomer] = await Customer.create(
        [
          {
            name: customer.name,
            phone: normalizePhone(customer.phone),
            address: customer.address || "",
            note: customer.note || "",
            balance: { UZS: 0, USD: 0 },
            payment_history: [],
          },
        ],
        { session }
      );

      finalCustomerId = newCustomer._id;
    }

    /* =========================
       1. PRODUCTLARNI OLAMIZ
    ========================= */
    const productIds = items.map((i) => i.productId);

    const products = await Product.find({
      _id: { $in: productIds },
    })
      .select(
        "_id name model color category unit images qty buy_price warehouse_currency"
      )
      .session(session);

    const pMap = new Map(products.map((p) => [String(p._id), p]));

    /* =========================
       2. STOCK TEKSHIRISH
    ========================= */
    for (const it of items) {
      const p = pMap.get(String(it.productId));
      if (!p) throw new Error("Product topilmadi");

      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("qty noto'g'ri");
      }

      if (p.qty < qty) {
        throw new Error(`Stock yetarli emas: ${p.name}`);
      }
    }

    /* =========================
       3. STOCK KAMAYTIRISH
    ========================= */
    for (const it of items) {
      await Product.updateOne(
        { _id: it.productId, qty: { $gte: it.qty } },
        { $inc: { qty: -it.qty } },
        { session }
      );
    }

    /* =========================
       4. WAREHOUSE MAP
    ========================= */
    const currencies = [...new Set(products.map((p) => p.warehouse_currency))];

    const warehouses = await Warehouse.find({
      currency: { $in: currencies },
    })
      .select("_id currency")
      .session(session);

    const wMap = new Map(warehouses.map((w) => [w.currency, w._id]));

    /* =========================
       5. SALE ITEMS
    ========================= */
    const saleItems = items.map((it) => {
      const p = pMap.get(String(it.productId));
      const currency = p.warehouse_currency;
      const warehouseId = wMap.get(currency);

      if (!warehouseId) {
        throw new Error(`Warehouse topilmadi: ${currency}`);
      }

      const qty = Number(it.qty);
      const sellPrice = Number(it.sell_price);

      if (!Number.isFinite(sellPrice) || sellPrice < 0) {
        throw new Error("sell_price noto'g'ri");
      }

      return {
        productId: p._id,
        productSnapshot: {
          name: p.name,
          model: p.model || null,
          color: p.color || null,
          category: p.category || null,
          unit: p.unit,
          images: p.images || [],
        },
        warehouseId,
        currency,
        qty,
        sell_price: sellPrice,
        buy_price: Number(p.buy_price),
        subtotal: +(qty * sellPrice).toFixed(2),
      };
    });

    /* =========================
       6. CURRENCY TOTALS (✅ FIXED)
    ========================= */
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

    // 1️⃣ SUBTOTAL
    for (const it of saleItems) {
      currencyTotals[it.currency].subtotal += it.subtotal;
    }

    // 2️⃣ DISCOUNT (proportional)
    const totalAll = currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal;
    const disc = Math.max(0, safeNumber(discount));

    if (totalAll > 0 && disc > 0) {
      const uzsShare = currencyTotals.UZS.subtotal / totalAll;
      const usdShare = currencyTotals.USD.subtotal / totalAll;
      currencyTotals.UZS.discount = +(disc * uzsShare).toFixed(2);
      currencyTotals.USD.discount = +(disc * usdShare).toFixed(2);
    }

    // 3️⃣ GRAND TOTAL
    currencyTotals.UZS.grandTotal = Math.max(
      0,
      +(currencyTotals.UZS.subtotal - currencyTotals.UZS.discount).toFixed(2)
    );
    currencyTotals.USD.grandTotal = Math.max(
      0,
      +(currencyTotals.USD.subtotal - currencyTotals.USD.discount).toFixed(2)
    );

    // 4️⃣ PAID AMOUNT
    for (const p of payments) {
      if (!["UZS", "USD"].includes(p.currency)) {
        throw new Error("Payment currency noto'g'ri");
      }
      currencyTotals[p.currency].paidAmount += Math.max(
        0,
        safeNumber(p.amount)
      );
    }

    currencyTotals.UZS.paidAmount = +currencyTotals.UZS.paidAmount.toFixed(2);
    currencyTotals.USD.paidAmount = +currencyTotals.USD.paidAmount.toFixed(2);

    // 5️⃣ DEBT AMOUNT
    currencyTotals.UZS.debtAmount = Math.max(
      0,
      +(currencyTotals.UZS.grandTotal - currencyTotals.UZS.paidAmount).toFixed(
        2
      )
    );
    currencyTotals.USD.debtAmount = Math.max(
      0,
      +(currencyTotals.USD.grandTotal - currencyTotals.USD.paidAmount).toFixed(
        2
      )
    );

    const invoiceNo = `S-${Date.now()}`;

    /* =========================
       7. SALE CREATE
    ========================= */
    const [sale] = await Sale.create(
      [
        {
          invoiceNo,
          soldBy,
          customerId: finalCustomerId || undefined,
          items: saleItems,
          totals: {
            subtotal: currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal,
            discount: disc,
            grandTotal:
              currencyTotals.UZS.grandTotal + currencyTotals.USD.grandTotal,
          },
          currencyTotals,
          payments,
          note,
          status: "COMPLETED",
        },
      ],
      { session }
    );

    /* =========================
       8. CUSTOMER BALANCE
    ========================= */
    if (finalCustomerId) {
      const customerDoc = await Customer.findById(finalCustomerId).session(
        session
      );
      if (!customerDoc) throw new Error("Customer topilmadi");

      if (currencyTotals.UZS.debtAmount > 0) {
        customerDoc.balance.UZS += currencyTotals.UZS.debtAmount;
        customerDoc.payment_history.push({
          currency: "UZS",
          amount: currencyTotals.UZS.debtAmount,
          direction: "DEBT",
          note: `Sale ${invoiceNo}`,
        });
      }

      if (currencyTotals.USD.debtAmount > 0) {
        customerDoc.balance.USD += currencyTotals.USD.debtAmount;
        customerDoc.payment_history.push({
          currency: "USD",
          amount: currencyTotals.USD.debtAmount,
          direction: "DEBT",
          note: `Sale ${invoiceNo}`,
        });
      }

      await customerDoc.save({ session });
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

exports.getSales = async (req, res) => {
  try {
    /* =====================
       FILTER
    ===================== */
    const filter = {};

    if (req.query.status) {
      filter.status = String(req.query.status).toUpperCase();
    }

    if (
      req.query.customerId &&
      mongoose.isValidObjectId(req.query.customerId)
    ) {
      filter.customerId = req.query.customerId;
    }

    if (
      req.query.warehouseId &&
      mongoose.isValidObjectId(req.query.warehouseId)
    ) {
      filter["items.warehouseId"] = req.query.warehouseId;
    }

    /* =====================
       QUERY
    ===================== */
    const rows = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .populate("customerId", "name phone address note")
      .populate("soldBy", "name phone login")
      .populate({
        path: "items.warehouseId",
        select: "name currency",
      })
      .lean();

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows.map((sale) => ({
      _id: sale._id,
      invoiceNo: sale.invoiceNo,
      status: sale.status,
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

      items: (sale.items || []).map((it) => ({
        product_id: it.productId,

        warehouse: it.warehouseId
          ? {
              _id: it.warehouseId._id,
              name: it.warehouseId.name,
              currency: it.warehouseId.currency,
            }
          : null,

        product_snapshot: {
          name: it.productSnapshot?.name,
          model: it.productSnapshot?.model,
          color: it.productSnapshot?.color,
          category: it.productSnapshot?.category,
          unit: it.productSnapshot?.unit,
          images: it.productSnapshot?.images || [],
        },

        qty: Number(it.qty),
        sell_price_snapshot: Number(it.sell_price),
        buy_price_snapshot: Number(it.buy_price),
        subtotal: Number(it.subtotal),
        currency_snapshot: it.currency,
      })),

      totals: sale.totals || null,
      currencyTotals: sale.currencyTotals || null,
      payments: sale.payments || [],
      note: sale.note || "",
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
      message: "Sales olishda xato",
      error: err.message,
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
      .lean();
    if (!sale) return res.status(404).json({ message: "Sale topilmadi" });

    return res.json({ ok: true, item: sale });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Sale olishda xato", error: err.message });
  }
};

exports.cancelSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new Error("Sale topilmadi");

    if (sale.status === "CANCELED") throw new Error("Sale allaqachon bekor");

    // STOCK QAYTARISH
    for (const it of sale.items) {
      await Product.updateOne(
        { _id: it.productId },
        { $inc: { qty: it.qty } },
        { session }
      );
    }

    // CUSTOMER QARZNI KAMAYTIRISH
    /* =====================
   CUSTOMER BALANCE FIX (✅ TO‘G‘RI)
===================== */
    if (sale.customerId) {
      const customer = await Customer.findById(sale.customerId).session(
        session
      );

      if (customer) {
        const newDebtUZS = sale.currencyTotals.UZS.debtAmount || 0;
        const newDebtUSD = sale.currencyTotals.USD.debtAmount || 0;

        const deltaUZS = newDebtUZS - oldDebtUZS;
        const deltaUSD = newDebtUSD - oldDebtUSD;

        // 🔹 UZS
        if (deltaUZS !== 0) {
          customer.balance.UZS += deltaUZS;

          customer.payment_history.push({
            currency: "UZS",
            amount: Math.abs(deltaUZS),
            direction: deltaUZS > 0 ? "DEBT" : "PAYMENT",
            note: `Sale ${sale.invoiceNo} tahrirlandi`,
          });
        }

        // 🔹 USD
        if (deltaUSD !== 0) {
          customer.balance.USD += deltaUSD;

          customer.payment_history.push({
            currency: "USD",
            amount: Math.abs(deltaUSD),
            direction: deltaUSD > 0 ? "DEBT" : "PAYMENT",
            note: `Sale ${sale.invoiceNo} tahrirlandi`,
          });
        }

        await customer.save({ session });
      }
    }

    sale.status = "CANCELED";
    sale.canceledAt = new Date();
    sale.cancelReason = req.body?.reason;

    await sale.save({ session });

    await session.commitTransaction();
    return res.json({ ok: true, message: "Sale bekor qilindi" });
  } catch (e) {
    await session.abortTransaction();
    return res.status(400).json({ ok: false, message: e.message });
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
        req.query.warehouseId
      );
    }

    /* =====================
       QUERY
    ===================== */
    const rows = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .select(
        "invoiceNo createdAt status customerSnapshot customerId items totals currencyTotals"
      )
      .lean();

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows
      .map((s) => {
        const matchedItems = (s.items || []).filter(
          (it) =>
            rx.test(String(it.productSnapshot?.name || "")) &&
            safeNum(it.qty) > 0 &&
            (!req.query.warehouseId ||
              String(it.warehouseId) === String(req.query.warehouseId))
        );

        if (matchedItems.length === 0) return null;

        return {
          _id: s._id,
          invoiceNo: s.invoiceNo,
          createdAt: s.createdAt,
          status: s.status,
          customer: s.customerId || s.customerSnapshot,
          totals: s.totals,
          currencyTotals: s.currencyTotals,
          matchedItems,
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
      (it) => String(it.productId) === String(productId)
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
      uzsSubtotal - (sale.currencyTotals.UZS.discount || 0)
    );
    sale.currencyTotals.USD.grandTotal = Math.max(
      0,
      usdSubtotal - (sale.currencyTotals.USD.discount || 0)
    );

    sale.currencyTotals.UZS.debtAmount = Math.max(
      0,
      sale.currencyTotals.UZS.grandTotal -
        (sale.currencyTotals.UZS.paidAmount || 0)
    );
    sale.currencyTotals.USD.debtAmount = Math.max(
      0,
      sale.currencyTotals.USD.grandTotal -
        (sale.currencyTotals.USD.paidAmount || 0)
    );

    sale.totals.subtotal = uzsSubtotal + usdSubtotal;
    sale.totals.grandTotal =
      sale.currencyTotals.UZS.grandTotal + sale.currencyTotals.USD.grandTotal;

    /* =====================
       CUSTOMER BALANCE FIX
    ===================== */
    if (sale.customerId) {
      const customer = await Customer.findById(sale.customerId).session(
        session
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

