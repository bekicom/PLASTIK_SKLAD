// controllers/sale.controller.js

const mongoose = require("mongoose");

const Sale = require("../modules/sales/Sale");
const Product = require("../modules/products/Product");
const Warehouse = require("../modules/Warehouse/Warehouse");
const Customer = require("../modules/Customer/Customer");

/* =====================
   HELPERS
===================== */
function safeNumber(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  return String(phone).replace(/\s+/g, "").trim();
}

/* =====================
   CREATE SALE (CUSTOMER)
===================== */
exports.createSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const soldBy = req.user?._id || req.user?.id;
    if (!soldBy) throw new Error("Auth required");

    const {
      items = [],
      customerId,
      customer,
      payments = [],
      discount = 0,
      note,
      saleDate, // 🔥 MUHIM
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items bo‘sh bo‘lishi mumkin emas");
    }

    /* =====================
       0️⃣ SALE DATE
    ===================== */
    let finalSaleDate = new Date();

    if (saleDate) {
      const d = new Date(saleDate);
      if (Number.isNaN(d.getTime())) {
        throw new Error("saleDate noto‘g‘ri formatda");
      }
      finalSaleDate = d;
    }

    /* =====================
       1️⃣ CUSTOMER ANIQLASH
    ===================== */
    let finalCustomerId = null;

    if (mongoose.isValidObjectId(customerId)) {
      finalCustomerId = customerId;
    }

    if (!finalCustomerId && customer?.name) {
      const [c] = await Customer.create(
        [
          {
            name: customer.name.trim(),
            phone: normalizePhone(customer.phone),
            address: customer.address || "",
            note: customer.note || "",
            balance: { UZS: 0, USD: 0 },
            payment_history: [],
          },
        ],
        { session }
      );
      finalCustomerId = c._id;
    }

    /* =====================
       2️⃣ PRODUCTLARNI OLISH
    ===================== */
    const productIds = items.map((i) => i.productId);

    const products = await Product.find({
      _id: { $in: productIds },
    })
      .select(
        "_id name model color category unit images qty buy_price warehouse_currency"
      )
      .session(session);

    const pMap = new Map(products.map((p) => [String(p._id), p]));

    /* =====================
       3️⃣ STOCK TEKSHIRISH
    ===================== */
    for (const it of items) {
      const p = pMap.get(String(it.productId));
      if (!p) throw new Error("Product topilmadi");

      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("qty noto‘g‘ri");
      }

      if (p.qty < qty) {
        throw new Error(`Stock yetarli emas: ${p.name}`);
      }
    }

    /* =====================
       4️⃣ STOCK KAMAYTIRISH
    ===================== */
    for (const it of items) {
      await Product.updateOne(
        { _id: it.productId, qty: { $gte: it.qty } },
        { $inc: { qty: -it.qty } },
        { session }
      );
    }

    /* =====================
       5️⃣ WAREHOUSE MAP
    ===================== */
    const currencies = [...new Set(products.map((p) => p.warehouse_currency))];

    const warehouses = await Warehouse.find({
      currency: { $in: currencies },
    })
      .select("_id currency")
      .session(session);

    const wMap = new Map(warehouses.map((w) => [w.currency, w._id]));

    /* =====================
       6️⃣ SALE ITEMS
    ===================== */
    const saleItems = items.map((it) => {
      const p = pMap.get(String(it.productId));
      const qty = Number(it.qty);
      const sellPrice = Number(it.sell_price);

      if (!Number.isFinite(sellPrice) || sellPrice < 0) {
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

    /* =====================
       7️⃣ CURRENCY TOTALS
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

    const totalAll = currencyTotals.UZS.subtotal + currencyTotals.USD.subtotal;
    const disc = Math.max(0, safeNumber(discount));

    if (totalAll > 0 && disc > 0) {
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
          2
        )
      );
    }

    for (const p of payments) {
      if (!["UZS", "USD"].includes(p.currency)) {
        throw new Error("Payment currency noto‘g‘ri");
      }
      currencyTotals[p.currency].paidAmount += Math.max(
        0,
        safeNumber(p.amount)
      );
    }

    for (const cur of ["UZS", "USD"]) {
      currencyTotals[cur].paidAmount =
        +currencyTotals[cur].paidAmount.toFixed(2);
      currencyTotals[cur].debtAmount = Math.max(
        0,
        +(
          currencyTotals[cur].grandTotal - currencyTotals[cur].paidAmount
        ).toFixed(2)
      );
    }

    /* =====================
       8️⃣ SALE CREATE
    ===================== */
    const invoiceNo = `S-${Date.now()}`;

    const [sale] = await Sale.create(
      [
        {
          invoiceNo,
          saleDate: finalSaleDate, // 🔥 ASOSIY QO‘SHILGAN QISM
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

    /* =====================
       9️⃣ CUSTOMER BALANCE
    ===================== */
    if (finalCustomerId) {
      const customerDoc = await Customer.findById(finalCustomerId).session(
        session
      );

      if (customerDoc) {
        for (const cur of ["UZS", "USD"]) {
          const debt = sale.currencyTotals[cur]?.debtAmount || 0;
          if (debt > 0) {
            customerDoc.balance[cur] =
              Number(customerDoc.balance?.[cur] || 0) + debt;

            customerDoc.payment_history.push({
              currency: cur,
              amount: debt,
              direction: "DEBT",
              note: `Sale ${sale.invoiceNo}`,
              date: finalSaleDate, // 🔥 MUHIM
            });
          }
        }
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


exports.getSales = async (req, res) => {
  try {
    /* =====================
       FILTER
    ===================== */
    const filter = {};

    // STATUS
    if (req.query.status) {
      filter.status = String(req.query.status).toUpperCase();
    }

    // CUSTOMER
    if (
      req.query.customerId &&
      mongoose.isValidObjectId(req.query.customerId)
    ) {
      filter.customerId = req.query.customerId;
    }

    // WAREHOUSE
    if (
      req.query.warehouseId &&
      mongoose.isValidObjectId(req.query.warehouseId)
    ) {
      filter["items.warehouseId"] = req.query.warehouseId;
    }

    // 📅 DATE FILTER (createdAt)
    if (req.query.from || req.query.to) {
      filter.createdAt = {};

      if (req.query.from) {
        filter.createdAt.$gte = new Date(req.query.from);
      }

      if (req.query.to) {
        filter.createdAt.$lte = new Date(req.query.to);
      }
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
          session
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
