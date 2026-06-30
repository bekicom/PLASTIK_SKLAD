const ExcelJS = require("exceljs");
const mongoose = require("mongoose");

const MarketplaceAccount = require("../modules/marketplace/MarketplaceAccount");
const MarketplaceCart = require("../modules/marketplace/MarketplaceCart");
const MarketplaceFavorite = require("../modules/marketplace/MarketplaceFavorite");
const MarketplacePreviousPurchaseSnapshot = require("../modules/marketplace/MarketplacePreviousPurchaseSnapshot");
const MarketplaceQuickReorderLog = require("../modules/marketplace/MarketplaceQuickReorderLog");
const MarketplaceAuditLog = require("../modules/marketplace/MarketplaceAuditLog");
const {
  MarketplaceCashbackTransaction,
  MarketplaceCashbackUseRequest,
  MarketplaceCashbackRule,
} = require("../modules/marketplace/MarketplaceCashback");
const MarketplaceReferral = require("../modules/marketplace/MarketplaceReferral");
const {
  MarketplaceNotificationCampaign,
  MarketplaceNotificationTemplate,
} = require("../modules/marketplace/MarketplaceNotification");
const {
  MarketplaceHomeBanner,
  MarketplaceHomeSection,
  MarketplacePromotion,
} = require("../modules/marketplace/MarketplaceHomeContent");
const {
  MarketplaceAnalyticsSnapshot,
  MarketplaceReportExportJob,
} = require("../modules/marketplace/MarketplaceAnalytics");
const marketplaceHomeController = require("./marketplaceHome.controller");
const {
  MarketplaceSetting,
  MarketplaceMinimalOrderRule,
} = require("../modules/marketplace/MarketplaceSettings");
const Customer = require("../modules/Customer/Customer");
const Order = require("../modules/orders/Order");
const Product = require("../modules/products/Product");
const User = require("../modules/Users/User");
const cashierOrderController = require("./cashierOrder.controller");

const ORDER_STATUS_MAP = {
  PENDING_ADMIN: "NEW",
  APPROVED: "CONFIRMED",
  COMPLETED: "CONFIRMED",
  CANCELED: "CANCELED",
  REJECTED: "CANCELED",
};

function actorId(req) {
  return req.user?._id || req.user?.id || req.userId || null;
}

function actorName(req) {
  return req.user?.name || req.user?.login || req.user?.phone || "";
}

function clean(value = "") {
  return String(value || "").trim();
}

function escapeRegex(value = "") {
  return clean(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pageParams(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function dateRange(query = {}) {
  const range = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      range.$gte = d;
    }
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      range.$lte = d;
    }
  }
  return Object.keys(range).length ? range : null;
}

function idOk(id) {
  return mongoose.isValidObjectId(id);
}

function adminError(res, error, status = 500, message = "Server xatosi") {
  const code = status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "ERROR";
  return res.status(status).json({
    ok: false,
    message: error?.message || message,
    code,
  });
}

async function writeAudit(req, action, entityType, entityId, oldValue, newValue, metadata = {}) {
  try {
    await MarketplaceAuditLog.create({
      actor_id: actorId(req),
      actor_name: actorName(req),
      action,
      entity_type: entityType,
      entity_id: idOk(entityId) ? entityId : null,
      old_value: oldValue || null,
      new_value: newValue || null,
      metadata,
    });
  } catch (error) {
    console.error("marketplace audit log error:", error.message);
  }
}

function maskToken(value = "") {
  const raw = clean(value);
  if (!raw) return "";
  if (raw.length <= 10) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 6)}***${raw.slice(-4)}`;
}

function accountSearchQuery(query = {}) {
  const filter = {};
  const status = clean(query.status).toUpperCase();
  if (["PENDING", "ACTIVE", "BLOCKED", "REJECTED"].includes(status)) filter.status = status;
  if (query.region) filter.region = { $regex: escapeRegex(query.region), $options: "i" };
  if (query.district) filter.district = { $regex: escapeRegex(query.district), $options: "i" };
  if (idOk(query.agent_id)) filter.agent_id = query.agent_id;
  if (idOk(query.customer_id)) filter.customer_id = query.customer_id;
  const createdAt = dateRange(query);
  if (createdAt) filter.createdAt = createdAt;
  if (query.q) {
    const rx = { $regex: escapeRegex(query.q), $options: "i" };
    filter.$or = [
      { name: rx },
      { phone: rx },
      { phone_normalized: rx },
      { additional_phone: rx },
      { region: rx },
      { district: rx },
      { address: rx },
      { referral_code: rx },
    ];
  }
  return filter;
}

function orderFilter(query = {}) {
  const filter = { source: "MOBILE" };
  const status = clean(query.status).toUpperCase();
  if (status && ORDER_STATUS_MAP[status]) filter.status = ORDER_STATUS_MAP[status];
  if (["NEW", "CONFIRMED", "CANCELED"].includes(status)) filter.status = status;
  if (idOk(query.customer_id)) filter.customer_id = query.customer_id;
  if (idOk(query.agent_id)) filter.agent_id = query.agent_id;
  const createdAt = dateRange(query);
  if (createdAt) filter.createdAt = createdAt;
  return filter;
}

function customerFilter(query = {}) {
  const filter = {};
  if (query.region) filter.region = { $regex: escapeRegex(query.region), $options: "i" };
  if (query.district) filter.district = { $regex: escapeRegex(query.district), $options: "i" };
  if (idOk(query.agent_id)) filter.agent_id = query.agent_id;
  if (query.status) filter.status = clean(query.status).toUpperCase();
  const createdAt = dateRange(query);
  if (createdAt) filter.createdAt = createdAt;
  return filter;
}

function matchCustomerLookupStages(query = {}) {
  const match = {};
  if (query.region) match["customer.region"] = { $regex: escapeRegex(query.region), $options: "i" };
  if (query.district) match["customer.district"] = { $regex: escapeRegex(query.district), $options: "i" };
  if (idOk(query.agent_id)) match["customer.agent_id"] = new mongoose.Types.ObjectId(query.agent_id);
  return Object.keys(match).length ? [{ $match: match }] : [];
}

async function responseWithExport(req, res, rows, filename, columns) {
  const format = clean(req.query.format || "json").toLowerCase();
  if (format === "csv") {
    const header = columns.map((c) => c.header).join(",");
    const body = rows.map((row) =>
      columns
        .map((c) => `"${String(c.value(row) ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send([header, ...body].join("\n"));
  }
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.header, width: c.width || 18 }));
    rows.forEach((row) => {
      const out = {};
      columns.forEach((c) => {
        out[c.header] = c.value(row);
      });
      sheet.addRow(out);
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  }
  return res.json({ ok: true, total: rows.length, items: rows });
}

