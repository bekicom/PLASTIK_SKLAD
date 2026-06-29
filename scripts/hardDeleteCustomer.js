require("dotenv").config();

const mongoose = require("mongoose");
const { normalizePhone, phoneVariants } = require("../utils/phone");

const Customer = require("../modules/Customer/Customer");
const MarketplaceAccount = require("../modules/marketplace/MarketplaceAccount");
const MarketplaceCart = require("../modules/marketplace/MarketplaceCart");
const { MarketplaceCashbackTransaction, MarketplaceCashbackUseRequest } = require("../modules/marketplace/MarketplaceCashback");
const MarketplaceFavorite = require("../modules/marketplace/MarketplaceFavorite");
const MarketplacePreviousPurchaseSnapshot = require("../modules/marketplace/MarketplacePreviousPurchaseSnapshot");
const MarketplaceQuickReorderLog = require("../modules/marketplace/MarketplaceQuickReorderLog");
const MarketplaceReferral = require("../modules/marketplace/MarketplaceReferral");
const MarketplaceOtpChallenge = require("../modules/marketplace/MarketplaceOtpChallenge");
const CashIn = require("../modules/cashIn/CashIn");
const RealCashTransaction = require("../modules/realCashTransactions/RealCashTransaction");
const AgentDebtPayment = require("../modules/agentDebtPayments/AgentDebtPayment");
const Order = require("../modules/orders/Order");
const Sale = require("../modules/sales/Sale");
const SaleReturn = require("../modules/returns/SaleReturn");
const MobileOrder = require("../modules/MOBIL/MobileOrder");

