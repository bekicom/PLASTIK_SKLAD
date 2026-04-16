const mongoose = require("mongoose");
const Product = require("../modules/products/Product");
const Purchase = require("../modules/purchases/Purchase");
const Sale = require("../modules/sales/Sale");
const SaleReturn = require("../modules/returns/SaleReturn");
const ProductWriteOff = require("../modules/writeOff/ProductWriteOff");
require("../modules/suppliers/Supplier");
require("../modules/Customer/Customer");
const fs = require("fs");
const path = require("path");

const UNITS = ["DONA", "PACHKA", "KG"];
const CUR = ["UZS", "USD"];

/* =======================
   HELPERS
======================= */
function toStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

function normalizeText(v) {
  return toStr(v).trim();
}

function safeNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function parseMaybeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function syncArchiveState(product) {
  const activeQty = Number(product.qty || 0);
  const archiveQty = Number(product.archive_qty || 0);

  if (archiveQty > 0 && activeQty > 0) {
    product.archive_status = "PARTIAL";
  } else if (archiveQty > 0 && activeQty <= 0) {
    product.archive_status = "ARCHIVED";
  } else {
    product.archive_status = "ACTIVE";
  }
}

function pickObjectId(value) {
  if (!value) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function eventDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normCmp(v) {
  return String(v || "").trim().toLowerCase();
}

function buildProductMergeKey(product) {
  return [
    String(product?.supplier_id?._id || product?.supplier_id || ""),
    normCmp(product?.name),
    normCmp(product?.model),
    normCmp(product?.color),
    normCmp(product?.unit),
    normCmp(product?.warehouse_currency),
  ].join("|");
}

function isSameMergeKey(a, b) {
  return buildProductMergeKey(a) === buildProductMergeKey(b);
}

function mergeProductRows(rows = []) {
  const groups = new Map();

  for (const row of rows || []) {
    const key = buildProductMergeKey(row);
    const nextQty = Number(row?.qty || 0);
    const nextArchiveQty = Number(row?.archive_qty || 0);
    const prev = groups.get(key);

    if (!prev) {
      groups.set(key, {
        ...row,
        qty: nextQty,
        archive_qty: nextArchiveQty,
        _rows: [row],
      });
      continue;
    }

    prev.qty = Number(prev.qty || 0) + nextQty;
    prev.archive_qty = Number(prev.archive_qty || 0) + nextArchiveQty;
    prev._rows.push(row);

    const prevUpdated = new Date(prev.updatedAt || prev.createdAt || 0).getTime();
    const nextUpdated = new Date(row.updatedAt || row.createdAt || 0).getTime();
    if (nextUpdated >= prevUpdated) {
      prev._id = row._id;
      prev.id = String(row._id);
      prev.name = row.name;
      prev.model = row.model;
      prev.color = row.color;
      prev.category = row.category;
      prev.unit = row.unit;
      prev.warehouse_currency = row.warehouse_currency;
      prev.buy_price = row.buy_price;
      prev.sell_price = row.sell_price;
      prev.updatedAt = row.updatedAt;
      prev.createdAt = row.createdAt;
      prev.supplier_id = row.supplier_id;
    }
  }

  return [...groups.values()].map((row) => {
    const merged = { ...row };
    delete merged._rows;
    merged.id = String(merged._id);
    merged._id = merged._id;
    return merged;
  });
}

function normalizeStoredImagePath(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  if (s.startsWith("/uploads/products/")) return s;

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.pathname.startsWith("/uploads/products/")) return u.pathname;
    } catch {
      return "";
    }
  }

  if (s.startsWith("uploads/products/")) return `/${s}`;
  if (s.startsWith("products/")) return `/uploads/${s}`;
  if (!s.includes("/") && !s.includes("\\")) return `/uploads/products/${s}`;

  return "";
}

function isSameProductSnapshot(snapshot, product) {
  if (!snapshot || !product) return false;
  return (
    normCmp(snapshot.name) === normCmp(product.name) &&
    normCmp(snapshot.model) === normCmp(product.model) &&
    normCmp(snapshot.color) === normCmp(product.color) &&
    normCmp(snapshot.category) === normCmp(product.category) &&
    normCmp(snapshot.unit) === normCmp(product.unit)
  );
}

