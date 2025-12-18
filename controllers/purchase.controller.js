const mongoose = require("mongoose");

const Supplier = require("../modules/Suppliers/Supplier");
const Product = require("../modules/Products/Product");
const Purchase = require("../modules/Purchases/Purchase");

const UNITS = ["DONA", "PACHKA", "KG"];
const CUR = ["UZS", "USD"];

/**
 * POST /api/purchases/create
 * Body:
 * {
 *   supplier_id,
 *   batch_no,
 *   usd_rate,
 *   paid_amount_uzs,
 *   items: [
 *     { name, model, color, category, unit, qty, buy_price, sell_price, currency }
 *   ]
 * }
 */
exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { supplier_id, batch_no, usd_rate, paid_amount_uzs, items } =
      req.body;

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

    const rate = Number(usd_rate || 0);
    const paid = Number(paid_amount_uzs || 0);

    let total_uzs = 0;
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

      if (Q <= 0) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ ok: false, message: "qty 0 dan katta bo‘lsin" });
      }

      // UZSga hisoblash (rasmdagi Umumiy summa)
      let row_total_uzs = 0;
      if (currency === "USD") {
        if (!rate || rate <= 0) {
          await session.abortTransaction();
          return res.status(400).json({
            ok: false,
            message: "USD item bor, usd_rate majburiy",
          });
        }
        row_total_uzs = Q * BP * rate;
      } else {
        row_total_uzs = Q * BP;
      }

      total_uzs += row_total_uzs;

      // Productni shu supplierga bog‘lab: topamiz yoki yaratamiz, qty qo‘shamiz
      // Product modelda: supplier_id + name+model+color+warehouse_currency unique
      const filter = {
        supplier_id,
        name: name.trim(),
        model: (model || "").trim(),
        color: (color || "").trim(),
        warehouse_currency: currency, // UZS/USD ombor
      };

      const update = {
        $set: {
          category: (category || "").trim(),
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
        row_total_uzs,
      });
    }

    const debt = total_uzs - paid;

    // Supplier qarzini yangilash
    supplier.total_debt_uzs = Math.max(
      0,
      Number(supplier.total_debt_uzs || 0) + debt
    );

    if (paid > 0) {
      supplier.payment_history.push({
        amount_uzs: paid,
        note: `Kirim to‘lovi (batch: ${batch_no})`,
      });
    }

    await supplier.save({ session });

    // Kirim hujjatini saqlash (history)
    const purchase = await Purchase.create(
      [
        {
          supplier_id,
          batch_no,
          usd_rate: rate,
          paid_amount_uzs: paid,
          total_amount_uzs: total_uzs,
          debt_amount_uzs: debt,
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
        total_amount_uzs: total_uzs,
        paid_amount_uzs: paid,
        debt_amount_uzs: debt,
        usd_rate: rate,
      },
      supplier: {
        id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        total_debt_uzs: supplier.total_debt_uzs,
      },
      products: affectedProducts,
    });
  } catch (error) {
    await session.abortTransaction();

    if (error.code === 11000) {
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