function pickArg(name) {
  const idx = process.argv.findIndex((item) => item === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefix = `--${name}=`;
  const raw = process.argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

async function countAndDelete(Model, filter, session = null) {
  const count = await Model.countDocuments(filter).session(session || null);
  if (count > 0) {
    await Model.deleteMany(filter).session(session || null);
  }
  return count;
}

async function main() {
  const targetId = pickArg("id");
  const targetName = pickArg("name");

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI topilmadi");
  }

  if (!targetId && !targetName) {
    throw new Error("--id yoki --name berish kerak");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const customer =
    targetId && mongoose.isValidObjectId(targetId)
      ? await Customer.findById(targetId).lean()
      : await Customer.findOne({ name: new RegExp(`^${String(targetName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).lean();

  if (!customer) {
    console.log(JSON.stringify({ ok: false, message: "Customer topilmadi" }, null, 2));
    await mongoose.disconnect();
    return;
  }

  const customerId = customer._id;
  const phone = String(customer.phone || "").trim();
  const phoneNorm = normalizePhone(phone);
  const phoneVariantsList = phoneVariants(phone);
  const customerFilter = { _id: customerId };
  const phoneFilter = phoneVariantsList.length ? { $in: phoneVariantsList } : null;

  const summary = {
    customer: 1,
    marketplaceAccounts: await MarketplaceAccount.countDocuments({ $or: [{ customer_id: customerId }, ...(phoneFilter ? [{ phone: phoneFilter }, { phone_normalized: phoneFilter }] : [])] }),
    marketplaceCarts: await MarketplaceCart.countDocuments({ customer_id: customerId }),
    marketplaceFavorites: await MarketplaceFavorite.countDocuments({ customer_id: customerId }),
    marketplaceCashbackTransactions: await MarketplaceCashbackTransaction.countDocuments({ customer_id: customerId }),
    marketplaceCashbackUseRequests: await MarketplaceCashbackUseRequest.countDocuments({ customer_id: customerId }),
    marketplacePreviousPurchaseSnapshots: await MarketplacePreviousPurchaseSnapshot.countDocuments({ customer_id: customerId }),
    marketplaceQuickReorderLogs: await MarketplaceQuickReorderLog.countDocuments({ customer_id: customerId }),
    marketplaceReferrals: await MarketplaceReferral.countDocuments({ customer_id: customerId }),
    marketplaceOtpChallenges: phoneFilter ? await MarketplaceOtpChallenge.countDocuments({ $or: [{ phone_normalized: phoneNorm }, { phone: phoneFilter }] }) : 0,
    cashIns: await CashIn.countDocuments({ customer_id: customerId }),
    realCashTransactions: await RealCashTransaction.countDocuments({ customer_id: customerId }),
    agentDebtPayments: await AgentDebtPayment.countDocuments({ customer_id: customerId }),
    orders: await Order.countDocuments({ customer_id: customerId }),
    sales: await Sale.countDocuments({ customerId }),
    saleReturns: await SaleReturn.countDocuments({ customer_id: customerId }),
    mobileOrders: await MobileOrder.countDocuments({ customer_id: customerId }),
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (summary.marketplaceAccounts) {
        await MarketplaceAccount.deleteMany({ $or: [{ customer_id: customerId }, ...(phoneFilter ? [{ phone: phoneFilter }, { phone_normalized: phoneFilter }] : [])] }).session(session);
      }
      if (summary.marketplaceCarts) await MarketplaceCart.deleteMany({ customer_id: customerId }).session(session);
      if (summary.marketplaceFavorites) await MarketplaceFavorite.deleteMany({ customer_id: customerId }).session(session);
      if (summary.marketplaceCashbackTransactions) await MarketplaceCashbackTransaction.deleteMany({ customer_id: customerId }).session(session);
      if (summary.marketplaceCashbackUseRequests) await MarketplaceCashbackUseRequest.deleteMany({ customer_id: customerId }).session(session);
      if (summary.marketplacePreviousPurchaseSnapshots) await MarketplacePreviousPurchaseSnapshot.deleteMany({ customer_id: customerId }).session(session);
      if (summary.marketplaceQuickReorderLogs) await MarketplaceQuickReorderLog.deleteMany({ customer_id: customerId }).session(session);
      if (summary.marketplaceReferrals) await MarketplaceReferral.deleteMany({ customer_id: customerId }).session(session);
      if (summary.marketplaceOtpChallenges && phoneFilter) await MarketplaceOtpChallenge.deleteMany({ $or: [{ phone_normalized: phoneNorm }, { phone: phoneFilter }] }).session(session);
      if (summary.cashIns) await CashIn.deleteMany({ customer_id: customerId }).session(session);
      if (summary.realCashTransactions) await RealCashTransaction.deleteMany({ customer_id: customerId }).session(session);
      if (summary.agentDebtPayments) await AgentDebtPayment.deleteMany({ customer_id: customerId }).session(session);
      if (summary.orders) await Order.deleteMany({ customer_id: customerId }).session(session);
      if (summary.sales) await Sale.deleteMany({ customerId }).session(session);
      if (summary.saleReturns) await SaleReturn.deleteMany({ customer_id: customerId }).session(session);
      if (summary.mobileOrders) await MobileOrder.deleteMany({ customer_id: customerId }).session(session);
      await Customer.deleteOne(customerFilter).session(session);
    });
  } finally {
    session.endSession();
  }

  const remaining = {
    customer: await Customer.countDocuments(customerFilter),
    marketplaceAccounts: await MarketplaceAccount.countDocuments({ $or: [{ customer_id: customerId }, ...(phoneFilter ? [{ phone: phoneFilter }, { phone_normalized: phoneFilter }] : [])] }),
    marketplaceCarts: await MarketplaceCart.countDocuments({ customer_id: customerId }),
    marketplaceFavorites: await MarketplaceFavorite.countDocuments({ customer_id: customerId }),
    marketplaceCashbackTransactions: await MarketplaceCashbackTransaction.countDocuments({ customer_id: customerId }),
    marketplaceCashbackUseRequests: await MarketplaceCashbackUseRequest.countDocuments({ customer_id: customerId }),
    marketplacePreviousPurchaseSnapshots: await MarketplacePreviousPurchaseSnapshot.countDocuments({ customer_id: customerId }),
    marketplaceQuickReorderLogs: await MarketplaceQuickReorderLog.countDocuments({ customer_id: customerId }),
    marketplaceReferrals: await MarketplaceReferral.countDocuments({ customer_id: customerId }),
    marketplaceOtpChallenges: phoneFilter ? await MarketplaceOtpChallenge.countDocuments({ $or: [{ phone_normalized: phoneNorm }, { phone: phoneFilter }] }) : 0,
    cashIns: await CashIn.countDocuments({ customer_id: customerId }),
    realCashTransactions: await RealCashTransaction.countDocuments({ customer_id: customerId }),
    agentDebtPayments: await AgentDebtPayment.countDocuments({ customer_id: customerId }),
    orders: await Order.countDocuments({ customer_id: customerId }),
    sales: await Sale.countDocuments({ customerId }),
    saleReturns: await SaleReturn.countDocuments({ customer_id: customerId }),
    mobileOrders: await MobileOrder.countDocuments({ customer_id: customerId }),
  };

  console.log(
    JSON.stringify(
      {
        ok: true,
        deleted_customer: {
          _id: String(customer._id),
          name: customer.name,
          phone: customer.phone || "",
        },
        before: summary,
        after: remaining,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  });
}
