const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const Customer = require("../modules/Customer/Customer");
const User = require("../modules/Users/User");
const MarketplaceAccount = require("../modules/marketplace/MarketplaceAccount");
const { MarketplaceNotificationCampaign } = require("../modules/marketplace/MarketplaceNotification");
const MarketplaceOtpChallenge = require("../modules/marketplace/MarketplaceOtpChallenge");
const { normalizePhone, phoneVariants, digitsOnly } = require("../utils/phone");
const { isOutdatedVersion } = require("../utils/version");
const { isSmsFlyConfigured, sendMarketplaceOtpSms } = require("../services/smsfly.service");

function currentUserId(req) {
  return req.user?._id || req.user?.id || null;
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function compareStatusPriority(status) {
  const value = String(status || "").toUpperCase();
  if (value === "BLOCKED") return 3;
  if (value === "REJECTED") return 2;
  if (value === "PENDING") return 1;
  return 0;
}

function normalizeAccountPayload(body = {}) {
  const phone = normalizePhone(body.phone);
  const additionalPhone = normalizePhone(body.additional_phone || body.additionalPhone || "");
  return {
    phone,
    additional_phone: additionalPhone,
    name: cleanText(body.name || body.customer_name || body.shop_name),
    address: cleanText(body.address),
    region: cleanText(body.region),
    district: cleanText(body.district),
    landmark: cleanText(body.landmark),
    note: cleanText(body.note),
    referral_code: cleanText(body.agent_code || body.referral_code || body.referralLink || ""),
    app_version: cleanText(body.app_version || body.appVersion),
    device_id: cleanText(body.device_id || body.deviceId),
    push_token: cleanText(body.push_token || body.pushToken),
  };
}

function buildJwt(account, customer) {
  return jwt.sign(
    {
      id: account?._id || customer?._id,
      account_id: account?._id || null,
      customer_id: customer?._id || null,
      role: "MOBILE",
      scope: "MARKETPLACE",
      status: account?.status || customer?.status || "PENDING",
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.MARKETPLACE_JWT_EXPIRES_IN || process.env.JWT_EXPIRES_IN || "30d" },
  );
}

function buildUserMessage(customer, account) {
  const accountStatus = String(account?.status || "").toUpperCase();
  const customerStatus = String(customer?.status || "").toUpperCase();
  const finalStatus = accountStatus === "BLOCKED" || customerStatus === "BLOCKED"
    ? "BLOCKED"
    : accountStatus === "REJECTED" || customerStatus === "REJECTED"
      ? "REJECTED"
      : accountStatus === "PENDING" || customerStatus === "PENDING"
        ? "PENDING"
        : "ACTIVE";

  if (finalStatus === "BLOCKED") {
    return "Profilingiz vaqtincha cheklangan. Batafsil ma’lumot uchun administrator yoki agent bilan bog‘laning.";
  }
  if (finalStatus === "PENDING") {
    return "Ma’lumotlaringiz admin tomonidan tasdiqlanishi kutilmoqda.";
  }
  return "Login muvaffaqiyatli";
}

async function findCustomerCandidates(phone) {
  const variants = phoneVariants(phone);
  if (!variants.length) return [];

  return Customer.find({
    $or: [
      { phone: { $in: variants } },
      { additionalPhones: { $in: variants } },
    ],
  })
    .select("_id name phone additionalPhones address region district status isActive agent_id marketplace_meta createdAt updatedAt")
    .lean();
}

async function findAccountCandidates(phone) {
  const variants = phoneVariants(phone);
  if (!variants.length) return [];

  return MarketplaceAccount.find({
    $or: [
      { phone_normalized: { $in: variants } },
      { phone: { $in: variants } },
      { additional_phone: { $in: variants } },
    ],
  })
    .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
    .populate("agent_id", "name phone login role")
    .lean();
}

async function upsertAccountFromCustomer(customer, body = {}) {
  const normalizedPhone = normalizePhone(customer.phone);
  const payload = normalizeAccountPayload({
    phone: customer.phone,
    additional_phone: Array.isArray(customer.additionalPhones) && customer.additionalPhones.length
      ? customer.additionalPhones[0]
      : "",
    name: customer.name,
    address: customer.address,
    region: customer.region,
    district: customer.district,
    note: customer.note,
    ...body,
  });

  const patch = {
    phone: payload.phone || customer.phone,
    phone_normalized: normalizedPhone,
    additional_phone: payload.additional_phone || "",
    name: payload.name || customer.name,
    address: payload.address || customer.address || "",
    region: payload.region || customer.region || "",
    district: payload.district || customer.district || "",
    landmark: payload.landmark || "",
    note: payload.note || customer.note || "",
    app_version: payload.app_version || customer.marketplace_meta?.app_version || "",
    device_id: payload.device_id || customer.marketplace_meta?.device_id || "",
    push_token: payload.push_token || customer.marketplace_meta?.push_token || "",
    customer_id: customer._id,
    status: customer.status === "BLOCKED" ? "BLOCKED" : customer.status === "PENDING" ? "PENDING" : "ACTIVE",
    last_login_at: new Date(),
    last_seen_at: new Date(),
    linkedAt: new Date(),
  };

  return MarketplaceAccount.findOneAndUpdate(
    { phone_normalized: normalizedPhone },
    { $set: patch, $setOnInsert: { referral_code: payload.referral_code || "", metadata: {} } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
    .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
    .populate("agent_id", "name phone login role")
    .lean();
}

function createOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function storeOtpChallenge({ phone, app_version = "", device_id = "" }) {
  const normalized = normalizePhone(phone);
  const code = createOtpCode();
  const code_hash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const challenge = await MarketplaceOtpChallenge.findOneAndUpdate(
    { phone_normalized: normalized, device_id: cleanText(device_id) || "" },
    {
      $set: {
        phone: normalized,
        phone_normalized: normalized,
        code_hash,
        device_id: cleanText(device_id) || "",
        app_version: cleanText(app_version) || "",
        expiresAt,
        verifiedAt: null,
        usedAt: null,
        attempts: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return { code, challenge };
}

async function verifyOtpChallenge({ phone, code, device_id = "" }) {
  const normalized = normalizePhone(phone);
  const challenge = await MarketplaceOtpChallenge.findOne({
    phone_normalized: normalized,
    device_id: cleanText(device_id) || "",
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).select("+code_hash").sort({ createdAt: -1 });

  if (!challenge) {
    return { ok: false, message: "Tasdiqlash kodi topilmadi yoki muddati tugagan." };
  }

  const matched = await bcrypt.compare(String(code || "").trim(), challenge.code_hash);
  if (!matched) {
    challenge.attempts += 1;
    await challenge.save();
    return { ok: false, message: "Tasdiqlash kodi noto‘g‘ri." };
  }

  challenge.verifiedAt = new Date();
  challenge.usedAt = new Date();
  await challenge.save();
  return { ok: true, challenge };
}

function versionCheckOrMessage(appVersion) {
  const minVersion = String(process.env.MARKETPLACE_MIN_VERSION || "1.0.0").trim();
  if (!minVersion) return null;
  if (!isOutdatedVersion(appVersion, minVersion)) return null;
  return {
    ok: false,
    update_required: true,
    message: "Ilovaning yangi versiyasi mavjud. Marketplace’dan foydalanish uchun ilovani yangilang.",
    minimum_version: minVersion,
  };
}

async function resolveAgentByCode(codeOrLink) {
  const raw = cleanText(codeOrLink);
  if (!raw) return null;

  const directId = mongoose.isValidObjectId(raw) ? raw : null;
  if (directId) {
    const user = await User.findById(directId).select("_id name phone login role").lean();
    if (user) return user;
  }

  const urlMatch = raw.match(/[?&](?:agent_id|agent|code|ref)=([^&]+)/i);
  if (urlMatch) {
    const decoded = decodeURIComponent(urlMatch[1]);
    if (mongoose.isValidObjectId(decoded)) {
      const user = await User.findById(decoded).select("_id name phone login role").lean();
      if (user) return user;
    }
    const byLogin = await User.findOne({
      login: { $regex: `^${escapeRegex(decoded.trim().toLowerCase())}$`, $options: "i" },
    })
      .select("_id name phone login role")
      .lean();
    if (byLogin) return byLogin;
  }

  const byLogin = await User.findOne({
    login: { $regex: `^${escapeRegex(raw.toLowerCase())}$`, $options: "i" },
  })
    .select("_id name phone login role")
    .lean();
  if (byLogin) return byLogin;

  return null;
}

function buildAccountResponse(account, customer, token) {
  return {
    ok: true,
    token,
    status: account?.status || customer?.status || "PENDING",
    account_id: account?._id || null,
    customer_id: customer?._id || account?.customer_id || null,
    customer: customer || null,
    account: account || null,
    message: buildUserMessage(customer, account),
  };
}

exports.requestCode = async (req, res) => {
  try {
    const { phone, app_version, device_id } = req.body || {};
    const versionProblem = versionCheckOrMessage(app_version);
    if (versionProblem) return res.status(426).json(versionProblem);

    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({
        ok: false,
        message: "Telefon raqam majburiy",
      });
    }

    const { code, challenge } = await storeOtpChallenge({ phone: normalized, app_version, device_id });
    const customers = await findCustomerCandidates(normalized);
    const accounts = await findAccountCandidates(normalized);

    const debugOtp = String(process.env.MARKETPLACE_DEBUG_OTP || "").toLowerCase() === "true";
    const smsFlyReady = isSmsFlyConfigured();
    let smsResult = null;

    if (smsFlyReady) {
      try {
        smsResult = await sendMarketplaceOtpSms({ phone: normalized, code });
      } catch (smsError) {
        return res.status(502).json({
          ok: false,
          message: "SMS yuborib bo'lmadi",
          error: smsError.message,
          resultCode: smsError.resultCode ?? null,
        });
      }
    }

    return res.json({
      ok: true,
      message: smsFlyReady ? "Tasdiqlash kodi SMS orqali yuborildi" : "Tasdiqlash kodi tayyorlandi",
      delivery: "sms",
      sms_provider: smsFlyReady ? "smsfly" : "internal",
      sms_sent: Boolean(smsFlyReady),
      customer_found: customers.length === 1,
      account_status: accounts[0]?.status || null,
      challenge_id: challenge?._id || null,
      ...(debugOtp || !smsFlyReady ? { otp_code: code } : {}),
      ...(debugOtp && smsResult ? { sms_result: smsResult } : {}),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Kod yuborishda xatolik",
      error: error.message,
    });
  }
};

exports.verifyCode = async (req, res) => {
  try {
    const { phone, code, app_version = "", device_id = "", push_token = "", agent_code = "" } = req.body || {};
    const versionProblem = versionCheckOrMessage(app_version);
    if (versionProblem) return res.status(426).json(versionProblem);

    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({
        ok: false,
        message: "Telefon raqam majburiy",
      });
    }

    const otp = await verifyOtpChallenge({ phone: normalized, code, device_id });
    if (!otp.ok) {
      return res.status(400).json(otp);
    }

    const customers = await findCustomerCandidates(normalized);
    if (customers.length > 1) {
      return res.status(409).json({
        ok: false,
        needs_admin_selection: true,
        message: "Bu telefon raqam bo‘yicha bir nechta mijoz topildi. To‘g‘ri mijozni tanlang.",
        candidates: customers.map((c) => ({
          _id: c._id,
          name: c.name,
          phone: c.phone,
          address: c.address || "",
          region: c.region || "",
          district: c.district || "",
          status: c.status || "PENDING",
          isActive: c.isActive !== false,
        })),
      });
    }

    const customer = customers[0] || null;
    const accountMatches = await findAccountCandidates(normalized);
    let account = accountMatches[0] || null;

    if (!customer && !account) {
      account = await MarketplaceAccount.create({
        phone: normalized,
        phone_normalized: normalized,
        name: "",
        address: "",
        region: "",
        district: "",
        note: "",
        customer_id: null,
        agent_id: null,
        status: "PENDING",
        app_version: cleanText(app_version),
        device_id: cleanText(device_id),
        push_token: cleanText(push_token),
        last_login_at: new Date(),
        last_seen_at: new Date(),
      });
      account = account.toObject();
    }

    if (customer) {
      if (account && String(account.status || "").toUpperCase() === "BLOCKED") {
        return res.status(403).json({
          ok: false,
          status: "BLOCKED",
          message: "Profilingiz vaqtincha cheklangan. Batafsil ma’lumot uchun administrator yoki agent bilan bog‘laning.",
        });
      }

      if (customer.status === "BLOCKED" || customer.isActive === false) {
        return res.status(403).json({
          ok: false,
          status: "BLOCKED",
          message: "Profilingiz vaqtincha cheklangan. Batafsil ma’lumot uchun administrator yoki agent bilan bog‘laning.",
        });
      }

      if (!account) {
        account = await upsertAccountFromCustomer(customer, {
          app_version,
          device_id,
          push_token,
        });
      } else {
        account = await MarketplaceAccount.findByIdAndUpdate(
          account._id,
          {
            $set: {
              phone: normalized,
              phone_normalized: normalized,
              customer_id: customer._id,
              app_version: cleanText(app_version),
              device_id: cleanText(device_id),
              push_token: cleanText(push_token),
              last_login_at: new Date(),
              last_seen_at: new Date(),
              status: customer.status === "BLOCKED" ? "BLOCKED" : customer.status === "PENDING" ? "PENDING" : "ACTIVE",
            },
          },
          { new: true },
        )
          .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
          .populate("agent_id", "name phone login role")
          .lean();
      }

      const token = buildJwt(account, customer);
      await Customer.findByIdAndUpdate(customer._id, {
        $set: {
          "marketplace_meta.app_version": cleanText(app_version),
          "marketplace_meta.device_id": cleanText(device_id),
          "marketplace_meta.push_token": cleanText(push_token),
          "marketplace_meta.last_login_at": new Date(),
          "marketplace_meta.last_seen_at": new Date(),
        },
      });

      return res.json(buildAccountResponse(account, customer, token));
    }

    // account without customer yet
    if (account && account.status === "BLOCKED") {
      return res.status(403).json({
        ok: false,
        status: "BLOCKED",
        message: "Profilingiz vaqtincha cheklangan. Batafsil ma’lumot uchun administrator yoki agent bilan bog‘laning.",
      });
    }

    if (!account) {
      account = await MarketplaceAccount.create({
        phone: normalized,
        phone_normalized: normalized,
        name: "",
        address: "",
        region: "",
        district: "",
        note: "",
        customer_id: null,
        agent_id: null,
        status: "PENDING",
        app_version: cleanText(app_version),
        device_id: cleanText(device_id),
        push_token: cleanText(push_token),
        last_login_at: new Date(),
        last_seen_at: new Date(),
      });
      account = account.toObject();
    }

    const agent = await resolveAgentByCode(agent_code);
    if (agent && account) {
      account = await MarketplaceAccount.findByIdAndUpdate(
        account._id,
        { $set: { agent_id: agent._id } },
        { new: true },
      )
        .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
        .populate("agent_id", "name phone login role")
        .lean();
    }

    const token = buildJwt(account, null);
    return res.json({
      ok: true,
      token,
      status: account.status || "PENDING",
      account_id: account._id || null,
      customer_id: account.customer_id || null,
      customer: null,
      account,
      message: "Ma’lumotlaringiz admin tomonidan tasdiqlanishi kutilmoqda.",
      pending: true,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Tasdiqlashda xatolik",
      error: error.message,
    });
  }
};

exports.unreadNotificationCount = async (req, res) => {
  try {
    const accountId = req.marketplaceAuth?.account_id || null;
    const customerId = req.marketplaceAuth?.customer_id || null;

    let account = null;
    let customer = null;

    if (accountId && mongoose.isValidObjectId(accountId)) {
      account = await MarketplaceAccount.findById(accountId)
        .populate("customer_id", "marketplace_meta last_seen_at")
        .lean();
    }

    if (!customer && customerId && mongoose.isValidObjectId(customerId)) {
      customer = await Customer.findById(customerId).select("marketplace_meta last_seen_at").lean();
    }

    const lastSeenAt = account?.last_seen_at || customer?.marketplace_meta?.last_seen_at || customer?.last_seen_at || null;
    const query = { status: "SENT" };
    if (lastSeenAt) query.createdAt = { $gt: new Date(lastSeenAt) };

    const unread_count = await MarketplaceNotificationCampaign.countDocuments(query);
    return res.json({
      ok: true,
      unread_count,
      last_seen_at: lastSeenAt || null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Unread notification count olishda xatolik",
      error: error.message,
    });
  }
};

exports.listNotifications = async (req, res) => {
  try {
    const accountId = req.marketplaceAuth?.account_id || null;
    const customerId = req.marketplaceAuth?.customer_id || null;
    const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 100);
    const page = Math.max(Number(req.query?.page || 1), 1);
    const unreadOnly = String(req.query?.unread_only || "").toLowerCase() === "true";

    let account = null;
    let customer = null;

    if (accountId && mongoose.isValidObjectId(accountId)) {
      account = await MarketplaceAccount.findById(accountId)
        .populate("customer_id", "marketplace_meta last_seen_at")
        .lean();
    }

    if (!customer && customerId && mongoose.isValidObjectId(customerId)) {
      customer = await Customer.findById(customerId).select("marketplace_meta last_seen_at").lean();
    }

    const lastSeenAt = account?.last_seen_at || customer?.marketplace_meta?.last_seen_at || customer?.last_seen_at || null;
    const query = { status: "SENT" };
    if (lastSeenAt) query.createdAt = { $gt: new Date(lastSeenAt) };

    const unread_count = await MarketplaceNotificationCampaign.countDocuments(query);

    const feedQuery = { status: "SENT" };
    if (unreadOnly && lastSeenAt) {
      feedQuery.createdAt = { $gt: new Date(lastSeenAt) };
    }

    const [items, total] = await Promise.all([
      MarketplaceNotificationCampaign.find(feedQuery)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MarketplaceNotificationCampaign.countDocuments(feedQuery),
    ]);

    const mapped = items.map((item) => ({
      id: item._id,
      title: item.title,
      body: item.body,
      type: item.type,
      channel: item.channel,
      status: item.status,
      total_targets: item.total_targets || 0,
      sent_count: item.sent_count || 0,
      failed_count: item.failed_count || 0,
      read_count: item.read_count || 0,
      sentAt: item.sentAt || item.updatedAt || item.createdAt || null,
      createdAt: item.createdAt || null,
      unread: !lastSeenAt || new Date(item.createdAt) > new Date(lastSeenAt),
      metadata: item.metadata || {},
    }));

    return res.json({
      ok: true,
      count: total,
      unread_count,
      last_seen_at: lastSeenAt || null,
      items: mapped,
      data: mapped,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Notifications olishda xatolik",
      error: error.message,
    });
  }
};

function defaultNotificationPreferences(account, customer) {
  const metaPrefs = account?.metadata?.notification_preferences || customer?.marketplace_meta?.notification_preferences || {};
  return {
    push_enabled: metaPrefs.push_enabled !== false,
    sms_enabled: metaPrefs.sms_enabled !== false,
    in_app_enabled: metaPrefs.in_app_enabled !== false,
    promo_enabled: metaPrefs.promo_enabled !== false,
    order_enabled: metaPrefs.order_enabled !== false,
    payment_enabled: metaPrefs.payment_enabled !== false,
    sound_enabled: metaPrefs.sound_enabled !== false,
  };
}

exports.notificationPreferences = async (req, res) => {
  try {
    const accountId = req.marketplaceAuth?.account_id || null;
    const customerId = req.marketplaceAuth?.customer_id || null;

    let account = null;
    let customer = null;

    if (accountId && mongoose.isValidObjectId(accountId)) {
      account = await MarketplaceAccount.findById(accountId).lean();
    }
    if (!customer && customerId && mongoose.isValidObjectId(customerId)) {
      customer = await Customer.findById(customerId).select("marketplace_meta").lean();
    }

    const preferences = defaultNotificationPreferences(account, customer);
    return res.json({
      ok: true,
      preferences,
      data: preferences,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Notification preferences olishda xatolik",
      error: error.message,
    });
  }
};

exports.updateNotificationPreferences = async (req, res) => {
  try {
    const accountId = req.marketplaceAuth?.account_id || null;
    const customerId = req.marketplaceAuth?.customer_id || null;

    const patch = {};
    for (const key of ["push_enabled", "sms_enabled", "in_app_enabled", "promo_enabled", "order_enabled", "payment_enabled", "sound_enabled"]) {
      if (req.body?.[key] !== undefined) {
        patch[key] = Boolean(req.body[key]);
      }
    }

    let account = null;
    if (accountId && mongoose.isValidObjectId(accountId)) {
      account = await MarketplaceAccount.findById(accountId);
      if (account) {
        account.metadata = account.metadata || {};
        account.metadata.notification_preferences = {
          ...(account.metadata.notification_preferences || {}),
          ...patch,
        };
        await account.save();
      }
    }

    if (!account && customerId && mongoose.isValidObjectId(customerId)) {
      const customer = await Customer.findById(customerId);
      if (customer) {
        customer.marketplace_meta = customer.marketplace_meta || {};
        customer.marketplace_meta.notification_preferences = {
          ...(customer.marketplace_meta.notification_preferences || {}),
          ...patch,
        };
        await customer.save();
      }
    }

    return res.json({
      ok: true,
      preferences: patch,
      data: patch,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Notification preferences saqlashda xatolik",
      error: error.message,
    });
  }
};

exports.register = async (req, res) => {
  try {
    const payload = normalizeAccountPayload(req.body || {});
    const versionProblem = versionCheckOrMessage(payload.app_version);
    if (versionProblem) return res.status(426).json(versionProblem);

    if (!payload.phone || !payload.name || !payload.address || !payload.region || !payload.district) {
      return res.status(400).json({
        ok: false,
        message: "Majburiy maydonlar to‘liq emas",
      });
    }

    const customers = await findCustomerCandidates(payload.phone);
    if (customers.length > 1) {
      return res.status(409).json({
        ok: false,
        needs_admin_selection: true,
        message: "Bu telefon raqam bo‘yicha bir nechta mijoz topildi. To‘g‘ri mijozni tanlang.",
      });
    }

    const customer = customers[0] || null;
    if (customer && customer.status === "BLOCKED") {
      return res.status(403).json({
        ok: false,
        status: "BLOCKED",
        message: "Profilingiz vaqtincha cheklangan. Batafsil ma’lumot uchun administrator yoki agent bilan bog‘laning.",
      });
    }

    const existingAccount = await MarketplaceAccount.findOne({
      phone_normalized: normalized,
    }).lean();
    if (existingAccount && String(existingAccount.status || "").toUpperCase() === "BLOCKED") {
      return res.status(403).json({
        ok: false,
        status: "BLOCKED",
        message: "Profilingiz vaqtincha cheklangan. Batafsil ma’lumot uchun administrator yoki agent bilan bog‘laning.",
      });
    }

    const agent = await resolveAgentByCode(payload.referral_code);
    const normalized = normalizePhone(payload.phone);
    const account = await MarketplaceAccount.findOneAndUpdate(
      { phone_normalized: normalized },
      {
        $set: {
          phone: normalized,
          phone_normalized: normalized,
          additional_phone: payload.additional_phone || "",
          name: payload.name,
          address: payload.address,
          region: payload.region,
          district: payload.district,
          landmark: payload.landmark,
          note: payload.note,
          agent_id: agent?._id || null,
          customer_id: customer?._id || null,
          status: customer ? (customer.status === "BLOCKED" ? "BLOCKED" : customer.status === "PENDING" ? "PENDING" : "ACTIVE") : "PENDING",
          app_version: payload.app_version,
          device_id: payload.device_id,
          push_token: payload.push_token,
          last_login_at: new Date(),
          last_seen_at: new Date(),
          linkedAt: customer ? new Date() : null,
          metadata: {
            registration_source: "MOBILE",
          },
        },
        $setOnInsert: {
          referral_code: payload.referral_code || "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
      .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
      .populate("agent_id", "name phone login role")
      .lean();

    if (customer && customer.status === "ACTIVE") {
      const token = buildJwt(account, customer);
      return res.status(201).json({
        ok: true,
        message: "Ro‘yxatdan o‘tildi va bog‘landi",
        token,
        status: "ACTIVE",
        account,
        customer,
      });
    }

    return res.status(201).json({
      ok: true,
      message: "Ro‘yxatdan o‘tildi. Admin tasdiqlashini kuting",
      status: account.status || "PENDING",
      account,
      customer,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Ro‘yxatdan o‘tishda xatolik",
      error: error.message,
    });
  }
};

exports.me = async (req, res) => {
  try {
    const accountId = req.marketplaceAuth?.account_id || null;
    const customerId = req.marketplaceAuth?.customer_id || null;

    let account = null;
    let customer = null;

    if (accountId && mongoose.isValidObjectId(accountId)) {
      account = await MarketplaceAccount.findById(accountId)
        .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta balance opening_balance payment_history")
        .populate("agent_id", "name phone login role")
        .lean();
      customer = account?.customer_id || null;
    } else if (customerId && mongoose.isValidObjectId(customerId)) {
      customer = await Customer.findById(customerId)
        .select("_id name phone additionalPhones address region district status isActive agent_id marketplace_meta balance opening_balance payment_history")
        .populate("agent_id", "name phone login role")
        .lean();
      if (customer) {
        account = await MarketplaceAccount.findOne({ customer_id: customer._id })
          .populate("agent_id", "name phone login role")
          .lean();
      }
    }

    return res.json({
      ok: true,
      account,
      customer,
      status: account?.status || customer?.status || "PENDING",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Profilni olishda xatolik",
      error: error.message,
    });
  }
};

exports.logout = async (req, res) => {
  try {
    if (req.marketplaceAuth?.account_id && mongoose.isValidObjectId(req.marketplaceAuth.account_id)) {
      await MarketplaceAccount.findByIdAndUpdate(req.marketplaceAuth.account_id, {
        $set: { last_seen_at: new Date() },
      });
    }

    return res.json({
      ok: true,
      message: "Chiqildi",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Logoutda xatolik",
      error: error.message,
    });
  }
};

exports.requestAgentChange = async (req, res) => {
  try {
    const accountId = req.marketplaceAuth?.account_id || null;
    const { agent_code = "", reason = "" } = req.body || {};
    const agent = await resolveAgentByCode(agent_code);
    if (!agent) {
      return res.status(404).json({
        ok: false,
        message: "Agent kodi topilmadi.",
      });
    }

    if (!accountId || !mongoose.isValidObjectId(accountId)) {
      return res.status(401).json({ ok: false, message: "Qayta kirishingiz kerak." });
    }

    await MarketplaceAccount.findByIdAndUpdate(accountId, {
      $set: {
        metadata: {
          agent_change_request: {
            agent_id: agent._id,
            reason: cleanText(reason),
            requestedAt: new Date(),
            status: "PENDING",
          },
        },
      },
    });

    return res.json({
      ok: true,
      message: "Agent almashtirish so‘rovi yuborildi.",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Agent so‘rov yuborishda xatolik",
      error: error.message,
    });
  }
};

exports.listPendingAccounts = async (req, res) => {
  try {
    const items = await MarketplaceAccount.find({ status: "PENDING" })
      .sort({ createdAt: -1 })
      .populate("customer_id", "name phone additionalPhones address region district status isActive")
      .populate("agent_id", "name phone login role")
      .lean();

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Pending ro‘yxatini olishda xatolik",
      error: error.message,
    });
  }
};

exports.listMarketplaceAccounts = async (req, res) => {
  try {
    const {
      status = "",
      q = "",
      region = "",
      agent_id = "",
      from = "",
      to = "",
      linked = "",
      page = 1,
      limit = 20,
    } = req.query || {};

    const query = {};
    const statusValue = String(status || "").trim().toUpperCase();
    if (statusValue && ["PENDING", "ACTIVE", "BLOCKED", "REJECTED"].includes(statusValue)) {
      query.status = statusValue;
    }
    if (region) {
      query.region = { $regex: escapeRegex(region), $options: "i" };
    }
    if (agent_id && mongoose.isValidObjectId(agent_id)) {
      query.agent_id = agent_id;
    }
    if (String(linked || "").trim() === "1") {
      query.customer_id = { $ne: null };
    } else if (String(linked || "").trim() === "0") {
      query.customer_id = null;
    }
    if (from || to) {
      query.createdAt = {};
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(0, 0, 0, 0);
          query.createdAt.$gte = d;
        }
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          query.createdAt.$lte = d;
        }
      }
      if (Object.keys(query.createdAt).length === 0) delete query.createdAt;
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * pageSize;
    const search = cleanText(q);

    let items = await MarketplaceAccount.find(query)
      .sort({ createdAt: -1 })
      .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
      .populate("agent_id", "name phone login role")
      .lean();

    if (search) {
      const qLower = search.toLowerCase();
      items = items.filter((row) => {
        const haystack = [
          row.name,
          row.phone,
          row.additional_phone,
          row.address,
          row.region,
          row.district,
          row.landmark,
          row.note,
          row.referral_code,
          row.status,
          row.customer_id?.name,
          row.customer_id?.phone,
          row.agent_id?.name,
          row.agent_id?.login,
          row.agent_id?.phone,
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" | ");
        return haystack.includes(qLower);
      });
    }

    const total = items.length;
    const data = items.slice(skip, skip + pageSize);

    return res.json({
      ok: true,
      total,
      page: pageNum,
      limit: pageSize,
      items: data,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Marketplace mijozlar ro‘yxatini olishda xatolik",
      error: error.message,
    });
  }
};

exports.approveAccount = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { customer_id, create_customer = false } = req.body || {};
    const approverId = currentUserId(req);

    const account = await MarketplaceAccount.findById(id).session(session);
    if (!account) throw new Error("Marketplace account topilmadi");

    let customer = null;

    if (customer_id) {
      if (!mongoose.isValidObjectId(customer_id)) throw new Error("customer_id noto‘g‘ri");
      customer = await Customer.findById(customer_id).session(session);
      if (!customer) throw new Error("Customer topilmadi");
    } else if (account.customer_id) {
      customer = await Customer.findById(account.customer_id).session(session);
    }

    if (!customer && create_customer) {
      customer = await Customer.create(
        [
          {
            name: account.name || `Marketplace ${cleanText(account.phone)}`,
            phone: account.phone_normalized,
            additionalPhones: account.additional_phone ? [account.additional_phone] : [],
            region: account.region || "",
            district: account.district || "",
            address: account.address || "",
            note: account.note || "",
            agent_id: account.agent_id || null,
            role: "MOBILE",
            status: "ACTIVE",
            registered_from: "MOBILE",
            balance: { UZS: 0, USD: 0 },
            opening_balance: { UZS: 0, USD: 0 },
            payment_history: [],
            isActive: true,
          },
        ],
        { session },
      ).then((rows) => rows[0]);
    }

    if (!customer && account.status === "PENDING") {
      throw new Error("Bog‘lash uchun customer tanlang yoki yangi customer yarating");
    }

    if (customer) {
      customer.status = customer.status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
      customer.isActive = customer.status !== "BLOCKED";
      customer.agent_id = account.agent_id || customer.agent_id || null;
      customer.marketplace_meta = customer.marketplace_meta || {};
      customer.marketplace_meta.last_seen_at = new Date();
      await customer.save({ session });
    }

    account.customer_id = customer?._id || account.customer_id || null;
    account.status = customer?.status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
    account.approvedAt = new Date();
    account.approvedBy = approverId || null;
    account.linkedAt = customer ? new Date() : account.linkedAt || null;
    account.linkedBy = approverId || null;
    account.last_login_at = new Date();
    account.last_seen_at = new Date();
    await account.save({ session });

    await session.commitTransaction();
    return res.json({
      ok: true,
      message: "Marketplace account tasdiqlandi",
      account: await MarketplaceAccount.findById(account._id)
        .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
        .populate("agent_id", "name phone login role")
        .lean(),
      customer: customer ? customer.toObject?.() || customer : null,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(500).json({
      ok: false,
      message: "Marketplace account tasdiqlashda xatolik",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

exports.unblockAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const unblockerId = currentUserId(req);

    const account = await MarketplaceAccount.findById(id);
    if (!account) {
      return res.status(404).json({ ok: false, message: "Marketplace account topilmadi" });
    }

    account.status = account.customer_id ? "ACTIVE" : "PENDING";
    account.blockedAt = null;
    account.blockedBy = null;
    account.rejectedAt = null;
    account.rejectedBy = null;
    account.rejectReason = "";
    account.linkedBy = unblockerId || account.linkedBy || null;
    account.last_seen_at = new Date();
    await account.save();

    if (account.customer_id) {
      await Customer.findByIdAndUpdate(account.customer_id, {
        $set: {
          status: "ACTIVE",
          isActive: true,
          agent_id: account.agent_id || null,
          "marketplace_meta.last_seen_at": new Date(),
        },
      });
    }

    return res.json({
      ok: true,
      message: "Account blokdan chiqarildi",
      account: await MarketplaceAccount.findById(account._id)
        .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
        .populate("agent_id", "name phone login role")
        .lean(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Blokdan chiqarishda xatolik",
      error: error.message,
    });
  }
};

exports.blockAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const blockerId = currentUserId(req);
    const account = await MarketplaceAccount.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "BLOCKED",
          blockedAt: new Date(),
          blockedBy: blockerId || null,
        },
      },
      { new: true },
    )
      .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
      .populate("agent_id", "name phone login role")
      .lean();

    if (!account) {
      return res.status(404).json({ ok: false, message: "Marketplace account topilmadi" });
    }

    if (account.customer_id) {
      await Customer.findByIdAndUpdate(account.customer_id._id || account.customer_id, {
        $set: { status: "BLOCKED", isActive: false },
      });
    }

    return res.json({ ok: true, message: "Account bloklandi", account });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Block qilishda xatolik",
      error: error.message,
    });
  }
};

