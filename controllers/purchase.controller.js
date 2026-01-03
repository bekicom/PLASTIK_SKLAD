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




// controllers/purchase.controller.js
exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      supplier_id,
      batch_no,
      paid_amount_uzs = 0,
      name,
      model,
      color,
      category,
      unit,
      qty,
      buy_price,
      sell_price,
      currency,
      items: itemsRaw,
    } = req.body || {};

    if (!supplier_id || !batch_no) {
      await session.abortTransaction();
      return res.status(400).json({
        ok: false,
        message: "supplier_id va batch_no majburiy",
      });
    }

    if (!mongoose.isValidObjectId(supplier_id)) {
      await session.abortTransaction();
      return res.status(400).json({
        ok: false,
        message: "supplier_id noto‘g‘ri",
      });
    }

    const supplier = await Supplier.findById(supplier_id).session(session);
    if (!supplier) {
      await session.abortTransaction();
      return res.status(404).json({
        ok: false,
        message: "Supplier topilmadi",
      });
    }

    const paidUzs = Number(paid_amount_uzs) || 0;
    if (paidUzs < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        ok: false,
        message: "paid_amount_uzs manfiy bo‘lmasin",
      });
    }

    // =========================
    // ITEMS NORMALIZE
    // =========================
    let items = null;

    if (itemsRaw) {
      try {
        const parsed =
          typeof itemsRaw === "string" ? JSON.parse(itemsRaw) : itemsRaw;
        if (Array.isArray(parsed) && parsed.length) items = parsed;
      } catch (_) {}
    }

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
        },
      ];
    }

    const imageUrl = req.file
      ? `/uploads/products/${req.file.filename}`
      : null;

    let totalUzs = 0;
    const purchaseItems = [];
    const affectedProducts = [];

    // =========================
    // ITEMS LOOP
    // =========================
    for (const it of items) {
      const itName = String(it.name || "").trim();
      const itModel = String(it.model || "").trim();
      const itColor = String(it.color || "").trim();
      const itCategory = String(it.category || "").trim();
      const itUnit = String(it.unit || "").trim();
      const itCurrency = String(it.currency || "").trim();

      const Q = Number(it.qty);
      const BP = Number(it.buy_price);
      const SP = Number(it.sell_price);

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

      if (!["DONA", "PACHKA", "KG"].includes(itUnit)) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: "unit noto‘g‘ri (DONA/PACHKA/KG)",
        });
      }

      if (!["UZS", "USD"].includes(itCurrency)) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: "currency noto‘g‘ri (UZS/USD)",
        });
      }

      if (Q <= 0 || BP < 0 || SP < 0) {
        await session.abortTransaction();
        return res.status(400).json({
          ok: false,
          message: "qty > 0, narxlar manfiy bo‘lmasin",
        });
      }

      const rowTotal = Q * BP;
      if (itCurrency === "UZS") totalUzs += rowTotal;

      const filter = {
        supplier_id,
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

      if (imageUrl) {
        productDoc.images = productDoc.images || [];
        if (!productDoc.images.includes(imageUrl)) {
          productDoc.images.push(imageUrl);
          await productDoc.save({ session });
        }
      }

      affectedProducts.push(productDoc);

      purchaseItems.push({
        product_id: productDoc._id,
        name: productDoc.name,
        model: productDoc.model,
        unit: productDoc.unit,
        qty: Q,
        buy_price: BP,
        sell_price: SP,
        currency: itCurrency,
        row_total_uzs: itCurrency === "UZS" ? rowTotal : 0,
      });
    }

    const debtUzs = Math.max(0, totalUzs - paidUzs);

    supplier.total_debt_uzs =
      Number(supplier.total_debt_uzs || 0) + debtUzs;

    if (paidUzs > 0) {
      supplier.payment_history.push({
        currency: "UZS",
        amount_uzs: paidUzs,
        amount_usd: 0,
        note: `Kirim to‘lovi (batch: ${batch_no})`,
      });
    }

    await supplier.save({ session });

    const [purchase] = await Purchase.create(
      [
        {
          supplier_id,
          batch_no: String(batch_no).trim(),
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
      purchase,
      totals: {
        uzs: { total: totalUzs, paid: paidUzs, debt: debtUzs },
      },
      products: affectedProducts,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
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
