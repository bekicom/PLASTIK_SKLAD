const { digitsOnly } = require("../utils/phone");

const SMSFLY_BASE_URL = (process.env.SMSFLY_BASE_URL || "https://api.smsfly.uz").replace(/\/+$/, "");
const SMSFLY_API_KEY = String(process.env.SMSFLY_API_KEY || "").trim();
const SMSFLY_TIMEOUT_MS = Number(process.env.SMSFLY_TIMEOUT_MS || 15000);
const DEFAULT_TEMPLATE = "Sizning tasdiqlash kodingiz: {code}. Kodni hech kimga bermang.";

function isSmsFlyConfigured() {
  return Boolean(SMSFLY_API_KEY);
}

function buildOtpMessage(code) {
  const template = String(process.env.MARKETPLACE_OTP_SMS_TEMPLATE || DEFAULT_TEMPLATE).trim();
  return template.replace(/\{code\}|\%code\%/gi, String(code || "").trim());
}

async function postJson(path, payload) {
  if (!isSmsFlyConfigured()) {
    throw new Error("SMSFLY_API_KEY topilmadi");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SMSFLY_TIMEOUT_MS);

  try {
    const response = await fetch(`${SMSFLY_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        key: SMSFLY_API_KEY,
        ...payload,
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    if (!response.ok) {
      const reason = data?.reason || response.statusText || "SMSFLY request failed";
      const error = new Error(reason);
      error.status = response.status;
      error.resultCode = data?.resultCode;
      error.response = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkSmsFlyKey() {
  return postJson("/check-key", {});
}

async function sendSmsFlyMessage({ phone, message }) {
  const normalizedPhone = digitsOnly(phone);
  if (!normalizedPhone) {
    throw new Error("Telefon raqam noto'g'ri");
  }
  return postJson("/send", {
    phone: normalizedPhone,
    message: String(message || "").trim(),
  });
}

async function sendMarketplaceOtpSms({ phone, code }) {
  const message = buildOtpMessage(code);
  return sendSmsFlyMessage({ phone, message });
}

module.exports = {
  SMSFLY_BASE_URL,
  isSmsFlyConfigured,
  buildOtpMessage,
  checkSmsFlyKey,
  sendSmsFlyMessage,
  sendMarketplaceOtpSms,
};
