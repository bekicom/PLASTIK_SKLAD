const mongoose = require("mongoose");
const Supplier = require("../modules/suppliers/Supplier");
const Product = require("../modules/products/Product");
const Purchase = require("../modules/purchases/Purchase");
const InventoryRevaluation = require("../modules/analytics/InventoryRevaluation");

function parseMaybeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getCurrentUserId(req) {
  return req.user?._id || req.user?.id || null;
}

function buildProductMatchFilter({ supplierId, name, model, color, unit, currency }) {
  return {
    supplier_id: supplierId,
    name,
    model,
    color,
    warehouse_currency: currency,
    unit,
    isActive: true,
  };
}

async function findLatestMatchingProduct(session, supplierId, item) {
  return Product.findOne(
    buildProductMatchFilter({
      supplierId,
      name: item.name,
      model: item.model,
      color: item.color,
      unit: item.unit,
      currency: item.currency,
    }),
  )
    .sort({ createdAt: -1 })
    .session(session);
}

async function upsertPurchaseProduct({
  session,
  supplierId,
  item,
  qty,
  buyPrice,
  sellPrice,
  category,
  currentUserId = null,
}) {
  const existing = await findLatestMatchingProduct(session, supplierId, item);

  if (existing) {
    const prevBuyPrice = Number(existing.buy_price || 0);
    const prevSellPrice = Number(existing.sell_price || 0);

    existing.qty = Number(existing.qty || 0) + qty;
    existing.buy_price = buyPrice;
    existing.sell_price = sellPrice;
    const nextCategory = String(category || "").trim();
    if (nextCategory) {
      existing.category = nextCategory;
    }

    existing.history = Array.isArray(existing.history) ? existing.history : [];
    existing.history.push({
      type: "MANUAL_UPDATE",
      date: new Date(),
      by: currentUserId || null,
      note: "Kirim narxi yangilandi",
      qtyDelta: qty,
      payload: {
        source: "PURCHASE",
        previous_buy_price: prevBuyPrice,
        previous_sell_price: prevSellPrice,
        next_buy_price: buyPrice,
        next_sell_price: sellPrice,
      },
    });

    await existing.save({ session });
    return existing;
  }

  const created = await Product.create(
    [
      {
        supplier_id: supplierId,
        name: item.name,
        model: item.model,
        color: item.color,
        category: String(category || "").trim(),
        unit: item.unit,
        warehouse_currency: item.currency,
        qty,
        buy_price: buyPrice,
        sell_price: sellPrice,
        images: [],
      },
    ],
    { session },
  );

  return created[0];
}

async function restorePurchaseStock(session, items) {
  for (const it of items || []) {
    if (!it?.product_id || !mongoose.isValidObjectId(it.product_id)) continue;
    const ok = await Product.updateOne(
      { _id: it.product_id },
      { $inc: { qty: -Number(it.qty || 0) } },
      { session },
    );

    if (ok.modifiedCount === 0) {
      throw new Error("Product topilmadi yoki stock qaytarilmadi");
    }
  }
}

async function reapplyExistingPurchaseItems(session, items) {
  for (const it of items || []) {
    if (!it?.product_id || !mongoose.isValidObjectId(it.product_id)) {
      throw new Error("Purchase item product_id noto‘g‘ri");
    }

    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Purchase item qty noto‘g‘ri");
    }

    const ok = await Product.updateOne(
      { _id: it.product_id, qty: { $gte: qty } },
      { $inc: { qty: qty } },
      { session },
    );

    if (ok.modifiedCount === 0) {
      throw new Error("Product topilmadi yoki qty yetarli emas");
    }
  }
}