function buildUniqueProductFilter(productLike, excludeId = null) {
  const filter = {
    supplier_id: productLike.supplier_id,
    name: normalizeText(productLike.name),
    model: normalizeText(productLike.model),
    color: normalizeText(productLike.color),
    warehouse_currency: String(productLike.warehouse_currency || "").trim(),
    buy_price: safeNumber(productLike.buy_price, 0),
    sell_price: safeNumber(productLike.sell_price, 0),
    unit: String(productLike.unit || "").trim(),
    isActive: true,
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return filter;
}

// ✅ IMAGE URL BUILDER (MUHIM)
function withImageUrl(req, images = []) {
  const base = `${req.protocol}://${req.get("host")}`;
  return (images || []).map((img) => `${base}${img}`);
}

/* =======================
   CREATE PRODUCT
======================= */
exports.createProduct = async (req, res) => {
  try {
    const {
      supplier_id,
      name,
      model,
      color,
      category,
      unit,
      warehouse_currency,
      qty,
    
      buy_price,
      sell_price,
    } = req.body;

    if (
      !supplier_id ||
      !name ||
      !unit ||
      !warehouse_currency ||
      buy_price === undefined ||
      sell_price === undefined
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "supplier_id, name, unit, warehouse_currency, buy_price, sell_price majburiy",
      });
    }

    if (!UNITS.includes(unit)) {
      return res.status(400).json({
        ok: false,
        message: "unit noto‘g‘ri (DONA/PACHKA/KG)",
      });
    }

    if (!CUR.includes(warehouse_currency)) {
      return res.status(400).json({
        ok: false,
        message: "warehouse_currency noto‘g‘ri (UZS/USD)",
      });
    }

    const images = (req.files || []).map(
      (f) => `/uploads/products/${f.filename}`
    );

    const normalizedSupplierId = String(supplier_id).trim();
    const normalizedName = normalizeText(name);
    const normalizedModel = normalizeText(model);
    const normalizedColor = normalizeText(color);
    const normalizedCategory = normalizeText(category);
    const normalizedUnit = String(unit).trim();
    const normalizedCurrency = String(warehouse_currency).trim();
    const incomingQty = qty !== undefined ? safeNumber(qty, 0) : 0;
    const incomingBuyPrice = safeNumber(buy_price, 0);
    const incomingSellPrice = safeNumber(sell_price, 0);

    const existing = await Product.findOne({
      supplier_id: normalizedSupplierId,
      name: normalizedName,
      model: normalizedModel,
      color: normalizedColor,
      unit: normalizedUnit,
      warehouse_currency: normalizedCurrency,
      isActive: true,
    }).sort({ updatedAt: -1 });

    if (existing) {
      existing.qty = Number(existing.qty || 0) + incomingQty;
      existing.buy_price = incomingBuyPrice;
      existing.sell_price = incomingSellPrice;
      existing.category = normalizedCategory;
      existing.images = Array.isArray(existing.images) ? existing.images : [];
      existing.images = [...new Set([...existing.images, ...images])];
      existing.history = Array.isArray(existing.history) ? existing.history : [];
      existing.history.push({
        type: "MANUAL_UPDATE",
        date: new Date(),
        note: "Mahsulot qayta kirim qilindi",
        qtyDelta: incomingQty,
        payload: {
          source: "CREATE_PRODUCT",
          next_buy_price: incomingBuyPrice,
          next_sell_price: incomingSellPrice,
        },
      });
      await existing.save();
      existing.images = withImageUrl(req, existing.images);

      return res.status(200).json({
        ok: true,
        message: "Mahsulot yangilandi",
        product: existing,
      });
    }

    const product = await Product.create({
      supplier_id: normalizedSupplierId,
      name: normalizedName,
      model: normalizedModel,
      color: normalizedColor,
      category: normalizedCategory,
      unit: normalizedUnit,
      warehouse_currency: normalizedCurrency,
      qty: incomingQty,
      buy_price: incomingBuyPrice,
      sell_price: incomingSellPrice,
      images,
    });

    product.images = withImageUrl(req, product.images);

    return res.status(201).json({
      ok: true,
      message: "Mahsulot yaratildi",
      product,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Bu mahsulot allaqachon mavjud",
      });
    }
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/* =======================
   GET PRODUCTS
======================= */
exports.getProducts = async (req, res) => {
  try {
    const { q, currency, category, supplier_id, view, includeArchived } =
      req.query;

    const showArchived =
      String(view || "").toLowerCase() === "archive" ||
      includeArchived === "true";

    const filter = showArchived
      ? { isActive: true }
      : {
          isActive: true, // 🔥 MUHIM
          qty: { $gt: 0 },
        };

    if (supplier_id && mongoose.isValidObjectId(supplier_id)) {
      filter.supplier_id = supplier_id;
    }

    if (currency && ["UZS", "USD"].includes(currency)) {
      filter.warehouse_currency = currency;
    }

    if (category && String(category).trim()) {
      filter.category = String(category).trim();
    }

    if (q && String(q).trim()) {
      const r = new RegExp(escapeRegex(q.trim()), "i");
      filter.$or = [{ name: r }, { model: r }, { color: r }, { category: r }];
    }

    const items = await Product.find(filter)
      .populate("supplier_id", "name phone")
      .sort({ createdAt: -1 })
      .lean();

    const mapped = mergeProductRows(
      items.map((p) => ({
        ...p,
        images: withImageUrl(req, p.images),
      })),
    );

    return res.json({
      ok: true,
      total: mapped.length,
      items: mapped,
    });
  } catch (error) {
    console.error("getProducts error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
    });
  }
};