exports.dashboardSummary = async (req, res) => {
  try {
    const createdAt = dateRange(req.query);
    const orderBase = { source: "MOBILE" };
    if (createdAt) orderBase.createdAt = createdAt;

    const [
      orderStatuses,
      customerStatuses,
      cashbackSummary,
      pendingCashbackRequests,
      referralStatuses,
      notificationTotals,
      recentAudit,
    ] = await Promise.all([
      Order.aggregate([
        { $match: orderBase },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            total_uzs: { $sum: "$total_uzs" },
            total_usd: { $sum: "$total_usd" },
          },
        },
      ]),
      MarketplaceAccount.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      MarketplaceCashbackTransaction.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        {
          $group: {
            _id: { currency: "$currency", status: "$status", type: "$type" },
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      MarketplaceCashbackUseRequest.aggregate([
        { $match: { status: "PENDING", ...(createdAt ? { createdAt } : {}) } },
        { $group: { _id: "$currency", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      MarketplaceReferral.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      MarketplaceNotificationCampaign.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        {
          $group: {
            _id: null,
            sent: { $sum: "$sent_count" },
            failed: { $sum: "$failed_count" },
            read: { $sum: "$read_count" },
            campaigns: { $sum: 1 },
          },
        },
      ]),
      MarketplaceAuditLog.find({ ...(createdAt ? { createdAt } : {}) })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const orders = {};
    let approvedTotals = { UZS: 0, USD: 0 };
    for (const row of orderStatuses) {
      orders[row._id] = { count: row.count, total_uzs: row.total_uzs, total_usd: row.total_usd };
      if (row._id === "CONFIRMED") {
        approvedTotals = { UZS: row.total_uzs || 0, USD: row.total_usd || 0 };
      }
    }

    const customers = {};
    customerStatuses.forEach((row) => {
      customers[row._id || "UNKNOWN"] = row.count;
    });

    const cashback = { UZS: {}, USD: {} };
    cashbackSummary.forEach((row) => {
      const currency = row._id.currency || "UZS";
      const key = row._id.status || row._id.type || "UNKNOWN";
      cashback[currency][key.toLowerCase()] = {
        amount: row.amount || 0,
        count: row.count || 0,
      };
    });
    pendingCashbackRequests.forEach((row) => {
      cashback[row._id || "UZS"].pending_use_requests = {
        amount: row.amount || 0,
        count: row.count || 0,
      };
    });

    return res.json({
      ok: true,
      orders,
      approved_sales_totals: approvedTotals,
      customers,
      cashback,
      referrals: referralStatuses.reduce((acc, row) => {
        acc[row._id || "UNKNOWN"] = row.count;
        return acc;
      }, {}),
      notifications: notificationTotals[0] || { sent: 0, failed: 0, read: 0, campaigns: 0 },
      recent_audit: recentAudit,
    });
  } catch (error) {
    return adminError(res, error, 500, "Dashboard ma'lumotlarini olishda xatolik");
  }
};

exports.topProducts = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const createdAt = dateRange(req.query);
    const rows = await Order.aggregate([
      { $match: { source: "MOBILE", ...(createdAt ? { createdAt } : {}) } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product_id",
          name: { $first: "$items.product_snapshot.name" },
          qty: { $sum: "$items.qty" },
          total_uzs: {
            $sum: { $cond: [{ $eq: ["$items.currency_snapshot", "UZS"] }, "$items.subtotal", 0] },
          },
          total_usd: {
            $sum: { $cond: [{ $eq: ["$items.currency_snapshot", "USD"] }, "$items.subtotal", 0] },
          },
        },
      },
      { $sort: { qty: -1 } },
      { $limit: limit },
    ]);
    return res.json({ ok: true, items: rows });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.topCustomers = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const createdAt = dateRange(req.query);
    const rows = await Order.aggregate([
      { $match: { source: "MOBILE", ...(createdAt ? { createdAt } : {}) } },
      {
        $group: {
          _id: "$customer_id",
          orders_count: { $sum: 1 },
          total_uzs: { $sum: "$total_uzs" },
          total_usd: { $sum: "$total_usd" },
        },
      },
      { $sort: { orders_count: -1, total_uzs: -1, total_usd: -1 } },
      { $limit: limit },
      { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "customer" } },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    ]);
    return res.json({ ok: true, items: rows });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.topAgents = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const rows = await MarketplaceAccount.aggregate([
      { $match: { agent_id: { $ne: null } } },
      { $group: { _id: "$agent_id", accounts_count: { $sum: 1 } } },
      { $sort: { accounts_count: -1 } },
      { $limit: limit },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "agent" } },
      { $unwind: { path: "$agent", preserveNullAndEmptyArrays: true } },
    ]);
    return res.json({ ok: true, items: rows });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.listCustomers = async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const filter = accountSearchQuery(req.query);
    const [total, items] = await Promise.all([
      MarketplaceAccount.countDocuments(filter),
      MarketplaceAccount.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("customer_id", "name phone additionalPhones region district address balance status isActive agent_id marketplace_meta")
        .populate("agent_id", "name phone login role")
        .lean(),
    ]);
    items.forEach((row) => {
      row.push_token_masked = maskToken(row.push_token);
      delete row.push_token;
    });
    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const { account_id } = req.params;
    if (!idOk(account_id)) return adminError(res, new Error("account_id noto'g'ri"), 400);
    const account = await MarketplaceAccount.findById(account_id)
      .populate("customer_id", "name phone additionalPhones region district address balance status isActive agent_id marketplace_meta")
      .populate("agent_id", "name phone login role")
      .lean();
    if (!account) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const customerId = account.customer_id?._id || account.customer_id;
    const [orders, favorites, previous, cashback] = await Promise.all([
      customerId
        ? Order.find({ customer_id: customerId, source: "MOBILE" }).sort({ createdAt: -1 }).limit(10).lean()
        : [],
      customerId ? MarketplaceFavorite.countDocuments({ customer_id: customerId, status: "ACTIVE" }) : 0,
      customerId
        ? MarketplacePreviousPurchaseSnapshot.find({ customer_id: customerId })
            .sort({ last_purchasedAt: -1 })
            .limit(10)
            .lean()
        : [],
      customerId ? buildCashbackBalance(customerId) : { UZS: {}, USD: {} },
    ]);
    account.push_token_masked = maskToken(account.push_token);
    delete account.push_token;
    return res.json({
      ok: true,
      account,
      summary: {
        balance: account.customer_id?.balance || { UZS: 0, USD: 0 },
        orders,
        favorites_count: favorites,
        previous_purchases: previous,
        cashback,
        referral_source: account.referral_code || "",
        notification: {
          device_id: account.device_id || "",
          push_token_masked: account.push_token_masked,
          last_seen_at: account.last_seen_at,
        },
      },
    });
  } catch (error) {
    return adminError(res, error);
  }
};

async function approveAccountCore(req, accountId, body = {}) {
  const account = await MarketplaceAccount.findById(accountId);
  if (!account) throw new Error("Marketplace account topilmadi");
  const oldValue = account.toObject();
  let customer = null;
  if (body.customer_id) {
    if (!idOk(body.customer_id)) throw new Error("customer_id noto'g'ri");
    customer = await Customer.findById(body.customer_id);
    if (!customer) throw new Error("Customer topilmadi");
  } else if (account.customer_id) {
    customer = await Customer.findById(account.customer_id);
  } else if (body.create_customer) {
    customer = await Customer.create({
      name: account.name || `Marketplace ${account.phone}`,
      phone: account.phone_normalized || account.phone,
      additionalPhones: account.additional_phone ? [account.additional_phone] : [],
      region: account.region || "",
      district: account.district || "",
      address: account.address || "",
      note: account.note || "",
      agent_id: account.agent_id || null,
      role: "MOBILE",
      status: "ACTIVE",
      registered_from: "MOBILE",
      isActive: true,
    });
  }
  if (!customer) throw new Error("Bog'lash uchun customer tanlang yoki yangi customer yarating");
  customer.status = customer.status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
  customer.isActive = customer.status !== "BLOCKED";
  customer.agent_id = account.agent_id || customer.agent_id || null;
  await customer.save();
  account.customer_id = customer._id;
  account.status = customer.status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
  account.approvedAt = new Date();
  account.approvedBy = actorId(req);
  account.linkedAt = new Date();
  account.linkedBy = actorId(req);
  await account.save();
  await writeAudit(req, "marketplace.customer.approve", "MarketplaceAccount", account._id, oldValue, account.toObject());
  return account;
}