async function buildPurchaseItemsFromInput(
  session,
  supplierId,
  items,
  currentUserId = null,
) {
  const totals = { UZS: 0, USD: 0 };
  const purchaseItems = [];
  const affectedProducts = [];
  const seen = new Set();

  for (const it of items) {
    const name = String(it.name || "").trim();
    const model = String(it.model || "").trim() || null;
    const color = String(it.color || "").trim();
    const category = String(it.category || "").trim();
    const unit = String(it.unit || "").trim();
    const currency = String(it.currency || "").trim();

    const qty = Number(it.qty);
    const buy_price = Number(it.buy_price);
    const sell_price = Number(it.sell_price || 0);

    if (
      !name ||
      !color ||
      !unit ||
      !["UZS", "USD"].includes(currency) ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !Number.isFinite(buy_price) ||
      buy_price < 0 ||
      !Number.isFinite(sell_price) ||
      sell_price < 0
    ) {
      throw new Error("Item ma’lumotlari noto‘g‘ri");
    }

    const rowTotal = qty * buy_price;
    totals[currency] += rowTotal;

    const key = [String(supplierId), name, model || "", color, currency, unit].join(
      "|",
    );

    if (seen.has(key)) {
      throw new Error("Bir xil purchase item takrorlanmasin");
    }
    seen.add(key);

    const product = await upsertPurchaseProduct({
      session,
      supplierId,
      item: { name, model, color, unit, currency },
      qty,
      buyPrice: buy_price,
      sellPrice: sell_price,
      category,
      currentUserId,
    });

    affectedProducts.push(product);

    purchaseItems.push({
      product_id: product._id,
      name,
      model,
      color,
      unit,
      qty,
      buy_price,
      sell_price,
      currency,
      row_total: rowTotal,
    });
  }

  return { totals, purchaseItems, affectedProducts };
}

async function buildRevaluationEntriesForItems({
  session,
  supplierId,
  rawItems = [],
  purchaseDate = new Date(),
  userId = null,
}) {
  const entries = [];

  for (const it of rawItems || []) {
    const name = String(it.name || "").trim();
    const model = String(it.model || "").trim() || null;
    const color = String(it.color || "").trim();
    const category = String(it.category || "").trim();
    const unit = String(it.unit || "").trim();
    const currency = String(it.currency || "").trim();
    const incomingBuy = Number(it.buy_price || 0);

    if (
      !name ||
      !color ||
      !unit ||
      !["UZS", "USD"].includes(currency) ||
      !Number.isFinite(incomingBuy) ||
      incomingBuy < 0
    ) {
      continue;
    }

    const similarProducts = await Product.find(
      {
        supplier_id: supplierId,
        name,
        model,
        color,
        unit,
        warehouse_currency: currency,
        isActive: true,
        qty: { $gt: 0 },
      },
      null,
      { session },
    ).lean();

    let existingQty = 0;
    let existingValue = 0;

    for (const p of similarProducts) {
      const pQty = Number(p.qty || 0);
      const pBuy = Number(p.buy_price || 0);
      if (pQty <= 0) continue;
      if (pBuy === incomingBuy) continue;

      existingQty += pQty;
      existingValue += pQty * pBuy;
    }

    if (existingQty <= 0) continue;

    const revaluedValue = existingQty * incomingBuy;
    const delta = Number((revaluedValue - existingValue).toFixed(2));
    if (delta === 0) continue;

    const oldAvg = Number((existingValue / existingQty).toFixed(6));

    entries.push({
      supplier_id: supplierId,
      date: purchaseDate,
      currency,
      product: {
        name,
        model: model || "",
        color,
        category,
        unit,
      },
      existing_qty: existingQty,
      incoming_buy_price: incomingBuy,
      old_avg_buy_price: oldAvg,
      delta_profit: delta,
      kind: delta > 0 ? "GAIN" : "LOSS",
      note:
        delta > 0
          ? "Kirim narxi oshgani sabab qayta baholash foydasi"
          : "Kirim narxi tushgani sabab qayta baholash ziyon",
      createdBy: userId || null,
    });
  }

  return entries;
}

exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { supplier_id, batch_no, items = [], purchase_date, note = "" } =
      req.body;

    if (!mongoose.isValidObjectId(supplier_id) || !batch_no) {
      throw new Error("supplier_id yoki batch_no noto‘g‘ri");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Kamida 1 ta mahsulot bo‘lishi shart");
    }

    const supplier = await Supplier.findById(supplier_id).session(session);
    if (!supplier) throw new Error("Supplier topilmadi");

    const parsedDate = purchase_date ? new Date(purchase_date) : new Date();

    const totals = { UZS: 0, USD: 0 };
    const purchaseItems = [];
    const affectedProducts = [];
    const pendingRevaluations = [];
    const currentUserId = getCurrentUserId(req);

    for (const it of items) {
      const name = String(it.name).trim();
      const model = String(it.model || "").trim() || null;
      const color = String(it.color).trim();
      const category = String(it.category || "").trim();
      const unit = String(it.unit).trim();
      const currency = String(it.currency).trim();

      const qty = Number(it.qty);
      const buy_price = Number(it.buy_price);
      const sell_price = Number(it.sell_price || 0);

      if (
        !name ||
        !color ||
        !unit ||
        !["UZS", "USD"].includes(currency) ||
        !Number.isFinite(qty) ||
        qty <= 0 ||
        !Number.isFinite(buy_price) ||
        buy_price < 0 ||
        !Number.isFinite(sell_price) ||
        sell_price < 0
      ) {
        throw new Error("Item ma’lumotlari noto‘g‘ri");
      }
 

      const revRows = await buildRevaluationEntriesForItems({
        session,
        supplierId: supplier_id,
        rawItems: [it],
        purchaseDate: parsedDate,
        userId: currentUserId,
      });
      pendingRevaluations.push(...revRows);

      const rowTotal = qty * buy_price;
      totals[currency] += rowTotal;

      /* =====================
         🔍 EXACT MATCH QIDIRAMIZ
      ===================== */
      const product = await upsertPurchaseProduct({
        session,
        supplierId: supplier_id,
        item: { name, model, color, unit, currency },
        qty,
        buyPrice: buy_price,
        sellPrice: sell_price,
        category,
        currentUserId,
      });

    affectedProducts.push(product);

      purchaseItems.push({
        product_id: product._id,
        name,
        model,
        color,
        unit,
        qty,
        buy_price,
        sell_price,
        currency,
        row_total: rowTotal,
      });
    }

    const paid = { UZS: 0, USD: 0 };
    const remaining = { UZS: totals.UZS, USD: totals.USD };
    const status = remaining.UZS || remaining.USD ? "DEBT" : "PAID";

    const [purchase] = await Purchase.create(
      [
        {
          supplier_id,
          batch_no: String(batch_no),
          purchase_date: parsedDate,
          totals,
          paid,
          remaining,
          status,
          note: String(note || "").trim(),
          items: purchaseItems,
        },
      ],
      { session },
    );

    supplier.balance.UZS += remaining.UZS;
    supplier.balance.USD += remaining.USD;
    await supplier.save({ session });

    if (pendingRevaluations.length > 0) {
      await InventoryRevaluation.insertMany(
        pendingRevaluations.map((x) => ({
          ...x,
          purchase_id: purchase._id,
        })),
        { session },
      );
    }

    await session.commitTransaction();

    res.status(201).json({
      ok: true,
      message: "Kirim muvaffaqiyatli saqlandi",
      purchase,
      products: affectedProducts,
      inventoryRevaluationCount: pendingRevaluations.length,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ ok: false, message: err.message });
  } finally {
    session.endSession();
  }
};

