// controllers/purchase.controller.js (faqat createPurchase)

const mongoose = require("mongoose");
const Supplier = require("../modules/suppliers/Supplier");
const Product = require("../modules/products/Product");
const Purchase = require("../modules/purchases/Purchase");

const UNITS = ["DONA", "PACHKA", "KG"];
const CUR = ["UZS", "USD"];

function toStr(v) {
  return v === undefined || v === null ? "" : String(v);
}
function trimStr(v) {
  return toStr(v).trim();
}
function safeNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function isValidObjectId(id) {
  return mongoose.isValidObjectId(id);
}

// images normalize (max 5)
function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  const clean = images
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(clean)).slice(0, 5);
}

exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ✅ multipart bo‘lgani uchun req.body string bo‘lib keladi
    const {
      supplier_id,
      batch_no,
      paid_amount_uzs = 0,

      // frontchi bitta product field yuboradi:
      name,
      model,
      color,
      category,
      unit,
      qty,
      buy_price,
      sell_price,
      currency,

      // agar oldin ham items yuborib qolsa (JSON string) qo‘llab-quvvatlaymiz:
      items: itemsRaw,
    } = req.body || {};

    if (!supplier_id || !batch_no) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ ok: false, message: "supplier_id va batch_no majburiy" });
    }

    if (!isValidObjectId(supplier_id)) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ ok: false, message: "supplier_id noto‘g‘ri" });
    }

    const supplier = await Supplier.findById(supplier_id).session(session);
    if (!supplier) {
      await session.abortTransaction();
      return res.status(404).json({ ok: false, message: "Supplier topilmadi" });
    }

    const paidUzs = safeNumber(paid_amount_uzs, 0);
    if (paidUzs < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        ok: false,
        message: "paid_amount_uzs manfiy bo‘lmasin",
      });
    }

    // ✅ 1) items ni olish: avval itemsRaw bo‘lsa parse qilamiz, bo‘lmasa bitta item yasaymiz
    let items = null;

    if (itemsRaw) {
      // itemsRaw JSON string bo‘lishi mumkin
      try {
        const parsed =
          typeof itemsRaw === "string" ? JSON.parse(itemsRaw) : itemsRaw;
        if (Array.isArray(parsed) && parsed.length) items = parsed;
      } catch (e) {
        // parse bo‘lmasa, items ni e’tiborsiz qoldirib bitta item yasaymiz
      }
    }

    // ✅ Bitta item yasash (frontchi xohlagani)
    if (!items) {
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
            "name, unit, qty, buy_price, sell_price, currency majburiy (yoki items yubor)",
        });
      }

      items = [
        {
          name,
          model,
          color,
          category,
          unit,
          qty,
          buy_price,
          sell_price,
          currency,
          // images ni keyin qo‘shamiz
        },
      ];
    }

    // ✅ file bo‘lsa URL yasaymiz
    const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : null;

    let totalUzs = 0;
    const purchaseItems = [];
    const affectedProducts = [];

    for (const it of items) {
      const itName = trimStr(it?.name);
      const itModel = trimStr(it?.model);
      const itColor = trimStr(it?.color);
      const itCategory = trimStr(it?.category);

      const itUnit = trimStr(it?.unit);
      const itCurrency = trimStr(it?.currency);

      const Q = safeNumber(it?.qty, NaN);
      const BP = safeNumber(it?.buy_price, NaN);
      const SP = safeNumber(it?.sell_price, NaN);

      if (
        !itName ||
        !itUnit ||
        !itCurrency ||
        !Number.isFinite(Q) ||
        !Number.isFinite(BP) ||
        !Number.isFinite(SP)
      ) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message:
            "Item: name, unit, currency, qty, buy_price, sell_price majburiy",
        });
      }

      if (!UNITS.includes(itUnit)) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ ok: false, message: "unit noto‘g‘ri (DONA/PACHKA/KG)" });
      }

      if (!CUR.includes(itCurrency)) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ ok: false, message: "currency noto‘g‘ri (UZS/USD)" });
      }

      if (Q <= 0) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ ok: false, message: "qty 0 dan katta bo‘lsin" });
      }
      if (BP < 0 || SP < 0) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: "buy_price va sell_price 0 dan kichik bo‘lmasin",
        });
      }

      // ✅ total UZS faqat currency=UZS bo‘lsa hisoblaymiz (modelda faqat UZS bor)
      const row_total = Q * BP;
      if (itCurrency === "UZS") totalUzs += row_total;

      // Product upsert (sizning eski logika)
      const filter = {
        supplier_id: new mongoose.Types.ObjectId(supplier_id),
        name: itName,
        model: itModel,
        color: itColor,
        warehouse_currency: itCurrency,
      };

      const update = {
        $set: {
          category: itCategory,
          unit: itUnit,
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

      // ✅ images: item.images + (agar 1 ta file kelsa) imageUrl
      const incomingImages = normalizeImages(it?.images);
      if (imageUrl) incomingImages.unshift(imageUrl);
      const cleanImages = normalizeImages(incomingImages);

      let finalProduct = productDoc;

      if (cleanImages.length) {
        const merged = Array.from(
          new Set([...(productDoc.images || []), ...cleanImages])
        ).slice(0, 5);
        finalProduct = await Product.findByIdAndUpdate(
          productDoc._id,
          { $set: { images: merged } },
          { new: true, session }
        );
      }

      affectedProducts.push(finalProduct);

      purchaseItems.push({
        product_id: finalProduct._id,
        name: finalProduct.name,
        model: finalProduct.model,
        unit: itUnit,
        qty: Q,
        buy_price: BP,
        sell_price: SP,
        currency: itCurrency,
        row_total_uzs: itCurrency === "UZS" ? row_total : 0,
      });
    }

    const debtUzs = Math.max(0, totalUzs - paidUzs);

    // Supplier debt update
    supplier.total_debt_uzs = Math.max(
      0,
      safeNumber(supplier.total_debt_uzs, 0) + (totalUzs - paidUzs)
    );

    if (paidUzs > 0) {
      supplier.payment_history.push({
        amount_uzs: paidUzs,
        note: `Kirim to‘lovi UZS (batch: ${trimStr(batch_no)})`,
      });
    }

    await supplier.save({ session });

    const purchaseArr = await Purchase.create(
      [
        {
          supplier_id,
          batch_no: trimStr(batch_no),
          paid_amount_uzs: paidUzs,
          total_amount_uzs: totalUzs,
          debt_amount_uzs: debtUzs,
          items: purchaseItems,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      message: "Kirim saqlandi",
      purchase: purchaseArr[0],
      totals: { uzs: { total: totalUzs, paid: paidUzs, debt: debtUzs } },
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