exports.approveCustomer = async (req, res) => {
  try {
    const account = await approveAccountCore(req, req.params.account_id, req.body || {});
    return res.json({ ok: true, message: "Marketplace mijoz tasdiqlandi", account });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.linkCustomer = async (req, res) => {
  try {
    const account = await approveAccountCore(req, req.params.account_id, {
      ...(req.body || {}),
      create_customer: false,
    });
    await writeAudit(req, "marketplace.customer.link", "MarketplaceAccount", account._id, null, account.toObject());
    return res.json({ ok: true, message: "Customer bog'landi", account });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.setCustomerStatus = (status) => async (req, res) => {
  try {
    const account = await MarketplaceAccount.findById(req.params.account_id);
    if (!account) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = account.toObject();
    account.status = status === "UNBLOCK" ? (account.customer_id ? "ACTIVE" : "PENDING") : status;
    if (status === "BLOCKED") {
      account.blockedAt = new Date();
      account.blockedBy = actorId(req);
    }
    if (status === "REJECTED") {
      account.rejectedAt = new Date();
      account.rejectedBy = actorId(req);
      account.rejectReason = clean(req.body?.reason);
    }
    if (status === "UNBLOCK") {
      account.blockedAt = null;
      account.blockedBy = null;
    }
    await account.save();
    if (account.customer_id) {
      await Customer.findByIdAndUpdate(account.customer_id, {
        $set: {
          status: account.status === "BLOCKED" ? "BLOCKED" : "ACTIVE",
          isActive: account.status !== "BLOCKED",
        },
      });
    }
    await writeAudit(
      req,
      `marketplace.customer.${status.toLowerCase()}`,
      "MarketplaceAccount",
      account._id,
      oldValue,
      account.toObject(),
    );
    return res.json({ ok: true, account });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.assignAgent = async (req, res) => {
  try {
    const { agent_id } = req.body || {};
    if (agent_id && !idOk(agent_id)) return adminError(res, new Error("agent_id noto'g'ri"), 400);
    const agent = agent_id ? await User.findById(agent_id) : null;
    if (agent_id && !agent) return adminError(res, new Error("Agent topilmadi"), 404);
    const account = await MarketplaceAccount.findById(req.params.account_id);
    if (!account) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = account.toObject();
    account.agent_id = agent_id || null;
    await account.save();
    if (account.customer_id) await Customer.findByIdAndUpdate(account.customer_id, { $set: { agent_id: account.agent_id } });
    await writeAudit(req, "marketplace.customer.agent", "MarketplaceAccount", account._id, oldValue, account.toObject());
    return res.json({ ok: true, account });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.listOrders = async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const filter = orderFilter(req.query);
    const [total, items] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("customer_id", "name phone region district address balance")
        .populate("agent_id", "name phone login role")
        .populate("sale_id", "invoiceNo saleDate status")
        .lean(),
    ]);
    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customer_id", "name phone region district address balance")
      .populate("agent_id", "name phone login role")
      .populate("sale_id", "invoiceNo saleDate status totals currencyTotals")
      .lean();
    if (!order) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    return res.json({
      ok: true,
      order,
      related: {
        status_history: order.history || [],
        notification_history: [],
      },
    });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.updateOrderItem = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    if (order.status !== "NEW") return adminError(res, new Error("Faqat pending order itemlari tahrirlanadi"), 400);
    const oldValue = order.toObject();
    const item = (order.items || []).find(
      (it) => String(it._id || it.product_id) === String(req.params.item_id),
    );
    if (!item) return adminError(res, new Error("Order item topilmadi"), 404);
    const qty = Number(req.body?.qty ?? item.qty);
    const price = Number(req.body?.price_snapshot ?? item.price_snapshot);
    if (!qty || qty <= 0 || price < 0) return adminError(res, new Error("qty yoki price noto'g'ri"), 400);
    item.qty = qty;
    item.price_snapshot = price;
    item.subtotal = qty * price;
    order.editedAt = new Date();
    order.editedBy = actorId(req);
    order.editReason = clean(req.body?.reason);
    order.revision = Number(order.revision || 0) + 1;
    order.history.push({
      type: "EDITED",
      by: actorId(req),
      note: order.editReason || "Marketplace admin item edit",
      payload: { item_id: req.params.item_id, qty, price_snapshot: price },
    });
    await order.save();
    await writeAudit(req, "marketplace.order.item_edit", "Order", order._id, oldValue, order.toObject());
    return res.json({ ok: true, order });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.approveOrder = async (req, res) => {
  const order = await Order.findById(req.params.id).lean();
  if (!order) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
  if (order.sale_id || order.status === "CONFIRMED") {
    await writeAudit(req, "marketplace.order.approve.idempotent", "Order", order._id, order, order);
    return res.json({ ok: true, message: "Order avval tasdiqlangan", order });
  }
  const originalJson = res.json.bind(res);
  res.json = async (payload) => {
    if (payload?.ok) {
      await writeAudit(req, "marketplace.order.approve", "Order", req.params.id, order, payload);
    }
    return originalJson(payload);
  };
  return cashierOrderController.confirmOrder(req, res);
};

exports.rejectOrCancelOrder = (action) => async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    if (order.status === "CONFIRMED" && action !== "complete") {
      return adminError(res, new Error("Tasdiqlangan orderni reject/cancel qilib bo'lmaydi"), 400);
    }
    const oldValue = order.toObject();
    if (action === "complete") {
      if (order.status === "NEW") return exports.approveOrder(req, res);
      order.status = "CONFIRMED";
    } else {
      order.status = "CANCELED";
      order.canceledAt = new Date();
      order.canceledBy = actorId(req);
      order.cancelReason = clean(req.body?.reason);
    }
    order.history.push({
      type: action === "complete" ? "CONFIRMED" : "CANCELED",
      by: actorId(req),
      note: clean(req.body?.reason || action),
      payload: { action },
    });
    await order.save();
    await writeAudit(req, `marketplace.order.${action}`, "Order", order._id, oldValue, order.toObject());
    return res.json({ ok: true, order });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.orderEvents = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).select("history createdAt updatedAt").lean();
    if (!order) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const audit = await MarketplaceAuditLog.find({ entity_type: "Order", entity_id: req.params.id })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ ok: true, items: [...(order.history || []), ...audit] });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.listProducts = async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const filter = {};
    if (req.query.visible !== undefined && req.query.visible !== "") {
      filter.marketplace_visible = String(req.query.visible) === "true" || String(req.query.visible) === "1";
    }
    if (req.query.category_id || req.query.category) filter.category = { $regex: escapeRegex(req.query.category_id || req.query.category), $options: "i" };
    if (req.query.stock_status === "in_stock") filter.qty = { $gt: 0 };
    if (req.query.stock_status === "out") filter.qty = { $lte: 0 };
    if (req.query.q) {
      const rx = { $regex: escapeRegex(req.query.q), $options: "i" };
      filter.$or = [{ name: rx }, { code: rx }, { model: rx }, { color: rx }, { category: rx }];
    }
    const [total, items] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ marketplace_sort_order: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.updateProductMarketplace = async (req, res) => {
  try {
    const allowed = [
      "marketplace_visible",
      "marketplace_sort_order",
      "marketplace_recommended",
      "marketplace_new",
      "marketplace_top",
      "marketplace_promo",
      "min_order_qty",
      "step_qty",
    ];
    const patch = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) patch[key] = req.body[key];
    });
    const product = await Product.findById(req.params.id);
    if (!product) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = product.toObject();
    Object.assign(product, patch);
    await product.save();
    await writeAudit(req, "marketplace.product.update", "Product", product._id, oldValue, product.toObject());
    return res.json({ ok: true, product });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.updateProductImages = async (req, res) => {
  req.body = { images: req.body?.images || [] };
  return updateProductFields(req, res, ["images"], "marketplace.product.images");
};

exports.updateProductCategory = async (req, res) => updateProductFields(req, res, ["category"], "marketplace.product.category");
exports.updateProductSort = async (req, res) => updateProductFields(req, res, ["marketplace_sort_order"], "marketplace.product.sort");

async function updateProductFields(req, res, fields, action) {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = product.toObject();
    fields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) product[field] = req.body[field];
    });
    await product.save();
    await writeAudit(req, action, "Product", product._id, oldValue, product.toObject());
    return res.json({ ok: true, product });
  } catch (error) {
    return adminError(res, error, 400);
  }
}