exports.getArchivedProducts = async (req, res) => {
  try {
    const items = await Product.find({
      isActive: true,
      archive_qty: { $gt: 0 },
    })
      .populate("supplier_id", "name phone")
      .sort({ updatedAt: -1 })
      .lean();

    const mapped = mergeProductRows(
      items.map((p) => ({
        ...p,
        images: withImageUrl(req, p.images),
      })),
    );

    return res.json({
      ok: true,
      total: mapped.length,
      items: mapped,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Archive mahsulotlarni olishda xato",
      error: error.message,
    });
  }
};


/* =======================
   GET PRODUCT BY ID
======================= */
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate("supplier_id", "name phone")
      .lean();

    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

    product.images = withImageUrl(req, product.images);

    return res.json({
      ok: true,
      product,
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
   UPDATE PRODUCT
======================= */
exports.updateProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const product = await Product.findById(id).session(session);
    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

    const {
      supplier_id,
      name,
      model,
      color,
      category,
      unit,
      warehouse_currency,
      qty,
      buy_price,
      sell_price,
      min_qty,
      description,
    } = req.body || {};

    // 🔹 STRING FIELDS
    if (supplier_id) product.supplier_id = supplier_id;
    if (name !== undefined) product.name = String(name).trim();
    if (model !== undefined) product.model = String(model).trim();
    if (color !== undefined) product.color = String(color).trim();
    if (category !== undefined) product.category = String(category).trim();
    if (description !== undefined)
      product.description = String(description).trim();

    // 🔹 ENUM / IMPORTANT
    if (unit) product.unit = unit;
    if (warehouse_currency) product.warehouse_currency = warehouse_currency;

    // 🔹 NUMBER FIELDS
    if (qty !== undefined) product.qty = Number(qty) || 0;
    if (buy_price !== undefined) product.buy_price = Number(buy_price) || 0;
    if (sell_price !== undefined) product.sell_price = Number(sell_price) || 0;
    if (min_qty !== undefined) product.min_qty = Number(min_qty) || 0;

    // 🔹 IMAGE (AGAR KELSA – QO‘SHADI, ko‘p fayl ham qo‘llab-quvvatlanadi)
    const incomingFiles = Array.isArray(req.files)
      ? req.files
      : req.file
        ? [req.file]
        : [];

    if (incomingFiles.length > 0) {
      product.images = Array.isArray(product.images) ? product.images : [];
      const nextImages = incomingFiles.map(
        (f) => `/uploads/products/${f.filename}`,
      );
      product.images = [...new Set([...product.images, ...nextImages])];
    }

    const duplicate = await Product.findOne(
      buildUniqueProductFilter(product, product._id),
    ).session(session);

    if (duplicate) {
      duplicate.qty = Number(duplicate.qty || 0) + Number(product.qty || 0);
      duplicate.archive_qty =
        Number(duplicate.archive_qty || 0) + Number(product.archive_qty || 0);
      duplicate.category = product.category;
      duplicate.images = [
        ...new Set([
          ...(Array.isArray(duplicate.images) ? duplicate.images : []),
          ...(Array.isArray(product.images) ? product.images : []),
        ]),
      ];
      duplicate.history = Array.isArray(duplicate.history) ? duplicate.history : [];
      duplicate.history.push({
        type: "MANUAL_UPDATE",
        date: new Date(),
        by: req.user?._id || req.user?.id || null,
        note: "Duplicate mahsulot edit paytida birlashtirildi",
        qtyDelta: Number(product.qty || 0),
        archiveQtyDelta: Number(product.archive_qty || 0),
        payload: {
          merged_from_product_id: product._id,
        },
      });
      syncArchiveState(duplicate);

      product.isActive = false;
      product.qty = 0;
      product.archive_qty = 0;
      product.archiveReason = "Duplicate product ga birlashtirildi";
      syncArchiveState(product);

      await duplicate.save({ session });
      await product.save({ session });
      await session.commitTransaction();

      return res.json({
        ok: true,
        message: "Mahsulot mavjud product bilan birlashtirildi",
        product: duplicate,
        mergedFromId: id,
      });
    }

    await product.save({ session });
    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Mahsulot yangilandi",
      product,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Shu parametrlardagi mahsulot allaqachon mavjud",
      });
    }
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

