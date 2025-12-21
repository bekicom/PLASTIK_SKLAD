const mongoose = require("mongoose");

const Supplier = require("../modules/Suppliers/Supplier");
const Product = require("../modules/products/Product");
const Purchase = require("../modules/Purchases/Purchase");

const UNITS = ["DONA", "PACHKA", "KG"];
const CUR = ["UZS", "USD"];

exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      supplier_id,
      batch_no,
      paid_amount_uzs = 0,
      paid_amount_usd = 0,
      items,
    } = req.body;

    if (!supplier_id || !batch_no) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ ok: false, message: "supplier_id va batch_no majburiy" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ ok: false, message: "items bo‘sh bo‘lmasin" });
    }

    const supplier = await Supplier.findById(supplier_id).session(session);
    if (!supplier) {
      await session.abortTransaction();
      return res.status(404).json({ ok: false, message: "Supplier topilmadi" });
    }

    const paidUzs = Number(paid_amount_uzs || 0);
    const paidUsd = Number(paid_amount_usd || 0);

    if (paidUzs < 0 || paidUsd < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        ok: false,
        message: "paid_amount_uzs yoki paid_amount_usd manfiy bo‘lmasin",
      });
    }

    let totalUzs = 0;
    let totalUsd = 0;

    const purchaseItems = [];
    const affectedProducts = [];

    for (const it of items) {
      const {
        name,
        model,
        color,
        category,
        unit,
        qty,
        buy_price,
        sell_price,
        currency,
      } = it;

      if (
        !name ||
        !unit ||
        qty === undefined ||
        buy_price === undefined ||
        sell_price === undefined ||
        !currency
      ) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message:
            "Har bir item: name, unit, qty, buy_price, sell_price, currency majburiy",
        });
      }

      if (!UNITS.includes(unit)) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ ok: false, message: "unit noto‘g‘ri (DONA/PACHKA/KG)" });
      }

      if (!CUR.includes(currency)) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ ok: false, message: "currency noto‘g‘ri (UZS/USD)" });
      }

      const Q = Number(qty);
      const BP = Number(buy_price);
      const SP = Number(sell_price);

      if (!Number.isFinite(Q) || Q <= 0) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ ok: false, message: "qty 0 dan katta bo‘lsin" });
      }

      if (!Number.isFinite(BP) || BP < 0 || !Number.isFinite(SP) || SP < 0) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: "buy_price va sell_price 0 dan kichik bo‘lmasin",
        });
      }

      // ✅ item totalni o'z valyutasida hisoblaymiz
      const row_total = Q * BP;

      if (currency === "UZS") totalUzs += row_total;
      if (currency === "USD") totalUsd += row_total;

      // Product update/upsert
      const filter = {
        supplier_id,
        name: String(name).trim(),
        model: String(model || "").trim(),
        color: String(color || "").trim(),
        warehouse_currency: currency,
      };

      const update = {
        $set: {
          category: String(category || "").trim(),
          unit,
          buy_price: BP,
          sell_price: SP,
        },
        $inc: { qty: Q },
      };

      const productDoc = await Product.findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        session,
      });

      affectedProducts.push(productDoc);

      purchaseItems.push({
        product_id: productDoc._id,
        name: productDoc.name,
        model: productDoc.model,
        unit,
        qty: Q,
        buy_price: BP,
        sell_price: SP,
        currency,

        // eski maydonni saqlamoqchi bo'lsang:
        row_total_uzs: currency === "UZS" ? row_total : 0,
        // tavsiya: yangi maydon qo'shsang yanada toza bo'ladi:
        // row_total,
      });
    }

    // ✅ endi debtlar manfiy chiqmaydi:
    // paid > total bo'lsa bu "avans" bo'ladi; qarzni 0 qilamiz
    const debtUzs = Math.max(0, totalUzs - paidUzs);
    const debtUsd = Math.max(0, totalUsd - paidUsd);

    // Supplier debt update
    supplier.total_debt_uzs = Math.max(
      0,
      Number(supplier.total_debt_uzs || 0) + (totalUzs - paidUzs)
    );
    supplier.total_debt_usd = Math.max(
      0,
      Number(supplier.total_debt_usd || 0) + (totalUsd - paidUsd)
    );

    // payment history (xohlasang alohida yozamiz)
    if (paidUzs > 0) {
      supplier.payment_history.push({
        amount_uzs: paidUzs,
        note: `Kirim to‘lovi UZS (batch: ${batch_no})`,
      });
    }
    if (paidUsd > 0) {
      supplier.payment_history.push({
        amount_usd: paidUsd,
        note: `Kirim to‘lovi USD (batch: ${batch_no})`,
      });
    }

    await supplier.save({ session });

    const purchase = await Purchase.create(
      [
        {
          supplier_id,
          batch_no: String(batch_no).trim(),

          paid_amount_uzs: paidUzs,
          total_amount_uzs: totalUzs,
          debt_amount_uzs: debtUzs,

          paid_amount_usd: paidUsd,
          total_amount_usd: totalUsd,
          debt_amount_usd: debtUsd,

          items: purchaseItems,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      message: "Kirim saqlandi",
      purchase: purchase[0],
      totals: {
        uzs: { total: totalUzs, paid: paidUzs, debt: debtUzs },
        usd: { total: totalUsd, paid: paidUsd, debt: debtUsd },
      },
      supplier: {
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        total_debt_uzs: supplier.total_debt_uzs,
        total_debt_usd: supplier.total_debt_usd,
      },
      products: affectedProducts,
    });
  } catch (error) {
    await session.abortTransaction();

    if (error?.code === 11000) {
      return res
        .status(409)
        .json({ ok: false, message: "Duplicate product (unique index)" });
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