exports.editPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new Error("purchase id noto‘g‘ri");
    }

    const purchase = await Purchase.findById(id).session(session);
    if (!purchase) throw new Error("Purchase topilmadi");

    const oldSupplierId = String(purchase.supplier_id);
    const oldItems = (purchase.items || []).map((it) => ({ ...it.toObject() }));
    const oldRemaining = {
      UZS: Number(purchase.remaining?.UZS || 0),
      USD: Number(purchase.remaining?.USD || 0),
    };
    const oldPaid = {
      UZS: Number(purchase.paid?.UZS || 0),
      USD: Number(purchase.paid?.USD || 0),
    };
    const currentUserId = getCurrentUserId(req);

    const hasSupplierPatch = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "supplier_id",
    );
    const hasItemsPatch = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "items",
    );
    const hasDatePatch = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "purchase_date",
    );
    const hasBatchPatch = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "batch_no",
    );

    const nextPurchaseDate = hasDatePatch
      ? parseMaybeDate(req.body.purchase_date)
      : purchase.purchase_date;
    if (hasDatePatch && !nextPurchaseDate) {
      throw new Error("purchase_date noto‘g‘ri");
    }

    const nextBatchNo = hasBatchPatch
      ? String(req.body.batch_no || "").trim()
      : purchase.batch_no;
    if (hasBatchPatch && !nextBatchNo) {
      throw new Error("batch_no bo‘sh bo‘lishi mumkin emas");
    }

    const nextSupplierId = hasSupplierPatch
      ? req.body.supplier_id
      : purchase.supplier_id;
    if (!mongoose.isValidObjectId(nextSupplierId)) {
      throw new Error("supplier_id noto‘g‘ri");
    }

    const nextSupplier = await Supplier.findById(nextSupplierId).session(session);
    if (!nextSupplier) throw new Error("Supplier topilmadi");

    const nextNote =
      Object.prototype.hasOwnProperty.call(req.body || {}, "note")
        ? String(req.body.note || "")
        : purchase.note || "";

    // eski qayta-baholash yozuvlari qayta hisoblanadi
    await InventoryRevaluation.deleteMany({ purchase_id: purchase._id }).session(
      session,
    );

    /* =========================
       1. OLD ROLLBACK
    ========================= */
    const oldSupplier = await Supplier.findById(oldSupplierId).session(session);
    if (oldSupplier) {
      oldSupplier.balance.UZS =
        Number(oldSupplier.balance?.UZS || 0) - oldRemaining.UZS;
      oldSupplier.balance.USD =
        Number(oldSupplier.balance?.USD || 0) - oldRemaining.USD;
      await oldSupplier.save({ session });
    }

    await restorePurchaseStock(session, oldItems);

    /* =========================
       2. NEW ITEMS
    ========================= */
    let nextItems = oldItems;
    let affectedProducts = [];
    let nextTotals = {
      UZS: Number(purchase.totals?.UZS || 0),
      USD: Number(purchase.totals?.USD || 0),
    };

    if (hasItemsPatch) {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        throw new Error("items bo‘sh bo‘lishi mumkin emas");
      }

      var pendingRevaluations = await buildRevaluationEntriesForItems({
        session,
        supplierId: nextSupplier._id,
        rawItems: req.body.items,
        purchaseDate: nextPurchaseDate,
        userId: currentUserId,
      });

      const built = await buildPurchaseItemsFromInput(
        session,
        nextSupplier._id,
        req.body.items,
        currentUserId,
      );
      nextItems = built.purchaseItems;
      nextTotals = built.totals;
      affectedProducts = built.affectedProducts;
    } else {
      const oldRawItems = oldItems.map((it) => ({
        name: it.name,
        model: it.model,
        color: it.color,
        category: "",
        unit: it.unit,
        currency: it.currency,
        buy_price: it.buy_price,
      }));

      var pendingRevaluations = await buildRevaluationEntriesForItems({
        session,
        supplierId: nextSupplier._id,
        rawItems: oldRawItems,
        purchaseDate: nextPurchaseDate,
        userId: currentUserId,
      });

      await reapplyExistingPurchaseItems(session, oldItems);
    }

    /* =========================
       3. FINANCIALS
    ========================= */
    const nextPaid = {
      UZS: oldPaid.UZS,
      USD: oldPaid.USD,
    };
    const nextRemaining = {
      UZS: Math.max(0, nextTotals.UZS - nextPaid.UZS),
      USD: Math.max(0, nextTotals.USD - nextPaid.USD),
    };
    const nextStatus =
      nextRemaining.UZS > 0 || nextRemaining.USD > 0
        ? nextPaid.UZS > 0 || nextPaid.USD > 0
          ? "PARTIAL"
          : "DEBT"
        : "PAID";

    /* =========================
       4. NEW SUPPLIER BALANCE
    ========================= */
    nextSupplier.balance.UZS =
      Number(nextSupplier.balance?.UZS || 0) + nextRemaining.UZS;
    nextSupplier.balance.USD =
      Number(nextSupplier.balance?.USD || 0) + nextRemaining.USD;
    await nextSupplier.save({ session });

    /* =========================
       5. SAVE PURCHASE
    ========================= */
    purchase.supplier_id = nextSupplier._id;
    purchase.purchase_date = nextPurchaseDate;
    purchase.batch_no = nextBatchNo;
    purchase.totals = nextTotals;
    purchase.paid = nextPaid;
    purchase.remaining = nextRemaining;
    purchase.status = nextStatus;
    purchase.items = nextItems;
    purchase.editedAt = new Date();
    purchase.editedBy = getCurrentUserId(req);
    purchase.editReason = String(
      req.body.editReason || req.body.reason || "",
    ).slice(0, 500);
    purchase.revision = Number(purchase.revision || 0) + 1;
    purchase.note = nextNote;

    await purchase.save({ session });

    if (pendingRevaluations.length > 0) {
      await InventoryRevaluation.insertMany(
        pendingRevaluations.map((x) => ({
          ...x,
          purchase_id: purchase._id,
        })),
        { session },
      );
    }

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Purchase yangilandi",
      purchase,
      affectedProducts,
      inventoryRevaluationCount: pendingRevaluations.length,
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