exports.getProductHistory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "Product ID noto‘g‘ri",
      });
    }

    const product = await Product.findById(id)
      .populate("supplier_id", "name phone")
      .lean();

    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

    const productId = String(product._id);

    const [purchases, sales, writeOffs] = await Promise.all([
      Purchase.find({ "items.product_id": product._id })
        .populate("supplier_id", "name phone")
        .sort({ purchase_date: 1, createdAt: 1 })
        .select("supplier_id batch_no purchase_date items totals status note createdAt")
        .lean(),
      Sale.find({
        status: { $ne: "DELETED" },
        items: {
          $elemMatch: {
            $or: [
              { productId: product._id },
              {
                "productSnapshot.name": product.name || "",
                "productSnapshot.model": product.model || "",
                "productSnapshot.color": product.color || "",
                "productSnapshot.category": product.category || "",
                "productSnapshot.unit": product.unit || "",
              },
            ],
          },
        },
      })
        .populate("customerId", "name phone")
        .sort({ saleDate: 1, createdAt: 1 })
        .select(
          "invoiceNo saleDate createdAt customerId customerSnapshot items totals currencyTotals status note history",
        )
        .lean(),
      ProductWriteOff.find({ product_id: product._id })
        .populate("createdBy", "name login")
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    const matchedSaleProductIds = new Map();
    for (const s of sales) {
      const key = String(s._id);
      const ids = new Set();
      for (const it of s.items || []) {
        const byId = pickObjectId(it.productId) === productId;
        const bySnapshot = isSameProductSnapshot(it.productSnapshot, product);
        if (!byId && !bySnapshot) continue;
        if (it.productId) ids.add(String(it.productId));
      }
      if (ids.size > 0) matchedSaleProductIds.set(key, ids);
    }

    const returns = await SaleReturn.find({
      $or: [
        { "items.product_id": product._id },
        { sale_id: { $in: sales.map((s) => s._id) } },
      ],
    })
      .populate("sale_id", "invoiceNo saleDate")
      .populate("customer_id", "name phone")
      .sort({ createdAt: 1 })
      .select("sale_id customer_id warehouse_id items returnSubtotal note createdAt createdBy")
      .lean();

    const events = [];

    for (const p of purchases) {
      for (const it of p.items || []) {
        if (pickObjectId(it.product_id) !== productId) continue;

        events.push({
          type: "PURCHASE_IN",
          date: eventDate(p.purchase_date || p.createdAt),
          ref: p.batch_no || "",
          source: {
            id: p._id,
            type: "PURCHASE",
            supplier: p.supplier_id
              ? {
                  _id: p.supplier_id._id,
                  name: p.supplier_id.name,
                  phone: p.supplier_id.phone,
                }
              : null,
          },
          qtyDelta: toNum(it.qty),
          qtyAfterType: "ACTIVE",
          buyPrice: toNum(it.buy_price),
          sellPrice: toNum(it.sell_price),
          amount: toNum(it.row_total || it.qty * it.buy_price),
          note: p.note || "",
        });
      }
    }

    for (const s of sales) {
      for (const it of s.items || []) {
        const byId = pickObjectId(it.productId) === productId;
        const bySnapshot = isSameProductSnapshot(it.productSnapshot, product);
        if (!byId && !bySnapshot) continue;

        events.push({
          type: "SALE_OUT",
          date: eventDate(s.saleDate || s.createdAt),
          ref: s.invoiceNo || "",
          source: {
            id: s._id,
            type: "SALE",
            customer: s.customerId
              ? {
                  _id: s.customerId._id,
                  name: s.customerId.name,
                  phone: s.customerId.phone,
                }
              : s.customerSnapshot || null,
          },
          qtyDelta: -toNum(it.qty),
          qtyAfterType: "ACTIVE",
          buyPrice: toNum(it.buy_price),
          sellPrice: toNum(it.sell_price),
          amount: toNum(it.subtotal),
          note: s.note || "",
        });
      }

      for (const h of s.history || []) {
        if (h.type === "SALE_EDITED" && h.payload?.newItems) {
          const matched = (h.payload.newItems || []).find(
            (x) => pickObjectId(x.productId) === productId,
          );
          if (matched) {
            events.push({
              type: "SALE_EDIT",
              date: eventDate(h.date || s.saleDate),
              ref: s.invoiceNo || "",
              source: {
                id: s._id,
                type: "SALE_EDIT",
              },
              qtyDelta: 0,
              qtyAfterType: "ACTIVE",
              buyPrice: 0,
              sellPrice: 0,
              amount: 0,
              note: h.note || "Sotuv tahrirlandi",
            });
          }
        }
      }
    }

    for (const r of returns) {
      const saleIdKey = r.sale_id?._id ? String(r.sale_id._id) : String(r.sale_id || "");
      const allowedIds = matchedSaleProductIds.get(saleIdKey) || new Set();

      for (const it of r.items || []) {
        const retPid = pickObjectId(it.product_id);
        if (retPid !== productId && !allowedIds.has(retPid)) continue;

        events.push({
          type: "RETURN_IN",
          date: eventDate(r.createdAt),
          ref: r.sale_id?.invoiceNo || "",
          source: {
            id: r._id,
            type: "RETURN",
            sale: r.sale_id
              ? {
                  _id: r.sale_id._id,
                  invoiceNo: r.sale_id.invoiceNo,
                }
              : null,
            customer: r.customer_id
              ? {
                  _id: r.customer_id._id,
                  name: r.customer_id.name,
                  phone: r.customer_id.phone,
                }
              : null,
          },
          qtyDelta: toNum(it.qty),
          qtyAfterType: "ACTIVE",
          buyPrice: 0,
          sellPrice: toNum(it.price),
          amount: toNum(it.subtotal),
          note: r.note || "",
        });
      }
    }

    for (const w of writeOffs) {
      events.push({
        type: "WRITE_OFF",
        date: eventDate(w.createdAt),
        ref: w.reason || "",
        source: {
          id: w._id,
          type: "WRITE_OFF",
          by: w.createdBy
            ? {
                _id: w.createdBy._id,
                name: w.createdBy.name,
                login: w.createdBy.login,
              }
            : null,
        },
        qtyDelta: -toNum(w.qty),
        qtyAfterType: "ACTIVE",
        buyPrice: toNum(product.buy_price),
        sellPrice: toNum(product.sell_price),
        amount: toNum(w.loss_amount),
        note: w.reason || "",
      });
    }

    for (const h of product.history || []) {
      if (h.type === "ARCHIVE_OUT" || h.type === "ARCHIVE_IN") {
        events.push({
          type: h.type,
          date: eventDate(h.date),
          ref: h.note || "",
          source: {
            type: h.type,
            by: h.by || null,
          },
          qtyDelta:
            h.type === "ARCHIVE_OUT"
              ? -toNum(h.qtyDelta || h.archiveQtyDelta)
              : toNum(h.qtyDelta || h.archiveQtyDelta),
          qtyAfterType: "ACTIVE",
          buyPrice: 0,
          sellPrice: 0,
          amount: 0,
          note: h.note || "",
        });
      }
    }

    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    let activeRunningQty = 0;
    const mappedEvents = [];

    for (const e of events) {
      activeRunningQty += toNum(e.qtyDelta);
      mappedEvents.push({
        ...e,
        date: e.date || null,
        activeAfter: activeRunningQty,
      });
    }

    const purchasedQty = events
      .filter((e) => e.type === "PURCHASE_IN")
      .reduce((sum, e) => sum + toNum(e.qtyDelta), 0);
    const purchasedAmount = events
      .filter((e) => e.type === "PURCHASE_IN")
      .reduce((sum, e) => sum + toNum(e.amount), 0);
    const soldQty = events
      .filter((e) => e.type === "SALE_OUT")
      .reduce((sum, e) => sum + Math.abs(toNum(e.qtyDelta)), 0);
    const soldAmount = events
      .filter((e) => e.type === "SALE_OUT")
      .reduce((sum, e) => sum + toNum(e.amount), 0);
    const returnedQty = events
      .filter((e) => e.type === "RETURN_IN")
      .reduce((sum, e) => sum + toNum(e.qtyDelta), 0);
    const returnedAmount = events
      .filter((e) => e.type === "RETURN_IN")
      .reduce((sum, e) => sum + toNum(e.amount), 0);
    const writtenOffQty = events
      .filter((e) => e.type === "WRITE_OFF")
      .reduce((sum, e) => sum + Math.abs(toNum(e.qtyDelta)), 0);
    const lossAmount = events
      .filter((e) => e.type === "WRITE_OFF")
      .reduce((sum, e) => sum + toNum(e.amount), 0);

    const activeQty = Number(product.qty || 0);
    const archiveQty = Number(product.archive_qty || 0);

    return res.json({
      ok: true,
      product: {
        _id: product._id,
        name: product.name,
        model: product.model,
        color: product.color,
        category: product.category,
        unit: product.unit,
        warehouse_currency: product.warehouse_currency,
        buy_price: product.buy_price,
        sell_price: product.sell_price,
        qty: activeQty,
        archive_qty: archiveQty,
        archive_status: product.archive_status,
        archivedAt: product.archivedAt || null,
        archiveReason: product.archiveReason || "",
        supplier: product.supplier_id || null,
      },
      summary: {
        purchasedQty,
        purchasedAmount,
        avgBuyPrice:
          purchasedQty > 0 ? +(purchasedAmount / purchasedQty).toFixed(2) : 0,
        soldQty,
        soldAmount,
        avgSellPrice:
          soldQty > 0 ? +(soldAmount / soldQty).toFixed(2) : 0,
        returnedQty,
        returnedAmount,
        writtenOffQty,
        lossAmount,
        activeQty,
        archiveQty,
        physicalQty: activeQty + archiveQty,
        runningActiveQty: activeRunningQty,
      },
      history: mappedEvents,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Mahsulot tarixini olishda xato",
      error: error.message,
    });
  }
};

