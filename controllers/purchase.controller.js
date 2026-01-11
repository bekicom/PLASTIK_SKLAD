// controllers/purchase.controller.js (createPurchase)

const mongoose = require("mongoose");
const Supplier = require("../modules/suppliers/Supplier");
const Product = require("../modules/products/Product");
const Purchase = require("../modules/purchases/Purchase");

exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { supplier_id, batch_no, items: itemsRaw } = req.body || {};

    /* =====================
       VALIDATION
    ===================== */
    if (!supplier_id || !batch_no) {
      return res.status(400).json({
        ok: false,
        message: "supplier_id va batch_no majburiy",
      });
    }

    const supplier = await Supplier.findById(supplier_id).session(session);
    if (!supplier) {
      return res.status(404).json({ ok: false, message: "Supplier topilmadi" });
    }

    if (!Array.isArray(itemsRaw) || !itemsRaw.length) {
      return res.status(400).json({
        ok: false,
        message: "items majburiy (kamida 1 ta)",
      });
    }

    /* =====================
       ITEMS + TOTALS
    ===================== */
    let totals = { UZS: 0, USD: 0 };
    const purchaseItems = [];
    const affectedProducts = [];

    for (const it of itemsRaw) {
      const name = String(it.name || "").trim();
      const model = String(it.model || "").trim();
      const color = String(it.color || "").trim();
      const category = String(it.category || "").trim();
      const unit = String(it.unit || "").trim();
      const currency = String(it.currency || "").trim();

      const qty = Number(it.qty);
      const buy_price = Number(it.buy_price);
      const sell_price = Number(it.sell_price);

      if (!name || !unit || !currency || !qty || !buy_price) {
        throw new Error("Item maydonlari noto‘g‘ri");
      }

      const rowTotal = qty * buy_price;
      totals[currency] += rowTotal;

      /* =====================
         PRODUCT UPSERT
      ===================== */
      const product = await Product.findOneAndUpdate(
        {
          supplier_id,
          name,
          model,
          color,
          warehouse_currency: currency,
        },
        {
          $set: { category, unit, buy_price, sell_price },
          $inc: { qty },
        },
        { new: true, upsert: true, session }
      );

      affectedProducts.push(product);

      purchaseItems.push({
        product_id: product._id,
        name,
        model,
        unit,
        qty,
        buy_price,
        sell_price,
        currency,
        row_total: rowTotal,
      });
    }

    /* =====================
       🔥 BATCH-QARZ LOGIKASI
    ===================== */

    const paid = { UZS: 0, USD: 0 };

    const remaining = {
      UZS: totals.UZS,
      USD: totals.USD,
    };

    const status = remaining.UZS > 0 || remaining.USD > 0 ? "DEBT" : "PAID";

    /* =====================
       CREATE PURCHASE
    ===================== */
    const [purchase] = await Purchase.create(
      [
        {
          supplier_id,
          batch_no: String(batch_no).trim(),
          totals,
          paid,
          remaining,
          status,
          items: purchaseItems,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      message: "Kirim (batch) muvaffaqiyatli saqlandi",
      purchase,
      totals,
      remaining,
      products: affectedProducts,
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: err.message,
    });
  } finally {
    session.endSession();
  }
};

exports.addProductImage = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "product id noto‘g‘ri" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "Rasm yuborilmadi" });
  }

  const imageUrl = `/uploads/products/${req.file.filename}`;

  const product = await Product.findByIdAndUpdate(
    id,
    { $addToSet: { images: imageUrl } }, // dublikat bo‘lmaydi
    { new: true }
  );

  if (!product) {
    return res.status(404).json({ message: "Product topilmadi" });
  }

  return res.json({
    ok: true,
    message: "Rasm qo‘shildi",
    product,
  });
};
