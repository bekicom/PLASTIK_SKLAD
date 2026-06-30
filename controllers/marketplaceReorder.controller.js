const mongoose = require("mongoose");

const Product = require("../modules/products/Product");
const Order = require("../modules/orders/Order");
const Sale = require("../modules/sales/Sale");
const MarketplaceAccount = require("../modules/marketplace/MarketplaceAccount");
const MarketplaceFavorite = require("../modules/marketplace/MarketplaceFavorite");
const MarketplaceCart = require("../modules/marketplace/MarketplaceCart");
const MarketplacePreviousPurchaseSnapshot = require("../modules/marketplace/MarketplacePreviousPurchaseSnapshot");
const MarketplaceQuickReorderLog = require("../modules/marketplace/MarketplaceQuickReorderLog");

function cleanText(value = "") {
  return String(value || "").trim();
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toObjectId(value) {
  if (!value) return null;
  const id = typeof value === "object" && value._id ? value._id : value;
  return mongoose.isValidObjectId(id) ? id : null;
}

function pageParams(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function getIdentity(req) {
  const account = req.mobileAccount || null;
  const customer = req.mobileCustomer || account?.customer_id || null;
  const accountId = req.marketplaceAuth?.account_id || account?._id || null;
  const customerId = req.marketplaceAuth?.customer_id || customer?._id || null;
  return { account, customer, accountId: toObjectId(accountId), customerId: toObjectId(customerId) };
}

function activeStatusAllowed(req) {
  const status = String(req.marketplaceAuth?.status || req.mobileAccount?.status || req.mobileCustomer?.status || "").toUpperCase();
  return status === "ACTIVE";
}

function productVisible(product) {
  return Boolean(product && product.isActive !== false && product.marketplace_visible !== false);
}

function productImage(product) {
  return Array.isArray(product?.images) && product.images.length ? product.images[0] : "";
}

function productDto(product, extra = {}) {
  const availableStock = Number(product?.qty || 0);
  const minOrderQty = Number(product?.min_order_qty || 1);
  const stepQty = Number(product?.step_qty || 1);
  const visible = productVisible(product);
  return {
    product_id: product?._id || null,
    name: product?.name || "",
    model: product?.model || "",
    image_url: productImage(product),
    price: Number(product?.sell_price || 0),
    current_price: Number(product?.sell_price || 0),
    currency: product?.warehouse_currency || "UZS",
    unit: product?.unit || "",
    available_stock: availableStock,
    min_order_qty: minOrderQty,
    step_qty: stepQty,
    marketplace_visible: product?.marketplace_visible !== false,
    can_add_to_cart: visible && availableStock >= minOrderQty,
    unavailable_reason: visible ? (availableStock >= minOrderQty ? null : "OUT_OF_STOCK") : "PRODUCT_UNAVAILABLE",
    ...extra,
  };
}

function validateQty(product, qty) {
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, code: "INVALID_QTY", message: "Quantity noto‘g‘ri." };
  }
  const min = Number(product.min_order_qty || 1);
  const step = Number(product.step_qty || 1);
  const stock = Number(product.qty || 0);
  if (quantity < min) {
    return { ok: false, code: "MIN_ORDER_QTY", message: `Minimal buyurtma miqdori ${min}.` };
  }
  if (step > 0) {
    const diff = Math.abs((quantity - min) / step - Math.round((quantity - min) / step));
    if (diff > 1e-9) {
      return { ok: false, code: "STEP_QTY", message: `Miqdor ${step} qadamiga mos emas.` };
    }
  }
  if (stock < quantity) {
    return { ok: false, code: "OUT_OF_STOCK", message: "Mahsulot qoldig‘i yetarli emas." };
  }
  return { ok: true, quantity };
}