exports.getPurchases = async (req, res) => {
  try {
    const { from, to, supplier_id, status } = req.query;

    const filter = {};

    if (supplier_id && mongoose.isValidObjectId(supplier_id)) {
      filter.supplier_id = supplier_id;
    }

    if (status) {
      filter.status = status;
    }

    // 🔥 SANA FILTER (purchase_date BO'YICHA)
    // FAQAT 2026-01-27 DAN BOSHLAB
    const minDate = new Date(Date.UTC(2023, 0, 27, 0, 0, 0));

    if (from || to) {
      filter.purchase_date = {};

      // Agar 'from' berilgan bo'lsa, uni minDate bilan solishtiramiz
      if (from) {
        const fromDate = new Date(from);
        // Kattaroq sanani olamiz (from va minDate orasidan)
        filter.purchase_date.$gte = fromDate > minDate ? fromDate : minDate;
      } else {
        // Agar 'from' berilmagan bo'lsa, faqat minDate dan boshlaymiz
        filter.purchase_date.$gte = minDate;
      }

      if (to) {
        filter.purchase_date.$lte = new Date(to);
      }
    } else {
      // Agar hech qanday sana berilmagan bo'lsa, faqat minDate dan keyingilarni olamiz
      filter.purchase_date = { $gte: minDate };
    }

    const purchases = await Purchase.find(filter)
      .populate("supplier_id", "name phone")
      .sort({ purchase_date: -1 })
      .lean();

    return res.json({
      ok: true,
      count: purchases.length,
      data: purchases,
    });
  } catch (err) {
    console.error("getPurchases error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  }
};

exports.addProductImage = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "product id noto‘g‘ri" });
  }

  const incomingFiles = Array.isArray(req.files)
    ? req.files
    : req.file
      ? [req.file]
      : [];

  if (incomingFiles.length === 0) {
    return res.status(400).json({ message: "Kamida 1 ta rasm yuboring" });
  }

  if (incomingFiles.length > 5) {
    return res.status(400).json({ message: "Ko‘pi bilan 5 ta rasm yuboring" });
  }

  const imageUrls = incomingFiles.map((f) => `/uploads/products/${f.filename}`);

  const product = await Product.findByIdAndUpdate(
    id,
    { $addToSet: { images: { $each: imageUrls } } }, // dublikat bo‘lmaydi
    { new: true },
  );

  if (!product) {
    return res.status(404).json({ message: "Product topilmadi" });
  }

  return res.json({
    ok: true,
    message: `${imageUrls.length} ta rasm qo‘shildi`,
    added: imageUrls,
    product,
  });
};

// controllers/purchase.controller.js

exports.deletePurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new Error("purchase id noto‘g‘ri");
    }

    const purchase = await Purchase.findById(id).session(session);
    if (!purchase) throw new Error("Purchase topilmadi");

    // ❗ Agar to‘lov qilingan bo‘lsa — o‘chirish mumkin emas
    if ((purchase.paid?.UZS || 0) > 0 || (purchase.paid?.USD || 0) > 0) {
      throw new Error(
        "Bu batch bo‘yicha to‘lov qilingan. O‘chirish mumkin emas",
      );
    }

    /* =====================
       SUPPLIER BALANCE ROLLBACK
       (faqat qarzni qaytarish)
    ===================== */
    const supplier = await Supplier.findById(purchase.supplier_id).session(
      session,
    );
    if (!supplier) throw new Error("Supplier topilmadi");

    supplier.balance.UZS -= purchase.remaining?.UZS || 0;
    supplier.balance.USD -= purchase.remaining?.USD || 0;

    // ❗ MUHIM:
    // payment_history YOZILMAYDI
    // chunki bu pul harakati emas

    await supplier.save({ session });

    /* =====================
       STOCK ROLLBACK
    ===================== */
    for (const it of purchase.items) {
      const product = await Product.findById(it.product_id).session(session);
      if (!product) throw new Error("Product topilmadi");

      product.qty -= it.qty;
      if (product.qty < 0) product.qty = 0;

      await product.save({ session });
    }

    /* =====================
       INVENTORY REVALUATION DELETE
    ===================== */
    await InventoryRevaluation.deleteMany({ purchase_id: purchase._id }).session(
      session,
    );

    /* =====================
       DELETE PURCHASE
    ===================== */
    await Purchase.deleteOne({ _id: id }).session(session);

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Kirim (batch) muvaffaqiyatli o‘chirildi",
      supplier_balance: supplier.balance,
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
