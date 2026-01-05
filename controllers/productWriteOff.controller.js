const mongoose = require("mongoose");
const Product = require("../modules/products/Product");
const Expense = require("../modules/expenses/Expense");
const ProductWriteOff = require("../modules/writeOff/ProductWriteOff");

exports.createProductWriteOff = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { product_id, qty, reason } = req.body;

    if (!mongoose.isValidObjectId(product_id)) {
      throw new Error("product_id noto‘g‘ri");
    }

    const writeQty = Number(qty);
    if (!Number.isFinite(writeQty) || writeQty <= 0) {
      throw new Error("qty noto‘g‘ri");
    }

    if (!reason || !reason.trim()) {
      throw new Error("reason majburiy");
    }

    /* =========================
       1. PRODUCTNI OLAMIZ
    ========================= */
    const product = await Product.findById(product_id).session(session);
    if (!product) throw new Error("Product topilmadi");

    if (product.qty < writeQty) {
      throw new Error(`Omborda yetarli mahsulot yo‘q. Bor: ${product.qty}`);
    }

    /* =========================
       2. STOCK KAMAYTIRISH
    ========================= */
    product.qty -= writeQty;
    await product.save({ session });

    /* =========================
       3. ZARARNI HISOBLASH
    ========================= */
    const lossAmount = writeQty * Number(product.buy_price || 0);

    /* =========================
       4. WRITE-OFF LOG
    ========================= */
    await ProductWriteOff.create(
      [
        {
          product_id: product._id,
          qty: writeQty,
          currency: product.warehouse_currency,
          loss_amount: lossAmount,
          reason,
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    /* =========================
       5. EXPENSE YOZISH
    ========================= */
 await Expense.create(
   [
     {
       category: "PRODUCT_WRITE_OFF",
       amount: lossAmount,
       currency: product.warehouse_currency,
       note: `${product.name} – ${writeQty} dona spisat (${reason})`,
       expense_date: new Date(),
       createdBy: req.user?._id, // 🔥 MANA SHU YETISHMAYOTGAN EDI
     },
   ],
   { session }
 );


    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Product spisat qilindi",
      product: {
        id: product._id,
        name: product.name,
        remaining_qty: product.qty,
      },
      write_off: {
        qty: writeQty,
        loss: lossAmount,
        currency: product.warehouse_currency,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({
      ok: false,
      message: error.message,
    });
  } finally {
    session.endSession();
  }
};