exports.rejectAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const rejectorId = currentUserId(req);
    const { reason = "" } = req.body || {};
    const account = await MarketplaceAccount.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectedBy: rejectorId || null,
          rejectReason: cleanText(reason),
        },
      },
      { new: true },
    )
      .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
      .populate("agent_id", "name phone login role")
      .lean();

    if (!account) {
      return res.status(404).json({ ok: false, message: "Marketplace account topilmadi" });
    }

    return res.json({ ok: true, message: "Account rad etildi", account });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Reject qilishda xatolik",
      error: error.message,
    });
  }
};

exports.linkToExistingCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_id } = req.body || {};

    if (!mongoose.isValidObjectId(customer_id)) {
      return res.status(400).json({ ok: false, message: "customer_id noto‘g‘ri" });
    }

    const account = await MarketplaceAccount.findById(id);
    if (!account) {
      return res.status(404).json({ ok: false, message: "Marketplace account topilmadi" });
    }

    const customer = await Customer.findById(customer_id);
    if (!customer) {
      return res.status(404).json({ ok: false, message: "Customer topilmadi" });
    }

    account.customer_id = customer._id;
    account.status = customer.status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
    account.linkedAt = new Date();
    account.linkedBy = currentUserId(req) || null;
    await account.save();

    customer.agent_id = account.agent_id || customer.agent_id || null;
    customer.status = customer.status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
    customer.isActive = customer.status !== "BLOCKED";
    customer.marketplace_meta = customer.marketplace_meta || {};
    customer.marketplace_meta.last_seen_at = new Date();
    await customer.save();

    return res.json({
      ok: true,
      message: "Mavjud customer bilan bog‘landi",
      account: await MarketplaceAccount.findById(account._id)
        .populate("customer_id", "name phone additionalPhones address region district status isActive agent_id marketplace_meta")
        .populate("agent_id", "name phone login role")
        .lean(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Bog‘lashda xatolik",
      error: error.message,
    });
  }
};