exports.archiveProductStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new Error("Product ID noto‘g‘ri");
    }

    const product = await Product.findById(id).session(session);
    if (!product) throw new Error("Mahsulot topilmadi");
    if (!product.isActive) throw new Error("Mahsulot arxivlangan");
    const currentQty = Number(product.qty || 0);

    const reason = String(req.body?.reason || req.body?.archiveReason || "").trim();
    const archiveQtyInput =
      req.body?.qty === undefined || req.body?.qty === null || req.body?.qty === ""
        ? null
        : Number(req.body.qty);

    const moveQty = archiveQtyInput === null ? currentQty : archiveQtyInput;

    if (!Number.isFinite(moveQty) || moveQty <= 0) {
      throw new Error("qty noto‘g‘ri");
    }

    if (moveQty > Number(product.qty || 0)) {
      throw new Error(`Yetarli active qty yo‘q. Bor: ${product.qty}`);
    }

    product.qty = Number(product.qty || 0) - moveQty;
    product.archive_qty = Number(product.archive_qty || 0) + moveQty;
    product.archivedAt = new Date();
    product.archivedBy = req.user?._id || req.user?.id || null;
    product.archiveReason = reason;
    product.history = Array.isArray(product.history) ? product.history : [];
    product.history.push({
      type: "ARCHIVE_OUT",
      date: new Date(),
      by: req.user?._id || req.user?.id || null,
      note: reason || "Archive qilindi",
      qtyDelta: -moveQty,
      archiveQtyDelta: moveQty,
      payload: {
        activeQtyAfter: product.qty,
        archiveQtyAfter: product.archive_qty,
      },
    });
    syncArchiveState(product);

    await product.save({ session });
    await session.commitTransaction();

    return res.json({
      ok: true,
      message:
        moveQty === currentQty ? "Mahsulot to‘liq archive qilindi" : "Mahsulot qisman archive qilindi",
      product,
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

exports.restoreArchivedProductStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new Error("Product ID noto‘g‘ri");
    }

    const product = await Product.findById(id).session(session);
    if (!product) throw new Error("Mahsulot topilmadi");

    const restoreQtyInput =
      req.body?.qty === undefined || req.body?.qty === null || req.body?.qty === ""
        ? null
        : Number(req.body.qty);
    const reason = String(req.body?.reason || req.body?.restoreReason || "").trim();

    const moveQty =
      restoreQtyInput === null ? Number(product.archive_qty || 0) : restoreQtyInput;

    if (!Number.isFinite(moveQty) || moveQty <= 0) {
      throw new Error("qty noto‘g‘ri");
    }

    if (moveQty > Number(product.archive_qty || 0)) {
      throw new Error(`Archive qty yetarli emas. Bor: ${product.archive_qty}`);
    }

    product.qty = Number(product.qty || 0) + moveQty;
    product.archive_qty = Number(product.archive_qty || 0) - moveQty;
    if (product.archive_qty < 0) product.archive_qty = 0;
    product.archivedAt = product.archive_qty > 0 ? product.archivedAt : null;
    product.archiveReason = product.archive_qty > 0 ? product.archiveReason : "";
    product.history = Array.isArray(product.history) ? product.history : [];
    product.history.push({
      type: "ARCHIVE_IN",
      date: new Date(),
      by: req.user?._id || req.user?.id || null,
      note: reason || "Archive dan qaytarildi",
      qtyDelta: moveQty,
      archiveQtyDelta: -moveQty,
      payload: {
        activeQtyAfter: product.qty,
        archiveQtyAfter: product.archive_qty,
      },
    });
    syncArchiveState(product);

    await product.save({ session });
    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Archive mahsulot qaytarildi",
      product,
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


/* =======================
   DELETE PRODUCT
======================= */
exports.deleteProduct = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ ok: false });

  product.isActive = false;
  await product.save();

  return res.json({
    ok: true,
    message: "Mahsulot o‘chirildi (arxivlandi)",
  });
};

