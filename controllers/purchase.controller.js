const mongoose = require("mongoose");
const Supplier = require("../modules/suppliers/Supplier");
const Product = require("../modules/products/Product");
const Purchase = require("../modules/purchases/Purchase");

exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      supplier_id,
      batch_no,
      items: itemsRaw,
      purchase_date, // 🔥 NEW
    } = req.body || {};

    /* =====================
       VALIDATION
    ===================== */
    if (!mongoose.isValidObjectId(supplier_id) || !batch_no) {
      throw new Error("supplier_id yoki batch_no noto‘g‘ri");
    }

    const supplier = await Supplier.findById(supplier_id).session(session);
    if (!supplier) throw new Error("Supplier topilmadi");

    if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
      throw new Error("items majburiy (kamida 1 ta)");
    }

    // 🔥 SANA PARSE (ASOSIY JOY)
    const parsedDate =
      purchase_date && !isNaN(new Date(purchase_date))
        ? new Date(purchase_date)
        : new Date();

    /* =====================
       ITEMS + TOTALS
    ===================== */
    const totals = { UZS: 0, USD: 0 };
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
      const sell_price = Number(it.sell_price || 0);

      if (
        !name ||
        !unit ||
        !["UZS", "USD"].includes(currency) ||
        !Number.isFinite(qty) ||
        qty <= 0 ||
        !Number.isFinite(buy_price) ||
        buy_price <= 0
      ) {
        throw new Error("Item maydonlari noto‘g‘ri");
      }

      const rowTotal = qty * buy_price;
      totals[currency] += rowTotal;

      const product = await Product.findOneAndUpdate(
        {
          supplier_id,
          name,
          model,
          color,
          warehouse_currency: currency,
        },
        {
          $set: {
            category,
            unit,
            buy_price,
            sell_price,
          },
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
       TOTALS / STATUS
    ===================== */
    const paid = { UZS: 0, USD: 0 };
    const remaining = { UZS: totals.UZS, USD: totals.USD };
    const status = remaining.UZS > 0 || remaining.USD > 0 ? "DEBT" : "PAID";

    /* =====================
       CREATE PURCHASE
    ===================== */
    const [purchase] = await Purchase.create(
      [
        {
          supplier_id,
          batch_no: String(batch_no).trim(),
          purchase_date: parsedDate, // 🔥 NEW
          totals,
          paid,
          remaining,
          status,
          items: purchaseItems,
        },
      ],
      { session }
    );

    /* =====================
       SUPPLIER BALANCE UPDATE
    ===================== */
    supplier.balance.UZS += remaining.UZS || 0;
    supplier.balance.USD += remaining.USD || 0;
    await supplier.save({ session });

    await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      message: "Kirim (batch) muvaffaqiyatli saqlandi",
      purchase,
      purchase_date: parsedDate,
      totals,
      remaining,
      products: affectedProducts,
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
;
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

    // 🔥 SANA FILTER (purchase_date BO‘YICHA)
    if (from || to) {
      filter.purchase_date = {};
      if (from) filter.purchase_date.$gte = new Date(from);
      if (to) filter.purchase_date.$lte = new Date(to);
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
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
    });
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
        "Bu batch bo‘yicha to‘lov qilingan. O‘chirish mumkin emas"
      );
    }

    /* =====================
       SUPPLIER BALANCE ROLLBACK
       (faqat qarzni qaytarish)
    ===================== */
    const supplier = await Supplier.findById(purchase.supplier_id).session(
      session
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