async function ensureAccount(req) {
  const identity = getIdentity(req);
  if (identity.accountId) return identity;

  if (identity.customerId) {
    const account = await MarketplaceAccount.findOneAndUpdate(
      { customer_id: identity.customerId },
      {
        $setOnInsert: {
          phone: `customer-${identity.customerId}`,
          phone_normalized: `customer-${identity.customerId}`,
          customer_id: identity.customerId,
          status: "ACTIVE",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return { ...identity, account, accountId: account._id };
  }

  return identity;
}

async function getActiveCart(accountId, customerId) {
  return MarketplaceCart.findOneAndUpdate(
    { account_id: accountId, status: "ACTIVE" },
    { $setOnInsert: { account_id: accountId, customer_id: customerId || null, status: "ACTIVE", items: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function addProductsToCart({ req, items, sourceType = "PREVIOUS_PURCHASE_LIST", sourceId = null }) {
  const identity = await ensureAccount(req);
  const warnings = [];
  const added = [];

  if (!identity.accountId) {
    return { status: 401, body: { ok: false, message: "Qayta kirishingiz kerak." } };
  }
  if (!identity.customerId) {
    return { status: 403, body: { ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." } };
  }
  if (!activeStatusAllowed(req)) {
    return { status: 403, body: { ok: false, message: "Profilingiz vaqtincha cheklangan." } };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { status: 400, body: { ok: false, message: "Items bo‘sh bo‘lishi mumkin emas." } };
  }
  if (items.length > 100) {
    return { status: 400, body: { ok: false, message: "Bir martada maksimal 100 ta item yuboring." } };
  }

  const ids = [...new Set(items.map((it) => String(it.product_id || "")).filter(Boolean))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    return { status: 400, body: { ok: false, message: "product_id noto‘g‘ri." } };
  }

  const products = await Product.find({ _id: { $in: ids } }).lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const cart = await getActiveCart(identity.accountId, identity.customerId);

  for (const item of items) {
    const productId = String(item.product_id || "");
    const product = productMap.get(productId);
    if (!product || !productVisible(product)) {
      warnings.push({ product_id: productId, code: "PRODUCT_UNAVAILABLE", message: "Mahsulot topilmadi yoki marketplace’da mavjud emas." });
      continue;
    }

    const qtyCheck = validateQty(product, item.quantity || item.qty);
    if (!qtyCheck.ok) {
      warnings.push({ product_id: productId, code: qtyCheck.code, message: qtyCheck.message });
      continue;
    }

    const existing = cart.items.find(
      (row) => String(row.product_id) === productId && String(row.variant_id || "") === String(item.variant_id || ""),
    );
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + qtyCheck.quantity;
      existing.price_snapshot = Number(product.sell_price || 0);
      existing.currency_snapshot = product.warehouse_currency || "UZS";
      existing.note = cleanText(item.note || existing.note);
      existing.added_from = "QUICK_REORDER";
    } else {
      cart.items.push({
        product_id: product._id,
        variant_id: item.variant_id || null,
        quantity: qtyCheck.quantity,
        note: cleanText(item.note),
        price_snapshot: Number(product.sell_price || 0),
        currency_snapshot: product.warehouse_currency || "UZS",
        product_snapshot: {
          name: product.name || "",
          model: product.model || "",
          color: product.color || "",
          category: product.category || "",
          unit: product.unit || "",
          images: product.images || [],
        },
        added_from: "QUICK_REORDER",
      });
    }
    added.push(productId);
  }

  cart.recalculateTotals();
  await cart.save();

  await MarketplaceQuickReorderLog.create({
    account_id: identity.accountId,
    customer_id: identity.customerId,
    source_type: sourceType,
    source_id: sourceId || null,
    requested_items_count: items.length,
    added_items_count: added.length,
    skipped_items_count: warnings.length,
    warnings,
  });

  return {
    status: 200,
    body: {
      ok: true,
      message: added.length ? "Mahsulotlar savatga qo‘shildi." : "Ruxsatli mahsulot topilmadi.",
      cart_id: cart._id,
      added_items_count: added.length,
      skipped_items_count: warnings.length,
      warnings,
      cart_totals_by_currency: cart.totals_by_currency,
    },
  };
}

async function loadActiveCart(identity) {
  const cart = await getActiveCart(identity.accountId, identity.customerId);
  await cart.populate("items.product_id", "name model color category images unit sell_price qty marketplace_visible min_order_qty step_qty marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo");
  return cart;
}

function serializeCart(cart) {
  const items = (cart.items || []).map((item) => {
    const product = item.product_id || null;
    const price = Number(item.price_snapshot || product?.sell_price || 0);
    const quantity = Number(item.quantity || 0);
    const currency = item.currency_snapshot === "USD" ? "USD" : "UZS";
    return {
      item_id: item._id,
      product_id: product?._id || item.product_id || null,
      name: product?.name || item.product_snapshot?.name || "",
      model: product?.model || item.product_snapshot?.model || "",
      color: product?.color || item.product_snapshot?.color || "",
      category: product?.category || item.product_snapshot?.category || "",
      images: Array.isArray(item.product_snapshot?.images) ? item.product_snapshot.images : [],
      image_url: Array.isArray(item.product_snapshot?.images) && item.product_snapshot.images.length ? item.product_snapshot.images[0] : "",
      unit: product?.unit || item.product_snapshot?.unit || "",
      quantity,
      price_snapshot: price,
      currency_snapshot: currency,
      subtotal: Number((price * quantity).toFixed(2)),
      note: item.note || "",
      added_from: item.added_from || "MANUAL",
    };
  });

  return {
    ok: true,
    cart_id: cart._id,
    status: cart.status,
    items_count: items.length,
    items,
    totals_by_currency: cart.totals_by_currency || { UZS: 0, USD: 0 },
    data: {
      cart_id: cart._id,
      status: cart.status,
      items,
      totals_by_currency: cart.totals_by_currency || { UZS: 0, USD: 0 },
    },
  };
}

async function validateCartItems(identity, cart) {
  const errors = [];
  const warnings = [];

  const productIds = [...new Set((cart.items || []).map((item) => String(item.product_id || "")).filter(Boolean))];
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  for (const item of cart.items || []) {
    const product = productMap.get(String(item.product_id || ""));
    if (!product || !productVisible(product)) {
      errors.push({
        item_id: item._id,
        product_id: item.product_id || null,
        code: "PRODUCT_UNAVAILABLE",
        message: "Mahsulot topilmadi yoki marketplace’da mavjud emas.",
      });
      continue;
    }

    const qtyCheck = validateQty(product, item.quantity);
    if (!qtyCheck.ok) {
      errors.push({
        item_id: item._id,
        product_id: item.product_id || null,
        code: qtyCheck.code,
        message: qtyCheck.message,
      });
      continue;
    }

    if (Number(item.price_snapshot || 0) !== Number(product.sell_price || 0)) {
      warnings.push({
        item_id: item._id,
        product_id: item.product_id || null,
        code: "PRICE_CHANGED",
        message: "Narx o‘zgargan.",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

async function collectPreviousPurchases(customerId, query = {}) {
  const { q = "", currency = "", from = "", to = "" } = query;
  const search = cleanText(q);
  const dateFilter = {};
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) dateFilter.$gte = fromDate;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    toDate.setHours(23, 59, 59, 999);
    dateFilter.$lte = toDate;
  }

  const [orders, sales] = await Promise.all([
    Order.find({
      customer_id: customerId,
      status: { $in: ["CONFIRMED", "COMPLETED", "APPROVED"] },
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    }).sort({ createdAt: -1 }).lean(),
    Sale.find({
      customerId: customerId,
      status: "COMPLETED",
      ...(Object.keys(dateFilter).length ? { saleDate: dateFilter } : {}),
    }).sort({ saleDate: -1, createdAt: -1 }).lean(),
  ]);

  const map = new Map();
  function upsert(row) {
    if (!row.product_id) return;
    const key = String(row.product_id);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        product_id: row.product_id,
        name: row.name || "",
        image_url: row.image_url || "",
        unit: row.unit || "",
        last_quantity: row.qty,
        total_quantity: row.qty,
        orders_count: 1,
        last_price: row.price,
        currency: row.currency || "UZS",
        last_order_id: row.order_id || null,
        last_sale_id: row.sale_id || null,
        last_purchasedAt: row.date,
        source: row.source,
      });
      return;
    }
    prev.total_quantity += row.qty;
    prev.orders_count += 1;
    if (new Date(row.date).getTime() > new Date(prev.last_purchasedAt || 0).getTime()) {
      prev.last_quantity = row.qty;
      prev.last_price = row.price;
      prev.last_purchasedAt = row.date;
      prev.last_order_id = row.order_id || prev.last_order_id;
      prev.last_sale_id = row.sale_id || prev.last_sale_id;
    }
    if (prev.source !== row.source) prev.source = "mixed";
  }

  for (const order of orders) {
    for (const item of order.items || []) {
      upsert({
        product_id: item.product_id,
        name: item.product_snapshot?.name || "",
        image_url: item.product_snapshot?.images?.[0] || "",
        unit: item.product_snapshot?.unit || "",
        qty: Number(item.qty || 0),
        price: Number(item.price_snapshot || 0),
        currency: item.currency_snapshot || "UZS",
        order_id: order._id,
        date: order.confirmedAt || order.createdAt,
        source: "marketplace",
      });
    }
  }

  for (const sale of sales) {
    for (const item of sale.items || []) {
      upsert({
        product_id: item.productId,
        name: item.productSnapshot?.name || "",
        image_url: item.productSnapshot?.images?.[0] || "",
        unit: item.productSnapshot?.unit || "",
        qty: Number(item.qty || 0),
        price: Number(item.sell_price || 0),
        currency: item.currency || "UZS",
        sale_id: sale._id,
        date: sale.saleDate || sale.createdAt,
        source: "admin_sale",
      });
    }
  }

  const products = await Product.find({ _id: { $in: [...map.keys()] } }).lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  let rows = [...map.values()].map((row) => {
    const product = productMap.get(String(row.product_id));
    const dto = product ? productDto(product) : {};
    const priceChanged = product && Number(row.last_price || 0) !== Number(product.sell_price || 0);
    const hidden = product && !productVisible(product);
    return {
      ...row,
      name: product?.name || row.name,
      image_url: productImage(product) || row.image_url,
      unit: product?.unit || row.unit,
      current_price: Number(product?.sell_price || 0),
      available_stock: Number(product?.qty || 0),
      min_order_qty: Number(product?.min_order_qty || 1),
      step_qty: Number(product?.step_qty || 1),
      can_reorder: Boolean(product && productVisible(product) && Number(product.qty || 0) > 0),
      warning: hidden ? "Mahsulot marketplace’da mavjud emas" : priceChanged ? "Narx o‘zgargan" : null,
      marketplace: dto,
    };
  });

  if (currency) rows = rows.filter((row) => row.currency === String(currency).toUpperCase());
  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    rows = rows.filter((row) => re.test(row.name || ""));
  }

  const sort = String(query.sort || "last_purchased").toLowerCase();
  rows.sort((a, b) => {
    if (sort === "most_bought") return Number(b.total_quantity || 0) - Number(a.total_quantity || 0);
    if (sort === "name") return String(a.name || "").localeCompare(String(b.name || ""));
    return new Date(b.last_purchasedAt || 0) - new Date(a.last_purchasedAt || 0);
  });

  return rows;
}

exports.getFavorites = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    const { page, limit, skip } = pageParams(req.query);
    const { q = "", currency = "", only_available = "" } = req.query || {};

    const favs = await MarketplaceFavorite.find({ account_id: identity.accountId, status: "ACTIVE" })
      .sort({ createdAt: -1 })
      .populate("product_id")
      .lean();

    let rows = favs
      .filter((fav) => fav.product_id)
      .map((fav) => productDto(fav.product_id, { favorite_id: fav._id, createdAt: fav.createdAt, note: fav.note || "" }));

    if (q) rows = rows.filter((row) => new RegExp(escapeRegex(q), "i").test(row.name || ""));
    if (currency) rows = rows.filter((row) => row.currency === String(currency).toUpperCase());
    if (String(only_available) === "1" || String(only_available).toLowerCase() === "true") {
      rows = rows.filter((row) => row.can_add_to_cart);
    }

    const total = rows.length;
    return res.json({ ok: true, page, limit, total, items: rows.slice(skip, skip + limit) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Sevimlilarni olishda xatolik", error: error.message });
  }
};

exports.addFavorite = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    if (!activeStatusAllowed(req)) return res.status(403).json({ ok: false, message: "Profilingiz vaqtincha cheklangan." });

    const productId = toObjectId(req.body?.product_id);
    if (!productId) return res.status(400).json({ ok: false, message: "product_id noto‘g‘ri." });
    const product = await Product.findById(productId).lean();
    if (!productVisible(product)) {
      return res.status(404).json({ ok: false, message: "Mahsulot topilmadi yoki marketplace’da mavjud emas." });
    }

    const favorite = await MarketplaceFavorite.findOneAndUpdate(
      { account_id: identity.accountId, product_id: productId, variant_id: req.body?.variant_id || null },
      {
        $set: {
          customer_id: identity.customerId || null,
          status: "ACTIVE",
          note: cleanText(req.body?.note),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.status(201).json({ ok: true, message: "Mahsulot sevimlilarga qo‘shildi.", favorite });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Favorite qo‘shishda xatolik", error: error.message });
  }
};

exports.deleteFavorite = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    const productId = toObjectId(req.params.product_id);
    if (!productId) return res.status(400).json({ ok: false, message: "product_id noto‘g‘ri." });

    await MarketplaceFavorite.findOneAndUpdate(
      { account_id: identity.accountId, product_id: productId, status: "ACTIVE" },
      { $set: { status: "REMOVED" } },
    );

    return res.json({ ok: true, message: "Favorite o‘chirildi." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Favorite o‘chirishda xatolik", error: error.message });
  }
};

exports.toggleFavorite = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    const productId = toObjectId(req.body?.product_id);
    if (!productId) return res.status(400).json({ ok: false, message: "product_id noto‘g‘ri." });

    const current = await MarketplaceFavorite.findOne({ account_id: identity.accountId, product_id: productId });
    const nextStatus = current?.status === "ACTIVE" ? "REMOVED" : "ACTIVE";
    const favorite = await MarketplaceFavorite.findOneAndUpdate(
      { account_id: identity.accountId, product_id: productId, variant_id: req.body?.variant_id || null },
      { $set: { customer_id: identity.customerId || null, status: nextStatus, note: cleanText(req.body?.note) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.json({ ok: true, is_favorite: nextStatus === "ACTIVE", favorite });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Favorite toggle xatolik", error: error.message });
  }
};

exports.getFavoriteStatus = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    const productId = toObjectId(req.params.id);
    if (!productId) return res.status(400).json({ ok: false, message: "product_id noto‘g‘ri." });

    const favorite = await MarketplaceFavorite.findOne({
      account_id: identity.accountId,
      product_id: productId,
      status: "ACTIVE",
    }).lean();
    return res.json({ ok: true, product_id: productId, is_favorite: Boolean(favorite), favorite_id: favorite?._id || null });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Favorite status xatolik", error: error.message });
  }
};

exports.getPreviousPurchases = async (req, res) => {
  try {
    const identity = getIdentity(req);
    if (!identity.customerId) {
      return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });
    }
    const { page, limit, skip } = pageParams(req.query);
    const rows = await collectPreviousPurchases(identity.customerId, req.query);
    return res.json({ ok: true, page, limit, total: rows.length, items: rows.slice(skip, skip + limit) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Avvalgi xaridlarni olishda xatolik", error: error.message });
  }
};

exports.getPreviousPurchaseByProduct = async (req, res) => {
  try {
    const identity = getIdentity(req);
    if (!identity.customerId) {
      return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });
    }
    const productId = toObjectId(req.params.product_id);
    if (!productId) return res.status(400).json({ ok: false, message: "product_id noto‘g‘ri." });
    const rows = await collectPreviousPurchases(identity.customerId, req.query);
    const item = rows.find((row) => String(row.product_id) === String(productId));
    if (!item) return res.status(404).json({ ok: false, message: "Avvalgi xarid topilmadi." });
    return res.json({ ok: true, item });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Avvalgi xaridni olishda xatolik", error: error.message });
  }
};

exports.addReorderToCart = async (req, res) => {
  const result = await addProductsToCart({
    req,
    items: req.body?.items || [],
    sourceType: "PREVIOUS_PURCHASE_LIST",
  });
  return res.status(result.status).json(result.body);
};

exports.getCart = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    const cart = await getActiveCart(identity.accountId, identity.customerId);
    await cart.populate("items.product_id", "name model color category images unit sell_price qty marketplace_visible marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo");

    const items = (cart.items || []).map((item) => {
      const product = item.product_id || null;
      const price = Number(item.price_snapshot || product?.sell_price || 0);
      const quantity = Number(item.quantity || 0);
      const currency = item.currency_snapshot === "USD" ? "USD" : "UZS";
      return {
        product_id: product?._id || item.product_id || null,
        name: product?.name || item.product_snapshot?.name || "",
        model: product?.model || item.product_snapshot?.model || "",
        color: product?.color || item.product_snapshot?.color || "",
        category: product?.category || item.product_snapshot?.category || "",
        images: Array.isArray(item.product_snapshot?.images) ? item.product_snapshot.images : [],
        image_url: Array.isArray(item.product_snapshot?.images) && item.product_snapshot.images.length ? item.product_snapshot.images[0] : "",
        unit: product?.unit || item.product_snapshot?.unit || "",
        quantity,
        price_snapshot: price,
        currency_snapshot: currency,
        subtotal: Number((price * quantity).toFixed(2)),
        note: item.note || "",
        added_from: item.added_from || "MANUAL",
      };
    });

    return res.json({
      ok: true,
      cart_id: cart._id,
      status: cart.status,
      items_count: items.length,
      items,
      totals_by_currency: cart.totals_by_currency || { UZS: 0, USD: 0 },
      data: {
        cart_id: cart._id,
        status: cart.status,
        items,
        totals_by_currency: cart.totals_by_currency || { UZS: 0, USD: 0 },
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Cart olishda xatolik", error: error.message });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const identity = getIdentity(req);
    if (!identity.customerId) return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });
    const page = Math.max(Number(req.query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 100);
    const skip = (page - 1) * limit;
    const filter = { customer_id: identity.customerId, source: "MOBILE" };

    const [items, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);

    const mapped = items.map((order) => ({
      id: order._id,
      order_id: order._id,
      status: order.status,
      source: order.source,
      note: order.note || "",
      items_count: Array.isArray(order.items) ? order.items.length : 0,
      total_uzs: Number(order.total_uzs || 0),
      total_usd: Number(order.total_usd || 0),
      totals: { UZS: Number(order.total_uzs || 0), USD: Number(order.total_usd || 0) },
      confirmedAt: order.confirmedAt || null,
      canceledAt: order.canceledAt || null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    }));

    return res.json({ ok: true, page, limit, total, count: total, items: mapped, data: mapped });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Orders olishda xatolik", error: error.message });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const identity = getIdentity(req);
    if (!identity.customerId) return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });
    const order = await Order.findOne({ _id: req.params.id, customer_id: identity.customerId, source: "MOBILE" }).lean();
    if (!order) return res.status(404).json({ ok: false, message: "Order topilmadi." });
    return res.json({
      ok: true,
      order: {
        id: order._id,
        order_id: order._id,
        status: order.status,
        source: order.source,
        note: order.note || "",
        items: order.items || [],
        total_uzs: Number(order.total_uzs || 0),
        total_usd: Number(order.total_usd || 0),
        totals: { UZS: Number(order.total_uzs || 0), USD: Number(order.total_usd || 0) },
        confirmedAt: order.confirmedAt || null,
        canceledAt: order.canceledAt || null,
        cancelReason: order.cancelReason || "",
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Orderni olishda xatolik", error: error.message });
  }
};

exports.addOrderToCart = async (req, res) => {
  try {
    const identity = getIdentity(req);
    const orderId = toObjectId(req.params.order_id);
    if (!identity.customerId) return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });
    if (!orderId) return res.status(400).json({ ok: false, message: "order_id noto‘g‘ri." });

    const order = await Order.findOne({
      _id: orderId,
      customer_id: identity.customerId,
      status: { $in: ["CONFIRMED", "COMPLETED", "APPROVED"] },
    }).lean();
    if (!order) return res.status(404).json({ ok: false, message: "Avvalgi xarid topilmadi yoki ruxsat yo‘q." });

    const result = await addProductsToCart({
      req,
      items: (order.items || []).map((item) => ({
        product_id: item.product_id,
        quantity: item.qty,
        note: "Avvalgi buyurtma asosida",
      })),
      sourceType: "ORDER",
      sourceId: order._id,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Orderdan qayta savatga qo‘shishda xatolik", error: error.message });
  }
};

exports.getSuggestions = async (req, res) => {
  try {
    const identity = getIdentity(req);
    if (!identity.customerId && !identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    const type = String(req.query.type || "recent").toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    let rows = [];
    if (type === "favorite" && identity.accountId) {
      const favs = await MarketplaceFavorite.find({ account_id: identity.accountId, status: "ACTIVE" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("product_id")
        .lean();
      rows = favs.filter((fav) => productVisible(fav.product_id)).map((fav) => productDto(fav.product_id, { reason: "favorite" }));
    } else if (identity.customerId) {
      const purchases = await collectPreviousPurchases(identity.customerId, { sort: type === "frequent" ? "most_bought" : "last_purchased" });
      rows = purchases.filter((row) => row.can_reorder).slice(0, limit);
    }

    return res.json({ ok: true, type, total: rows.length, items: rows.slice(0, limit) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Suggestions olishda xatolik", error: error.message });
  }
};

exports.addCartItem = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    if (!activeStatusAllowed(req)) return res.status(403).json({ ok: false, message: "Profilingiz vaqtincha cheklangan." });

    const productId = toObjectId(req.body?.product_id);
    const quantity = Number(req.body?.quantity || req.body?.qty || 0);
    const variantId = toObjectId(req.body?.variant_id);
    const note = cleanText(req.body?.note);

    if (!productId) return res.status(400).json({ ok: false, message: "product_id noto‘g‘ri." });

    const product = await Product.findById(productId).lean();
    if (!product || !productVisible(product)) {
      return res.status(404).json({ ok: false, message: "Mahsulot topilmadi yoki marketplace’da mavjud emas." });
    }

    const qtyCheck = validateQty(product, quantity);
    if (!qtyCheck.ok) {
      return res.status(400).json({
        ok: false,
        code: qtyCheck.code,
        message: qtyCheck.message,
      });
    }

    const cart = await getActiveCart(identity.accountId, identity.customerId);
    const existing = cart.items.find(
      (row) => String(row.product_id) === String(productId) && String(row.variant_id || "") === String(variantId || ""),
    );

    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + qtyCheck.quantity;
      existing.price_snapshot = Number(product.sell_price || 0);
      existing.currency_snapshot = product.warehouse_currency || "UZS";
      existing.note = note || existing.note || "";
      existing.added_from = "MANUAL";
    } else {
      cart.items.push({
        product_id: product._id,
        variant_id: variantId || null,
        quantity: qtyCheck.quantity,
        note,
        price_snapshot: Number(product.sell_price || 0),
        currency_snapshot: product.warehouse_currency || "UZS",
        product_snapshot: {
          name: product.name || "",
          model: product.model || "",
          color: product.color || "",
          category: product.category || "",
          unit: product.unit || "",
          images: product.images || [],
        },
        added_from: "MANUAL",
      });
    }

    cart.recalculateTotals();
    await cart.save();
    await cart.populate("items.product_id", "name model color category images unit sell_price qty marketplace_visible min_order_qty step_qty marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo");

    return res.status(201).json({
      ok: true,
      message: "Mahsulot savatga qo‘shildi.",
      ...serializeCart(cart),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Savatga qo‘shishda xatolik", error: error.message });
  }
};

exports.updateCartItem = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    if (!activeStatusAllowed(req)) return res.status(403).json({ ok: false, message: "Profilingiz vaqtincha cheklangan." });

    const itemId =
      toObjectId(req.params.item_id) ||
      toObjectId(req.body?.item_id) ||
      toObjectId(req.body?.id) ||
      toObjectId(req.query?.item_id) ||
      toObjectId(req.query?.id);
    const quantity = req.body?.quantity !== undefined ? Number(req.body.quantity) : null;
    const note = req.body?.note !== undefined ? cleanText(req.body.note) : undefined;
    if (!itemId) return res.status(400).json({ ok: false, message: "item_id noto‘g‘ri." });
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      return res.status(400).json({ ok: false, message: "Quantity noto‘g‘ri." });
    }

    const cart = await getActiveCart(identity.accountId, identity.customerId);
    const item = cart.items.id(itemId);
    if (!item) return res.status(404).json({ ok: false, message: "Cart item topilmadi." });

    const product = await Product.findById(item.product_id).lean();
    if (!product || !productVisible(product)) {
      return res.status(404).json({ ok: false, message: "Mahsulot topilmadi yoki marketplace’da mavjud emas." });
    }

    if (quantity !== null) {
      const qtyCheck = validateQty(product, quantity);
      if (!qtyCheck.ok) {
        return res.status(400).json({
          ok: false,
          code: qtyCheck.code,
          message: qtyCheck.message,
        });
      }
      item.quantity = qtyCheck.quantity;
    }
    if (note !== undefined) {
      item.note = note;
    }
    item.price_snapshot = Number(product.sell_price || item.price_snapshot || 0);
    item.currency_snapshot = product.warehouse_currency || item.currency_snapshot || "UZS";

    cart.recalculateTotals();
    await cart.save();
    await cart.populate("items.product_id", "name model color category images unit sell_price qty marketplace_visible min_order_qty step_qty marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo");

    return res.json({
      ok: true,
      message: "Savat elementi yangilandi.",
      ...serializeCart(cart),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Savat elementini yangilashda xatolik", error: error.message });
  }
};

exports.deleteCartItem = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    const itemId =
      toObjectId(req.params.item_id) ||
      toObjectId(req.body?.item_id) ||
      toObjectId(req.body?.id) ||
      toObjectId(req.query?.item_id) ||
      toObjectId(req.query?.id);
    if (!itemId) return res.status(400).json({ ok: false, message: "item_id noto‘g‘ri." });

    const cart = await getActiveCart(identity.accountId, identity.customerId);
    const item = cart.items.id(itemId);
    if (!item) return res.status(404).json({ ok: false, message: "Cart item topilmadi." });

    item.deleteOne();
    cart.recalculateTotals();
    await cart.save();
    await cart.populate("items.product_id", "name model color category images unit sell_price qty marketplace_visible min_order_qty step_qty marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo");

    return res.json({
      ok: true,
      message: "Mahsulot savatdan o‘chirildi.",
      ...serializeCart(cart),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Savat elementini o‘chirishda xatolik", error: error.message });
  }
};

exports.clearCart = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });

    const cart = await getActiveCart(identity.accountId, identity.customerId);
    cart.items = [];
    cart.recalculateTotals();
    await cart.save();
    await cart.populate("items.product_id", "name model color category images unit sell_price qty marketplace_visible min_order_qty step_qty marketplace_sort_order marketplace_recommended marketplace_new marketplace_top marketplace_promo");

    return res.json({
      ok: true,
      message: "Savat tozalandi.",
      ...serializeCart(cart),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Savatni tozalashda xatolik", error: error.message });
  }
};

exports.validateCart = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    if (!identity.customerId) return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });
    if (!activeStatusAllowed(req)) return res.status(403).json({ ok: false, message: "Profilingiz vaqtincha cheklangan." });

    const cart = await loadActiveCart(identity);
    const validation = await validateCartItems(identity, cart);
    return res.json({
      ok: true,
      valid: validation.valid,
      warnings: validation.warnings,
      errors: validation.errors,
      totals_by_currency: cart.totals_by_currency || { UZS: 0, USD: 0 },
      ...serializeCart(cart),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Cart validatsiyada xatolik", error: error.message });
  }
};

exports.submitOrder = async (req, res) => {
  try {
    const identity = await ensureAccount(req);
    if (!identity.accountId) return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    if (!identity.customerId) return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });
    if (!activeStatusAllowed(req)) return res.status(403).json({ ok: false, message: "Profilingiz vaqtincha cheklangan." });

    const cart = await loadActiveCart(identity);
    if (!Array.isArray(cart.items) || cart.items.length === 0) {
      return res.status(400).json({ ok: false, message: "Savat bo‘sh. Buyurtma berish uchun mahsulot qo‘shing." });
    }

    const validation = await validateCartItems(identity, cart);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        message: "Savatda xatolar bor.",
        warnings: validation.warnings,
        errors: validation.errors,
      });
    }

    const orderItems = (cart.items || []).map((item) => ({
      product_id: item.product_id?._id || item.product_id,
      product_snapshot: {
        name: item.product_snapshot?.name || item.product_id?.name || "",
        code: item.product_snapshot?.code || item.product_id?.code || "",
        model: item.product_snapshot?.model || item.product_id?.model || "",
        color: item.product_snapshot?.color || item.product_id?.color || "",
        category: item.product_snapshot?.category || item.product_id?.category || "",
        unit: item.product_snapshot?.unit || item.product_id?.unit || "",
        images: item.product_snapshot?.images || item.product_id?.images || [],
      },
      qty: Number(item.quantity || 0),
      price_snapshot: Number(item.price_snapshot || item.product_id?.sell_price || 0),
      subtotal: Number((Number(item.price_snapshot || item.product_id?.sell_price || 0) * Number(item.quantity || 0)).toFixed(2)),
      currency_snapshot: item.currency_snapshot === "USD" ? "USD" : "UZS",
    }));

    const totals = orderItems.reduce(
      (acc, item) => {
        const currency = item.currency_snapshot === "USD" ? "USD" : "UZS";
        acc[currency] += Number(item.subtotal || 0);
        return acc;
      },
      { UZS: 0, USD: 0 },
    );

    const order = await Order.create({
      source: "MOBILE",
      customer_id: identity.customerId,
      items: orderItems,
      total_uzs: totals.UZS,
      total_usd: totals.USD,
      status: "NEW",
      note: cleanText(req.body?.general_note || req.body?.note),
    });

    cart.status = "ORDERED";
    await cart.save();

    return res.status(201).json({
      ok: true,
      message: "Buyurtma admin tasdig‘iga yuborildi.",
      merged: false,
      order: {
        order_id: order._id,
        order_number: `MP-${String(order.createdAt || new Date()).slice(0, 10).replace(/-/g, "")}-${String(order._id).slice(-4)}`,
        status: "PENDING_ADMIN",
        backend_status: order.status,
        totals_by_currency: { UZS: totals.UZS, USD: totals.USD },
        items_count: orderItems.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Buyurtma yuborishda xatolik", error: error.message });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const identity = getIdentity(req);
    if (!identity.customerId) return res.status(403).json({ ok: false, message: "Profilingiz admin tomonidan to‘liq bog‘lanmagan." });

    const order = await Order.findOne({
      _id: req.params.id,
      customer_id: identity.customerId,
      source: "MOBILE",
    });
    if (!order) return res.status(404).json({ ok: false, message: "Order topilmadi." });
    if (order.status !== "NEW") {
      return res.status(400).json({ ok: false, message: `Faqat NEW order bekor qilinadi. Hozirgi status: ${order.status}` });
    }

    order.status = "CANCELED";
    order.canceledAt = new Date();
    order.cancelReason = cleanText(req.body?.reason || "Bekor qilindi");
    await order.save();

    return res.json({
      ok: true,
      message: "Buyurtma bekor qilindi.",
      status: "CANCELED_BY_CUSTOMER",
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Buyurtmani bekor qilishda xatolik", error: error.message });
  }
};

exports.adminCustomerFavorites = async (req, res) => {
  try {
    const customerId = toObjectId(req.params.customer_id);
    if (!customerId) return res.status(400).json({ ok: false, message: "customer_id noto‘g‘ri." });
    const items = await MarketplaceFavorite.find({ customer_id: customerId, status: "ACTIVE" })
      .sort({ createdAt: -1 })
      .populate("product_id")
      .lean();
    return res.json({ ok: true, total: items.length, items });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Admin favorites xatolik", error: error.message });
  }
};

exports.adminCustomerPreviousPurchases = async (req, res) => {
  try {
    const customerId = toObjectId(req.params.customer_id);
    if (!customerId) return res.status(400).json({ ok: false, message: "customer_id noto‘g‘ri." });
    const rows = await collectPreviousPurchases(customerId, req.query);
    return res.json({ ok: true, total: rows.length, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Admin previous purchases xatolik", error: error.message });
  }
};

exports.rebuildPreviousPurchaseSnapshot = async (req, res) => {
  try {
    const customerId = toObjectId(req.body?.customer_id || req.query?.customer_id);
    if (!customerId) return res.status(400).json({ ok: false, message: "customer_id majburiy." });
    const rows = await collectPreviousPurchases(customerId, {});
    let upserted = 0;
    for (const row of rows) {
      await MarketplacePreviousPurchaseSnapshot.findOneAndUpdate(
        { customer_id: customerId, product_id: row.product_id, variant_id: null },
        {
          $set: {
            product_name_snapshot: row.name,
            image_url_snapshot: row.image_url,
            unit: row.unit,
            currency: row.currency,
            last_price: row.last_price,
            last_quantity: row.last_quantity,
            total_quantity: row.total_quantity,
            orders_count: row.orders_count,
            last_order_id: row.last_order_id,
            last_sale_id: row.last_sale_id,
            last_purchasedAt: row.last_purchasedAt,
            source: row.source,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      upserted += 1;
    }
    return res.json({ ok: true, message: "Snapshot qayta qurildi.", customer_id: customerId, upserted, updatedAt: new Date() });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Snapshot rebuild xatolik", error: error.message });
  }
};