exports.deleteProductImage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        message: "Product ID noto‘g‘ri",
      });
    }

    const inputPath =
      req.body?.image || req.body?.imageUrl || req.query?.image || "";
    const normalizedPath = normalizeStoredImagePath(inputPath);
    if (!normalizedPath) {
      return res.status(400).json({
        ok: false,
        message: "image yoki imageUrl yuboring",
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Mahsulot topilmadi",
      });
    }

    const before = Array.isArray(product.images) ? product.images : [];
    if (!before.includes(normalizedPath)) {
      return res.status(404).json({
        ok: false,
        message: "Rasm bu productga biriktirilmagan",
      });
    }

    product.images = before.filter((img) => img !== normalizedPath);
    await product.save();

    const usedByOther = await Product.exists({
      _id: { $ne: product._id },
      images: normalizedPath,
    });

    let fileDeleted = false;
    if (!usedByOther && normalizedPath.startsWith("/uploads/products/")) {
      const absolute = path.join(process.cwd(), normalizedPath.replace(/^\//, ""));
      if (fs.existsSync(absolute)) {
        fs.unlinkSync(absolute);
        fileDeleted = true;
      }
    }

    return res.json({
      ok: true,
      message: "Rasm o‘chirildi",
      removed: normalizedPath,
      fileDeleted,
      product,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Rasmni o‘chirishda xato",
      error: error.message,
    });
  }
};