exports.bulkUpdateProducts = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(idOk) : [];
    if (!ids.length) return adminError(res, new Error("ids bo'sh yoki noto'g'ri"), 400);
    const patch = req.body?.patch || {};
    const allowed = ["category", "marketplace_visible", "marketplace_sort_order", "marketplace_recommended", "marketplace_new", "marketplace_top", "marketplace_promo"];
    const safePatch = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) safePatch[key] = patch[key];
    });
    const result = await Product.updateMany({ _id: { $in: ids } }, { $set: safePatch });
    await writeAudit(req, "marketplace.product.bulk_update", "Product", null, null, { ids, patch: safePatch });
    return res.json({ ok: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

async function buildCashbackBalance(customerId) {
  const rows = await MarketplaceCashbackTransaction.aggregate([
    { $match: { customer_id: new mongoose.Types.ObjectId(customerId) } },
    {
      $group: {
        _id: { currency: "$currency", status: "$status", type: "$type" },
        amount: { $sum: "$amount" },
      },
    },
  ]);
  const out = { UZS: { confirmed: 0, pending: 0, used: 0, reversed: 0, available: 0 }, USD: { confirmed: 0, pending: 0, used: 0, reversed: 0, available: 0 } };
  rows.forEach((row) => {
    const cur = row._id.currency || "UZS";
    const amount = Number(row.amount || 0);
    if (row._id.status === "CONFIRMED") out[cur].confirmed += amount;
    if (row._id.status === "PENDING") out[cur].pending += amount;
    if (row._id.status === "USED" || row._id.type === "USED") out[cur].used += Math.abs(amount);
    if (row._id.status === "REVERSED" || row._id.type === "REVERSED") out[cur].reversed += Math.abs(amount);
  });
  for (const cur of ["UZS", "USD"]) {
    out[cur].available = out[cur].confirmed - out[cur].used - out[cur].reversed;
  }
  return out;
}

async function resolveCashbackCustomerContext(req) {
  const customerId = req.params?.customer_id || req.query?.customer_id || req.marketplaceAuth?.customer_id || req.mobileCustomer?._id || null;
  const accountId = req.marketplaceAuth?.account_id || req.mobileAccount?._id || null;

  if (customerId && idOk(customerId)) {
    const customer = await Customer.findById(customerId).lean();
    if (customer) {
      const account = await MarketplaceAccount.findOne({
        $or: [
          { customer_id: customer._id },
          ...(accountId && idOk(accountId) ? [{ _id: accountId }] : []),
        ],
      }).lean();
      return { customer, account };
    }
  }

  if (accountId && idOk(accountId)) {
    const account = await MarketplaceAccount.findById(accountId).lean();
    if (account?.customer_id) {
      const customer = await Customer.findById(account.customer_id).lean();
      return { customer, account };
    }
    return { customer: null, account };
  }

  return { customer: null, account: null };
}

exports.cashbackSummary = async (req, res) => {
  try {
    const createdAt = dateRange(req.query);
    const isAdminRoute = String(req.path || "").startsWith("/admin/");

    if (!isAdminRoute) {
      const { customer, account } = await resolveCashbackCustomerContext(req);
      if (!customer) {
        return res.json({ ok: true, items: [], summary: { UZS: { confirmed: 0, pending: 0, used: 0, reversed: 0, available: 0 }, USD: { confirmed: 0, pending: 0, used: 0, reversed: 0, available: 0 } } });
      }

      const match = { customer_id: customer._id };
      if (createdAt) match.createdAt = createdAt;

      const rows = await MarketplaceCashbackTransaction.aggregate([
        { $match: match },
        { $group: { _id: { currency: "$currency", status: "$status", type: "$type" }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]);
      const summary = await buildCashbackBalance(customer._id);
      return res.json({
        ok: true,
        customer_id: customer._id,
        account_id: account?._id || null,
        items: rows,
        summary,
      });
    }

    const rows = await MarketplaceCashbackTransaction.aggregate([
      ...(createdAt ? [{ $match: { createdAt } }] : []),
      { $group: { _id: { currency: "$currency", status: "$status", type: "$type" }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);
    return res.json({ ok: true, items: rows });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.cashbackCustomers = async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const filter = {};
    if (idOk(req.query.agent_id)) filter.agent_id = req.query.agent_id;
    if (req.query.region) filter.region = { $regex: escapeRegex(req.query.region), $options: "i" };
    if (req.query.district) filter.district = { $regex: escapeRegex(req.query.district), $options: "i" };
    if (req.query.q) {
      const rx = { $regex: escapeRegex(req.query.q), $options: "i" };
      filter.$or = [{ name: rx }, { phone: rx }, { phone_normalized: rx }];
    }
    const [total, accounts] = await Promise.all([
      MarketplaceAccount.countDocuments(filter),
      MarketplaceAccount.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("agent_id", "name phone login").lean(),
    ]);
    const balances = await Promise.all(
      accounts.map((a) => (a.customer_id ? buildCashbackBalance(a.customer_id) : Promise.resolve({ UZS: {}, USD: {} }))),
    );
    const items = accounts.map((a, index) => ({ ...a, cashback: balances[index] }));
    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.cashbackCustomerDetail = async (req, res) => {
  try {
    const customerId = req.params.customer_id;
    if (!idOk(customerId)) return adminError(res, new Error("customer_id noto'g'ri"), 400);
    const [customer, account, balance] = await Promise.all([
      Customer.findById(customerId).lean(),
      MarketplaceAccount.findOne({ customer_id: customerId }).lean(),
      buildCashbackBalance(customerId),
    ]);
    if (!customer) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    return res.json({ ok: true, customer, account, cashback: balance });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.cashbackHistory = async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const { customer, account } = await resolveCashbackCustomerContext(req);
    if (!customer) {
      return adminError(res, new Error("customer_id noto'g'ri"), 400);
    }
    const filter = { customer_id: customer._id };
    if (req.query.currency) filter.currency = clean(req.query.currency).toUpperCase();
    const [total, items] = await Promise.all([
      MarketplaceCashbackTransaction.countDocuments(filter),
      MarketplaceCashbackTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    return res.json({ ok: true, page, limit, total, items, customer_id: customer._id, account_id: account?._id || null });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.cashbackUseRequests = async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const filter = {};
    if (req.query.status) filter.status = clean(req.query.status).toUpperCase();
    if (idOk(req.query.customer_id)) filter.customer_id = req.query.customer_id;
    if (idOk(req.query.agent_id)) filter.agent_id = req.query.agent_id;
    if (req.query.currency) filter.currency = clean(req.query.currency).toUpperCase();
    const [total, items] = await Promise.all([
      MarketplaceCashbackUseRequest.countDocuments(filter),
      MarketplaceCashbackUseRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("customer_id", "name phone region district")
        .populate("agent_id", "name phone login")
        .lean(),
    ]);
    return res.json({ ok: true, page, limit, total, items });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.reviewCashbackUseRequest = (status) => async (req, res) => {
  try {
    const request = await MarketplaceCashbackUseRequest.findById(req.params.id);
    if (!request) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = request.toObject();
    request.status = status;
    request.reviewedAt = new Date();
    request.reviewedBy = actorId(req);
    request.admin_note = clean(req.body?.admin_note);
    request.reason = clean(req.body?.reason);
    if (status === "APPROVED" && !request.transaction_id) {
      const tx = await MarketplaceCashbackTransaction.create({
        customer_id: request.customer_id,
        account_id: request.account_id,
        currency: request.currency,
        amount: -Math.abs(Number(request.amount || 0)),
        type: "USED",
        status: "USED",
        note: request.admin_note || "Cashback use request approved",
      });
      request.transaction_id = tx._id;
    }
    await request.save();
    await writeAudit(req, `marketplace.cashback.use_request.${status.toLowerCase()}`, "MarketplaceCashbackUseRequest", request._id, oldValue, request.toObject());
    return res.json({ ok: true, request });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.listCashbackRules = async (req, res) => res.json({ ok: true, items: await MarketplaceCashbackRule.find().sort({ createdAt: -1 }).lean() });
exports.createCashbackRule = async (req, res) => createDoc(req, res, MarketplaceCashbackRule, "MarketplaceCashbackRule", "marketplace.cashback.rule.create");
exports.updateCashbackRule = async (req, res) => updateDoc(req, res, MarketplaceCashbackRule, "MarketplaceCashbackRule", "marketplace.cashback.rule.update");
exports.deleteCashbackRule = async (req, res) => deleteDoc(req, res, MarketplaceCashbackRule, "MarketplaceCashbackRule", "marketplace.cashback.rule.delete");

exports.listReferrals = async (req, res) => listModel(req, res, MarketplaceReferral, referralFilter(req.query), ["agent_id", "customer_id", "account_id"]);
exports.reviewReferral = (status) => async (req, res) => {
  try {
    const referral = await MarketplaceReferral.findById(req.params.id);
    if (!referral) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = referral.toObject();
    referral.status = status;
    referral.reason = clean(req.body?.reason);
    referral.reviewedAt = new Date();
    referral.reviewedBy = actorId(req);
    await referral.save();
    await writeAudit(req, `marketplace.referral.${status.toLowerCase()}`, "MarketplaceReferral", referral._id, oldValue, referral.toObject());
    return res.json({ ok: true, referral });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

function referralFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = clean(query.status).toUpperCase();
  if (idOk(query.agent_id)) filter.agent_id = query.agent_id;
  if (idOk(query.customer_id)) filter.customer_id = query.customer_id;
  if (query.phone) filter.phone_normalized = { $regex: escapeRegex(query.phone), $options: "i" };
  const createdAt = dateRange(query);
  if (createdAt) filter.createdAt = createdAt;
  return filter;
}

exports.agentReferralCodes = async (req, res) => {
  const agents = await User.find({ role: "AGENT" }).select("_id name phone login role").lean();
  const settings = await MarketplaceSetting.find({
    key: { $in: agents.map((agent) => `agent_referral_code:${agent._id}`) },
  }).lean();
  const codeMap = new Map(settings.map((setting) => [setting.key, setting.value?.code || ""]));
  const items = agents.map((agent) => ({
    ...agent,
    referral_code: codeMap.get(`agent_referral_code:${agent._id}`) || agent.login || String(agent._id),
    qr_link: `${process.env.MARKETPLACE_DEEP_LINK_BASE || "becoplast://register"}?agent_id=${agent._id}`,
  }));
  return res.json({ ok: true, items });
};

exports.updateAgentReferralCode = async (req, res) => {
  try {
    const agent = await User.findById(req.params.id);
    if (!agent) return adminError(res, new Error("Agent topilmadi"), 404);
    const key = `agent_referral_code:${agent._id}`;
    const oldValue = await MarketplaceSetting.findOne({ key }).lean();
    const code = clean(req.body?.referral_code || req.body?.code || agent.login || String(agent._id));
    const setting = await MarketplaceSetting.findOneAndUpdate(
      { key },
      { $set: { value: { code }, updatedBy: actorId(req) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await writeAudit(req, "marketplace.agent.referral_code", "User", agent._id, oldValue, {
      agent_id: agent._id,
      referral_code: code,
    });
    return res.json({ ok: true, agent, referral_code: setting.value.code });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.referralStats = async (req, res) => {
  const filter = referralFilter(req.query);
  const rows = await MarketplaceReferral.aggregate([{ $match: filter }, { $group: { _id: { agent_id: "$agent_id", status: "$status" }, count: { $sum: 1 } } }]);
  return res.json({ ok: true, items: rows });
};

exports.listCampaigns = async (req, res) => listModel(req, res, MarketplaceNotificationCampaign, {}, []);
exports.createCampaign = async (req, res) => createDoc(req, res, MarketplaceNotificationCampaign, "MarketplaceNotificationCampaign", "marketplace.notification.campaign.create");
exports.getCampaign = async (req, res) => getDoc(req, res, MarketplaceNotificationCampaign);
exports.updateCampaign = async (req, res) => updateDoc(req, res, MarketplaceNotificationCampaign, "MarketplaceNotificationCampaign", "marketplace.notification.campaign.update");
exports.sendCampaign = async (req, res) => {
  try {
    const campaign = await MarketplaceNotificationCampaign.findById(req.params.id);
    if (!campaign) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = campaign.toObject();
    const target = campaign.target || {};
    const accountFilter = accountSearchQuery(target);
    const targets = await MarketplaceAccount.find({ ...accountFilter, status: { $ne: "BLOCKED" } }).select("_id push_token").lean();
    campaign.total_targets = targets.length;
    campaign.sent_count = targets.filter((x) => x.push_token).length;
    campaign.failed_count = targets.filter((x) => !x.push_token).length;
    campaign.status = "SENT";
    campaign.sentAt = new Date();
    await campaign.save();
    await writeAudit(req, "marketplace.notification.campaign.send", "MarketplaceNotificationCampaign", campaign._id, oldValue, campaign.toObject());
    return res.json({ ok: true, campaign });
  } catch (error) {
    return adminError(res, error, 400);
  }
};
exports.cancelCampaign = async (req, res) => {
  req.body = { ...(req.body || {}), status: "CANCELED", canceledAt: new Date() };
  return updateDoc(req, res, MarketplaceNotificationCampaign, "MarketplaceNotificationCampaign", "marketplace.notification.campaign.cancel");
};
exports.listTemplates = async (req, res) => listModel(req, res, MarketplaceNotificationTemplate, {}, []);
exports.createTemplate = async (req, res) => createDoc(req, res, MarketplaceNotificationTemplate, "MarketplaceNotificationTemplate", "marketplace.notification.template.create");
exports.updateTemplate = async (req, res) => updateDoc(req, res, MarketplaceNotificationTemplate, "MarketplaceNotificationTemplate", "marketplace.notification.template.update");
exports.notificationStats = async (req, res) => {
  const rows = await MarketplaceNotificationCampaign.aggregate([{ $group: { _id: "$status", total_targets: { $sum: "$total_targets" }, sent: { $sum: "$sent_count" }, failed: { $sum: "$failed_count" }, read: { $sum: "$read_count" }, count: { $sum: 1 } } }]);
  return res.json({ ok: true, items: rows });
};

exports.listBanners = async (req, res) => listModel(req, res, MarketplaceHomeBanner, {}, []);
exports.createBanner = async (req, res) => createHomeDoc(req, res, MarketplaceHomeBanner, "MarketplaceHomeBanner", "marketplace.home.banner.create");
exports.updateBanner = async (req, res) => updateHomeDoc(req, res, MarketplaceHomeBanner, "MarketplaceHomeBanner", "marketplace.home.banner.update");
exports.deleteBanner = async (req, res) => deleteDoc(req, res, MarketplaceHomeBanner, "MarketplaceHomeBanner", "marketplace.home.banner.delete");
exports.listSections = async (req, res) => listModel(req, res, MarketplaceHomeSection, {}, []);
exports.createSection = async (req, res) => createHomeDoc(req, res, MarketplaceHomeSection, "MarketplaceHomeSection", "marketplace.home.section.create");
exports.updateSection = async (req, res) => updateHomeDoc(req, res, MarketplaceHomeSection, "MarketplaceHomeSection", "marketplace.home.section.update");
exports.deleteSection = async (req, res) => deleteDoc(req, res, MarketplaceHomeSection, "MarketplaceHomeSection", "marketplace.home.section.delete");
exports.listPromotions = async (req, res) => listModel(req, res, MarketplacePromotion, {}, []);
exports.createPromotion = async (req, res) => createHomeDoc(req, res, MarketplacePromotion, "MarketplacePromotion", "marketplace.promotion.create");
exports.updatePromotion = async (req, res) => updateHomeDoc(req, res, MarketplacePromotion, "MarketplacePromotion", "marketplace.promotion.update");
exports.deletePromotion = async (req, res) => deleteDoc(req, res, MarketplacePromotion, "MarketplacePromotion", "marketplace.promotion.delete");

async function validateVisibleProducts(productIds = []) {
  const ids = (productIds || []).filter(idOk);
  if (!ids.length) return;
  const hidden = await Product.find({
    _id: { $in: ids },
    $or: [{ marketplace_visible: false }, { isActive: false }],
  }).select("_id name").lean();
  if (hidden.length) throw new Error("marketplace_visible=false mahsulot banner/aksiyaga bog'lanmaydi");
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateDateOrder(body = {}) {
  const from = parseDateValue(body.valid_from);
  const to = parseDateValue(body.valid_to);
  if (from && to && to < from) throw new Error("valid_to valid_fromdan oldin bo'lmasin");
}

function externalLinkAllowed(url = "") {
  const raw = clean(url);
  if (!raw) return true;
  const whitelist = String(process.env.MARKETPLACE_EXTERNAL_LINK_WHITELIST || "")
    .split(",")
    .map((x) => clean(x).toLowerCase())
    .filter(Boolean);
  if (!whitelist.length) return true;
  try {
    const parsed = new URL(raw);
    return whitelist.includes(parsed.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

async function validateHomePayload(body = {}, mode = "save") {
  validateDateOrder(body);
  const priority = body.priority ?? body.sort_order;
  if (priority !== undefined && Number(priority) < 0) throw new Error("priority/sort_order manfiy bo'lmasin");
  if (body.max_items !== undefined && Number(body.max_items) > 50) {
    throw new Error("max_items 50 dan oshmasin");
  }

  const actionType = clean(body.action_type).toUpperCase();
  const payload = body.action_payload || {};
  if (actionType === "PRODUCT") {
    const productId = payload.product_id || body.product_id || body.product_ids?.[0];
    if (!idOk(productId)) throw new Error("PRODUCT action uchun product_id majburiy");
    await validateVisibleProducts([productId]);
  }
  if (actionType === "CATEGORY" && !clean(payload.category_id || body.category || body.category_id)) {
    throw new Error("CATEGORY action uchun category_id yoki category majburiy");
  }
  if (actionType === "EXTERNAL_LINK" && !externalLinkAllowed(payload.url || body.target_url)) {
    throw new Error("External link whitelistdan o'tmadi");
  }
  if (mode === "publish") {
    const image = clean(body.image_url || body.image || body.mobile_image_url);
    if (Object.prototype.hasOwnProperty.call(body, "title") && !clean(body.title)) {
      throw new Error("Publish uchun title majburiy");
    }
    if (Object.prototype.hasOwnProperty.call(body, "image_url") && !image) {
      throw new Error("Publish uchun image_url majburiy");
    }
  }
  await validateVisibleProducts(body.product_ids || []);
}

async function createHomeDoc(req, res, Model, entityType, action) {
  try {
    await validateHomePayload(req.body || {});
    req.body = { ...(req.body || {}), createdBy: actorId(req), updatedBy: actorId(req) };
    return createDoc(req, res, Model, entityType, action);
  } catch (error) {
    return adminError(res, error, 400);
  }
}

async function updateHomeDoc(req, res, Model, entityType, action) {
  try {
    await validateHomePayload(req.body || {});
    req.body = { ...(req.body || {}), updatedBy: actorId(req) };
    return updateDoc(req, res, Model, entityType, action);
  } catch (error) {
    return adminError(res, error, 400);
  }
}

exports.getBanner = async (req, res) => getDoc(req, res, MarketplaceHomeBanner);
exports.publishBanner = async (req, res) =>
  publishHomeDoc(req, res, MarketplaceHomeBanner, "MarketplaceHomeBanner", "marketplace.home.banner.publish", {
    status: "PUBLISHED",
    active: true,
  });
exports.disableBanner = async (req, res) =>
  publishHomeDoc(req, res, MarketplaceHomeBanner, "MarketplaceHomeBanner", "marketplace.home.banner.disable", {
    status: "DISABLED",
    active: false,
  });

exports.reorderSections = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const ops = items
      .filter((x) => idOk(x.id))
      .map((x) => ({
        updateOne: {
          filter: { _id: x.id },
          update: { $set: { sort_order: Math.max(Number(x.sort_order) || 0, 0), updatedBy: actorId(req) } },
        },
      }));
    if (!ops.length) return adminError(res, new Error("items bo'sh yoki noto'g'ri"), 400);
    const result = await MarketplaceHomeSection.bulkWrite(ops);
    await writeAudit(req, "marketplace.home.section.reorder", "MarketplaceHomeSection", null, null, { items });
    return res.json({ ok: true, modified: result.modifiedCount });
  } catch (error) {
    return adminError(res, error, 400);
  }
};
exports.publishSection = async (req, res) =>
  publishHomeDoc(req, res, MarketplaceHomeSection, "MarketplaceHomeSection", "marketplace.home.section.publish", {
    status: "PUBLISHED",
    active: true,
  });
exports.disableSection = async (req, res) =>
  publishHomeDoc(req, res, MarketplaceHomeSection, "MarketplaceHomeSection", "marketplace.home.section.disable", {
    status: "DISABLED",
    active: false,
  });
exports.activatePromotion = async (req, res) =>
  publishHomeDoc(req, res, MarketplacePromotion, "MarketplacePromotion", "marketplace.promotion.activate", {
    status: "ACTIVE",
    active: true,
  });
exports.disablePromotion = async (req, res) =>
  publishHomeDoc(req, res, MarketplacePromotion, "MarketplacePromotion", "marketplace.promotion.disable", {
    status: "DISABLED",
    active: false,
  });

async function publishHomeDoc(req, res, Model, entityType, action, patch) {
  try {
    const doc = await Model.findById(req.params.id);
    if (!doc) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = doc.toObject();
    await validateHomePayload(doc.toObject(), patch.status === "PUBLISHED" || patch.status === "ACTIVE" ? "publish" : "save");
    Object.assign(doc, patch, {
      updatedBy: actorId(req),
      publishedAt: patch.active ? new Date() : doc.publishedAt,
      publishedBy: patch.active ? actorId(req) : doc.publishedBy,
    });
    await doc.save();
    await writeAudit(req, action, entityType, doc._id, oldValue, doc.toObject());
    return res.json({ ok: true, item: doc });
  } catch (error) {
    return adminError(res, error, 400);
  }
}

exports.homePreview = async (req, res) => {
  try {
    req.query = { ...(req.query || {}), ...(req.body || {}) };
    const data = await marketplaceHomeController._internal.getVisibleContent(req);
    const diagnostics = {
      context: data.context
        ? {
            region: data.context.region,
            district: data.context.district,
            status: data.context.status,
            platform: data.context.platform,
          }
        : {},
      visible_counts: {
        banners: data.banners.length,
        sections: data.sections.length,
        promotions: data.promotions.length,
      },
    };
    return res.json({
      ok: true,
      banners: data.banners,
      sections: data.sections,
      promotions: data.promotions,
      diagnostics,
    });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.homeStats = async (req, res) => {
  try {
    const now = new Date();
    const [banners, sections, promotions, hiddenLinkedProducts] = await Promise.all([
      MarketplaceHomeBanner.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      MarketplaceHomeSection.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      MarketplacePromotion.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Product.countDocuments({ marketplace_visible: false, isActive: { $ne: false } }),
    ]);
    const expired = {
      banners: await MarketplaceHomeBanner.countDocuments({ valid_to: { $lt: now } }),
      sections: await MarketplaceHomeSection.countDocuments({ valid_to: { $lt: now } }),
      promotions: await MarketplacePromotion.countDocuments({ valid_to: { $lt: now } }),
    };
    return res.json({
      ok: true,
      banners,
      sections,
      promotions,
      expired,
      diagnostics: {
        hidden_marketplace_products: hiddenLinkedProducts,
      },
    });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.getGeneralSettings = async (req, res) => getSetting(res, "general");
exports.patchGeneralSettings = async (req, res) => patchSetting(req, res, "general");
exports.getRegionSettings = async (req, res) => getSetting(res, "regions", []);
exports.patchRegionSettings = async (req, res) => patchSetting(req, res, `region:${req.params.id}`);
exports.listMinimalOrderRules = async (req, res) => listModel(req, res, MarketplaceMinimalOrderRule, {}, []);
exports.createMinimalOrderRule = async (req, res) => createDoc(req, res, MarketplaceMinimalOrderRule, "MarketplaceMinimalOrderRule", "marketplace.settings.minimal_order.create");
exports.updateMinimalOrderRule = async (req, res) => updateDoc(req, res, MarketplaceMinimalOrderRule, "MarketplaceMinimalOrderRule", "marketplace.settings.minimal_order.update");
exports.deleteMinimalOrderRule = async (req, res) => deleteDoc(req, res, MarketplaceMinimalOrderRule, "MarketplaceMinimalOrderRule", "marketplace.settings.minimal_order.delete");
exports.getCreditLimit = async (req, res) => getSetting(res, `credit_limit:${req.params.customer_id}`, { UZS: 0, USD: 0 });
exports.patchCreditLimit = async (req, res) => patchSetting(req, res, `credit_limit:${req.params.customer_id}`);
exports.getPaymentMethods = async (req, res) => getSetting(res, "payment_methods", ["NASIYA", "CASH_ON_DELIVERY", "BANK_TRANSFER", "CARD"]);
exports.patchPaymentMethods = async (req, res) => patchSetting(req, res, "payment_methods");

async function getSetting(res, key, fallback = {}) {
  const setting = await MarketplaceSetting.findOne({ key }).lean();
  return res.json({ ok: true, key, value: setting?.value ?? fallback });
}

async function patchSetting(req, res, key) {
  const oldValue = await MarketplaceSetting.findOne({ key }).lean();
  const setting = await MarketplaceSetting.findOneAndUpdate(
    { key },
    { $set: { value: req.body?.value ?? req.body ?? {}, updatedBy: actorId(req) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await writeAudit(req, "marketplace.settings.update", "MarketplaceSetting", setting._id, oldValue, setting.toObject());
  return res.json({ ok: true, key, value: setting.value });
}

exports.favoritesStats = async (req, res) => listModel(req, res, MarketplaceFavorite, { status: "ACTIVE" }, ["account_id", "customer_id", "product_id"]);
exports.reorderStats = async (req, res) => listModel(req, res, MarketplaceQuickReorderLog, {}, ["account_id", "customer_id"]);
exports.customerFavoritesSummary = async (req, res) => {
  const customerId = req.params.customer_id;
  const [favorites_count, last_reorder] = await Promise.all([
    MarketplaceFavorite.countDocuments({ customer_id: customerId, status: "ACTIVE" }),
    MarketplaceQuickReorderLog.findOne({ customer_id: customerId }).sort({ createdAt: -1 }).lean(),
  ]);
  return res.json({ ok: true, favorites_count, last_reorder_at: last_reorder?.createdAt || null });
};

exports.reportOrders = async (req, res) => {
  const rows = await Order.find(orderFilter(req.query)).populate("customer_id", "name phone region district").populate("agent_id", "name phone login").lean();
  return responseWithExport(req, res, rows, "marketplace-orders", [
    { header: "date", value: (r) => r.createdAt },
    { header: "status", value: (r) => r.status },
    { header: "customer", value: (r) => r.customer_id?.name },
    { header: "phone", value: (r) => r.customer_id?.phone },
    { header: "agent", value: (r) => r.agent_id?.name },
    { header: "total_uzs", value: (r) => r.total_uzs },
    { header: "total_usd", value: (r) => r.total_usd },
  ]);
};

exports.reportCashback = async (req, res) => responseWithExport(req, res, await MarketplaceCashbackTransaction.find().populate("customer_id", "name phone").lean(), "marketplace-cashback", [
  { header: "date", value: (r) => r.createdAt },
  { header: "customer", value: (r) => r.customer_id?.name },
  { header: "currency", value: (r) => r.currency },
  { header: "amount", value: (r) => r.amount },
  { header: "type", value: (r) => r.type },
  { header: "status", value: (r) => r.status },
]);
exports.reportReferrals = async (req, res) => responseWithExport(req, res, await MarketplaceReferral.find(referralFilter(req.query)).populate("agent_id", "name login").populate("customer_id", "name phone").lean(), "marketplace-referrals", [
  { header: "date", value: (r) => r.createdAt },
  { header: "agent", value: (r) => r.agent_id?.name },
  { header: "customer", value: (r) => r.customer_id?.name },
  { header: "phone", value: (r) => r.phone },
  { header: "status", value: (r) => r.status },
]);
exports.reportNotifications = async (req, res) => responseWithExport(req, res, await MarketplaceNotificationCampaign.find().lean(), "marketplace-notifications", [
  { header: "date", value: (r) => r.createdAt },
  { header: "title", value: (r) => r.title },
  { header: "status", value: (r) => r.status },
  { header: "targets", value: (r) => r.total_targets },
  { header: "sent", value: (r) => r.sent_count },
  { header: "failed", value: (r) => r.failed_count },
  { header: "read", value: (r) => r.read_count },
]);
exports.reportProducts = async (req, res) => responseWithExport(req, res, await Product.find({ marketplace_visible: true }).lean(), "marketplace-products", [
  { header: "name", value: (r) => r.name },
  { header: "code", value: (r) => r.code },
  { header: "category", value: (r) => r.category },
  { header: "qty", value: (r) => r.qty },
  { header: "currency", value: (r) => r.warehouse_currency },
  { header: "price", value: (r) => r.sell_price },
]);

exports.auditLog = async (req, res) => {
  const filter = {};
  if (req.query.action) filter.action = { $regex: escapeRegex(req.query.action), $options: "i" };
  if (req.query.entity_type) filter.entity_type = clean(req.query.entity_type);
  if (idOk(req.query.actor_id)) filter.actor_id = req.query.actor_id;
  const createdAt = dateRange(req.query);
  if (createdAt) filter.createdAt = createdAt;
  return listModel(req, res, MarketplaceAuditLog, filter, []);
};

exports.auditLogDetail = async (req, res) => getDoc(req, res, MarketplaceAuditLog);

async function listModel(req, res, Model, filter = {}, populate = []) {
  const { page, limit, skip } = pageParams(req.query);
  let q = Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  populate.forEach((p) => {
    q = q.populate(p);
  });
  const [total, items] = await Promise.all([Model.countDocuments(filter), q.lean()]);
  return res.json({ ok: true, page, limit, total, items });
}

async function getDoc(req, res, Model) {
  const doc = await Model.findById(req.params.id).lean();
  if (!doc) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
  return res.json({ ok: true, item: doc });
}

async function createDoc(req, res, Model, entityType, action) {
  try {
    const doc = await Model.create(req.body || {});
    await writeAudit(req, action, entityType, doc._id, null, doc.toObject());
    return res.status(201).json({ ok: true, item: doc });
  } catch (error) {
    return adminError(res, error, 400);
  }
}

async function updateDoc(req, res, Model, entityType, action) {
  try {
    const doc = await Model.findById(req.params.id);
    if (!doc) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    const oldValue = doc.toObject();
    Object.assign(doc, req.body || {});
    await doc.save();
    await writeAudit(req, action, entityType, doc._id, oldValue, doc.toObject());
    return res.json({ ok: true, item: doc });
  } catch (error) {
    return adminError(res, error, 400);
  }
}

async function deleteDoc(req, res, Model, entityType, action) {
  try {
    const doc = await Model.findByIdAndDelete(req.params.id);
    if (!doc) return adminError(res, new Error("Ma'lumot topilmadi yoki o'chirilgan."), 404);
    await writeAudit(req, action, entityType, doc._id, doc.toObject(), null);
    return res.json({ ok: true, deleted: true });
  } catch (error) {
    return adminError(res, error, 400);
  }
}

exports.analyticsOverview = async (req, res) => {
  try {
    const createdAt = dateRange(req.query);
    const orderMatch = { source: "MOBILE", ...(createdAt ? { createdAt } : {}) };
    const accountMatch = { ...(createdAt ? { createdAt } : {}) };
    const [
      orderRows,
      salesRows,
      customerRows,
      cashbackRows,
      referralRows,
      notificationRows,
      snapshot,
    ] = await Promise.all([
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: "$status", count: { $sum: 1 }, total_uzs: { $sum: "$total_uzs" }, total_usd: { $sum: "$total_usd" } } },
      ]),
      Order.aggregate([
        { $match: { ...orderMatch, sale_id: { $ne: null } } },
        { $group: { _id: null, uzs: { $sum: "$total_uzs" }, usd: { $sum: "$total_usd" }, orders: { $sum: 1 } } },
      ]),
      MarketplaceAccount.aggregate([
        { $match: accountMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      MarketplaceCashbackTransaction.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        { $group: { _id: { currency: "$currency", status: "$status", type: "$type" }, amount: { $sum: "$amount" } } },
      ]),
      MarketplaceReferral.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      MarketplaceNotificationCampaign.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        { $group: { _id: null, sent: { $sum: "$sent_count" }, failed: { $sum: "$failed_count" }, read: { $sum: "$read_count" }, campaigns: { $sum: 1 } } },
      ]),
      MarketplaceAnalyticsSnapshot.findOne({ period: clean(req.query.period || "monthly") }).sort({ date: -1 }).lean(),
    ]);

    const orders = { total: 0, pending: 0, approved: 0, completed: 0, rejected: 0, canceled: 0 };
    orderRows.forEach((row) => {
      orders.total += row.count;
      if (row._id === "NEW") orders.pending += row.count;
      if (row._id === "CONFIRMED") {
        orders.approved += row.count;
        orders.completed += row.count;
      }
      if (row._id === "CANCELED") orders.canceled += row.count;
    });

    const customers = { new: 0, active: 0, pending: 0, blocked: 0, rejected: 0 };
    customerRows.forEach((row) => {
      customers.new += row.count;
      customers[String(row._id || "").toLowerCase()] = row.count;
    });

    const cashback = { UZS: { earned: 0, used: 0, pending: 0, reversed: 0, available: 0 }, USD: { earned: 0, used: 0, pending: 0, reversed: 0, available: 0 } };
    cashbackRows.forEach((row) => {
      const cur = row._id.currency || "UZS";
      const amount = Number(row.amount || 0);
      if (row._id.status === "CONFIRMED" || row._id.type === "EARNED") cashback[cur].earned += Math.abs(amount);
      if (row._id.status === "USED" || row._id.type === "USED") cashback[cur].used += Math.abs(amount);
      if (row._id.status === "PENDING" || row._id.type === "PENDING") cashback[cur].pending += Math.abs(amount);
      if (row._id.status === "REVERSED" || row._id.type === "REVERSED") cashback[cur].reversed += Math.abs(amount);
    });
    for (const cur of ["UZS", "USD"]) cashback[cur].available = cashback[cur].earned - cashback[cur].used - cashback[cur].reversed;

    const referrals = { registrations: 0, linked: 0, pending_review: 0, rejected: 0 };
    referralRows.forEach((row) => {
      referrals.registrations += row.count;
      if (row._id === "LINKED_TO_CUSTOMER") referrals.linked += row.count;
      if (["PENDING", "NEEDS_ADMIN_REVIEW"].includes(row._id)) referrals.pending_review += row.count;
      if (row._id === "REJECTED") referrals.rejected += row.count;
    });

    return res.json({
      ok: true,
      period: { from: req.query.from || null, to: req.query.to || null },
      source: snapshot ? "live_query_with_snapshot_available" : "live_query",
      orders,
      sales: {
        UZS: { amount: salesRows[0]?.uzs || 0, orders: salesRows[0]?.orders || 0 },
        USD: { amount: salesRows[0]?.usd || 0, orders: salesRows[0]?.orders || 0 },
      },
      customers,
      cashback,
      referrals,
      notifications: notificationRows[0] || { sent: 0, failed: 0, read: 0, campaigns: 0 },
    });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.analyticsTrends = async (req, res) => {
  try {
    const createdAt = dateRange(req.query);
    const rows = await Order.aggregate([
      { $match: { source: "MOBILE", ...(createdAt ? { createdAt } : {}) } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          total_uzs: { $sum: "$total_uzs" },
          total_usd: { $sum: "$total_usd" },
          approved: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "NEW"] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return res.json({ ok: true, period: clean(req.query.period || "daily"), items: rows });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.orderStatusSummary = async (req, res) => {
  try {
    const rows = await Order.aggregate([
      { $match: orderFilter(req.query) },
      { $group: { _id: "$status", count: { $sum: 1 }, total_uzs: { $sum: "$total_uzs" }, total_usd: { $sum: "$total_usd" } } },
      { $sort: { count: -1 } },
    ]);
    return res.json({ ok: true, items: rows });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.orderConversion = async (req, res) => {
  try {
    const filter = orderFilter(req.query);
    const [orders, carts] = await Promise.all([
      Order.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      MarketplaceCart.countDocuments({ createdAt: filter.createdAt || { $exists: true } }),
    ]);
    const total = orders.reduce((sum, row) => sum + row.count, 0);
    const approved = orders.filter((x) => x._id === "CONFIRMED").reduce((sum, row) => sum + row.count, 0);
    const pending = orders.filter((x) => x._id === "NEW").reduce((sum, row) => sum + row.count, 0);
    const canceled = orders.filter((x) => x._id === "CANCELED").reduce((sum, row) => sum + row.count, 0);
    return res.json({
      ok: true,
      cart: { count: carts },
      pending,
      approved,
      completed: approved,
      canceled,
      conversion_rate: total ? approved / total : 0,
    });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.analyticsTopProducts = async (req, res) => exports.topProducts(req, res);

exports.productStockAlerts = async (req, res) => {
  try {
    const threshold = Math.max(Number(req.query.threshold) || 1, 0);
    const items = await Product.find({
      marketplace_visible: { $ne: false },
      isActive: { $ne: false },
      qty: { $lte: threshold },
    })
      .sort({ qty: 1, name: 1 })
      .limit(Math.min(Number(req.query.limit) || 50, 100))
      .lean();
    return res.json({ ok: true, threshold, total: items.length, items });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.analyticsTopCustomers = async (req, res) => exports.topCustomers(req, res);

exports.agentsPerformance = async (req, res) => {
  try {
    const [accounts, referrals, orders] = await Promise.all([
      MarketplaceAccount.aggregate([
        { $match: idOk(req.query.agent_id) ? { agent_id: new mongoose.Types.ObjectId(req.query.agent_id) } : { agent_id: { $ne: null } } },
        { $group: { _id: "$agent_id", customers: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } } } },
      ]),
      MarketplaceReferral.aggregate([
        { $match: idOk(req.query.agent_id) ? { agent_id: new mongoose.Types.ObjectId(req.query.agent_id) } : { agent_id: { $ne: null } } },
        { $group: { _id: "$agent_id", referrals: { $sum: 1 }, linked: { $sum: { $cond: [{ $eq: ["$status", "LINKED_TO_CUSTOMER"] }, 1, 0] } } } },
      ]),
      Order.aggregate([
        { $match: { source: "MOBILE", agent_id: { $ne: null }, ...(idOk(req.query.agent_id) ? { agent_id: new mongoose.Types.ObjectId(req.query.agent_id) } : {}) } },
        { $group: { _id: "$agent_id", orders: { $sum: 1 }, total_uzs: { $sum: "$total_uzs" }, total_usd: { $sum: "$total_usd" } } },
      ]),
    ]);
    const ids = [...new Set([...accounts, ...referrals, ...orders].map((x) => String(x._id)).filter(Boolean))];
    const agents = await User.find({ _id: { $in: ids } }).select("name phone login role").lean();
    const map = new Map(agents.map((a) => [String(a._id), a]));
    const items = ids.map((id) => ({
      agent: map.get(id) || { _id: id },
      ...(accounts.find((x) => String(x._id) === id) || {}),
      ...(referrals.find((x) => String(x._id) === id) || {}),
      ...(orders.find((x) => String(x._id) === id) || {}),
    }));
    return res.json({ ok: true, items });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.analyticsCashbackSummary = async (req, res) => exports.cashbackSummary(req, res);
exports.analyticsCashbackCustomers = async (req, res) => exports.cashbackCustomers(req, res);

exports.referralsSummary = async (req, res) => {
  const filter = referralFilter(req.query);
  const items = await MarketplaceReferral.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]);
  return res.json({ ok: true, items });
};

exports.notificationsSummary = async (req, res) => exports.notificationStats(req, res);

exports.bannersSummary = async (req, res) => {
  try {
    const [banners, sections, promotions] = await Promise.all([
      MarketplaceHomeBanner.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      MarketplaceHomeSection.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      MarketplacePromotion.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    return res.json({ ok: true, banners, sections, promotions });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.reorderSummary = async (req, res) => {
  try {
    const createdAt = dateRange(req.query);
    const [favorites, reorder] = await Promise.all([
      MarketplaceFavorite.aggregate([
        { $match: { status: "ACTIVE", ...(createdAt ? { createdAt } : {}) } },
        { $group: { _id: "$product_id", favorites: { $sum: 1 } } },
        { $sort: { favorites: -1 } },
        { $limit: Math.min(Number(req.query.limit) || 20, 100) },
      ]),
      MarketplaceQuickReorderLog.aggregate([
        { $match: createdAt ? { createdAt } : {} },
        { $group: { _id: "$source_type", attempts: { $sum: 1 }, added: { $sum: "$added_items_count" }, skipped: { $sum: "$skipped_items_count" } } },
      ]),
    ]);
    return res.json({ ok: true, favorites, reorder });
  } catch (error) {
    return adminError(res, error);
  }
};

exports.reportCustomers = async (req, res) => responseWithExport(req, res, await MarketplaceAccount.find(customerFilter(req.query)).populate("customer_id", "name phone balance").populate("agent_id", "name phone login").lean(), "marketplace-customers", [
  { header: "date", value: (r) => r.createdAt },
  { header: "status", value: (r) => r.status },
  { header: "name", value: (r) => r.name || r.customer_id?.name },
  { header: "phone", value: (r) => r.phone },
  { header: "region", value: (r) => r.region },
  { header: "district", value: (r) => r.district },
  { header: "agent", value: (r) => r.agent_id?.name },
]);

exports.reportBanners = async (req, res) => responseWithExport(req, res, await MarketplaceHomeBanner.find().lean(), "marketplace-banners", [
  { header: "date", value: (r) => r.createdAt },
  { header: "title", value: (r) => r.title },
  { header: "status", value: (r) => r.status },
  { header: "placement", value: (r) => r.placement },
  { header: "priority", value: (r) => r.priority },
  { header: "valid_from", value: (r) => r.valid_from },
  { header: "valid_to", value: (r) => r.valid_to },
]);

exports.createExportJob = async (req, res) => {
  try {
    const job = await MarketplaceReportExportJob.create({
      report_type: clean(req.body?.report_type || req.query.report_type || "orders"),
      format: clean(req.body?.format || req.query.format || "xlsx").toLowerCase(),
      filters: req.body?.filters || req.query || {},
      status: "DONE",
      file_url: "",
      requestedBy: actorId(req),
      completedAt: new Date(),
    });
    await writeAudit(req, "marketplace.report.export_job.create", "MarketplaceReportExportJob", job._id, null, job.toObject());
    return res.status(201).json({ ok: true, job });
  } catch (error) {
    return adminError(res, error, 400);
  }
};

exports.getExportJob = async (req, res) => getDoc(req, res, MarketplaceReportExportJob);
