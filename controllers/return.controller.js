const mongoose = require("mongoose");
const SaleReturn = require("../modules/returns/SaleReturn");
const Sale = require("../modules/sales/Sale");
const Warehouse = require("../modules/Warehouse/Warehouse");
const Product = require("../modules/products/Product"); // 🔥 MUHIM

function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function asId(x) {
  if (!x) return null;
  if (typeof x === "object" && x._id) return x._id;
  return x;
}

async function updateProductStockPlus({
  session,
  productId,
  warehouseCurrency,
  qty,
}) {
  if (!productId || !warehouseCurrency) {
    throw new Error("productId yoki warehouseCurrency yo‘q");
  }

  const product = await Product.findOne({
    _id: productId,
    warehouse_currency: warehouseCurrency,
  }).session(session);

  if (!product) {
    throw new Error("Product topilmadi (warehouse_currency mos emas)");
  }

  product.qty += qty;

  if (product.qty < 0) {
    throw new Error("Product qty manfiy bo‘lib ketdi");
  }

  await product.save({ session });
}

exports.createReturn = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let createdReturn = null;

    await session.withTransaction(async () => {
      /* =====================
         AUTH
      ===================== */
      const userId = req.user?._id || req.user?.id;
      if (!userId) throw new Error("Auth required");

      const { sale_id, warehouse_id, items, note } = req.body || {};

      if (!mongoose.isValidObjectId(sale_id))
        throw new Error("sale_id noto‘g‘ri");
      if (!mongoose.isValidObjectId(warehouse_id))
        throw new Error("warehouse_id noto‘g‘ri");
      if (!Array.isArray(items) || items.length === 0)
        throw new Error("items majburiy");

      /* =====================
         LOAD DATA
      ===================== */
      const warehouse = await Warehouse.findById(warehouse_id).session(session);
      if (!warehouse) throw new Error("Ombor topilmadi");

      const sale = await Sale.findById(sale_id).session(session);
      if (!sale) throw new Error("Sale topilmadi");

      if (!sale.customerId) throw new Error("Sale.customerId topilmadi");
      if (!Array.isArray(sale.items) || sale.items.length === 0)
        throw new Error("Sale.items bo‘sh");

      /* =====================
         SALE ITEM MAP
      ===================== */
      const saleItemMap = new Map();
      for (const it of sale.items) {
        saleItemMap.set(`${asId(it.productId)}|${asId(it.warehouseId)}`, it);
      }

      /* =====================
         NORMALIZE RETURN ITEMS
      ===================== */
      const normalizedItems = [];
      let returnSubtotal = 0;

      for (const row of items) {
        const productId = row?.product_id;
        const qty = safeNum(row?.qty);

        if (!mongoose.isValidObjectId(productId))
          throw new Error("items.product_id noto‘g‘ri");
        if (qty <= 0) throw new Error("items.qty 0 dan katta bo‘lishi kerak");

        const key = `${productId}|${warehouse._id}`;
        const saleItem = saleItemMap.get(key);

        if (!saleItem) {
          throw new Error(
            "Bu product ushbu sale ichida yo‘q yoki boshqa ombordan sotilgan"
          );
        }

        // ❗ OVER-RETURN HIMOYASI
        if (qty > saleItem.qty) {
          throw new Error(
            `Qaytarilayotgan miqdor sotilgandan katta (${qty} > ${saleItem.qty})`
          );
        }

        const price = safeNum(saleItem.sell_price, 0);
        const subtotal = price * qty;

        normalizedItems.push({
          product_id: productId,
          qty,
          price,
          subtotal,
          reason: row?.reason ? String(row.reason).trim() : undefined,

          product_snapshot: {
            name: saleItem.productSnapshot?.name,
            unit: saleItem.productSnapshot?.unit,
          },
        });

        returnSubtotal += subtotal;
      }

      /* =====================
         CREATE RETURN
      ===================== */
      const [ret] = await SaleReturn.create(
        [
          {
            sale_id: sale._id,
            customer_id: sale.customerId,
            warehouse_id: warehouse._id,
            items: normalizedItems,
            returnSubtotal,
            note: note ? String(note).trim() : undefined,
            createdBy: userId,
          },
        ],
        { session }
      );

      createdReturn = ret;

      /* =====================
         PRODUCT STOCK +
      ===================== */
      for (const it of normalizedItems) {
        await updateProductStockPlus({
          session,
          productId: it.product_id,
          warehouseCurrency: warehouse.currency, // 🔥 MUHIM
          qty: it.qty,
        });
      }

      /* =====================
         UPDATE SALE ITEMS
      ===================== */
      const retMap = new Map();
      for (const it of normalizedItems) {
        const k = `${it.product_id}|${warehouse._id}`;
        retMap.set(k, safeNum(retMap.get(k), 0) + it.qty);
      }

      const newSaleItems = [];

      for (const it of sale.items) {
        const key = `${asId(it.productId)}|${asId(it.warehouseId)}`;
        const retQty = safeNum(retMap.get(key), 0);

        if (retQty <= 0) {
          newSaleItems.push(it);
          continue;
        }

        const newQty = it.qty - retQty;

        if (newQty > 0) {
          it.qty = newQty;
          it.subtotal = safeNum(it.sell_price, 0) * newQty;
          newSaleItems.push(it);
        }
      }

      /* =====================
         RETURN STATUS
      ===================== */
      if (newSaleItems.length === 0) {
        sale.returnStatus = "FULL_RETURN";
        sale.isHidden = true;
      } else {
        sale.returnStatus = "PARTIAL_RETURN";
        sale.items = newSaleItems;
      }

      await sale.save({ session });
    });

    return res.status(201).json({
      ok: true,
      message: "Vozvrat muvaffaqiyatli yaratildi",
      data: createdReturn,
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      message: err?.message || "Vozvrat yaratishda xato",
    });
  } finally {
    session.endSession();
  }
};

exports.getReturns = async (req, res) => {
  try {
    const filter = {};

    /* =====================
       FILTERS
    ===================== */
    if (req.query.sale_id && mongoose.isValidObjectId(req.query.sale_id)) {
      filter.sale_id = req.query.sale_id;
    }

    if (
      req.query.customer_id &&
      mongoose.isValidObjectId(req.query.customer_id)
    ) {
      filter.customer_id = req.query.customer_id;
    }

    if (
      req.query.warehouse_id &&
      mongoose.isValidObjectId(req.query.warehouse_id)
    ) {
      filter.warehouse_id = req.query.warehouse_id;
    }

    /* =====================
       QUERY
    ===================== */
    const rows = await SaleReturn.find(filter)
      .sort({ createdAt: -1 })
      .populate({
        path: "sale_id",
        select: "invoiceNo createdAt",
      })
      .populate({
        path: "customer_id",
        select: "name phone",
      })
      .populate({
        path: "warehouse_id",
        select: "name currency",
      })
      .lean();

    /* =====================
       MAP RESPONSE
    ===================== */
    const items = rows.map((r) => ({
      _id: r._id,
      createdAt: r.createdAt,

      sale: r.sale_id
        ? {
            _id: r.sale_id._id,
            invoiceNo: r.sale_id.invoiceNo,
            createdAt: r.sale_id.createdAt,
          }
        : null,

      customer: r.customer_id
        ? {
            _id: r.customer_id._id,
            name: r.customer_id.name,
            phone: r.customer_id.phone,
          }
        : null,

      warehouse: r.warehouse_id
        ? {
            _id: r.warehouse_id._id,
            name: r.warehouse_id.name,
            currency: r.warehouse_id.currency,
          }
        : null,

      items: (r.items || []).map((it) => ({
        product_id: it.product_id,
        qty: it.qty,
        price: it.price,
        subtotal: it.subtotal,
        reason: it.reason || "",
        product_snapshot: it.product_snapshot || null,
      })),

      returnSubtotal: r.returnSubtotal,
      note: r.note || "",
      createdBy: r.createdBy,
    }));

    return res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Vozvratlarni olishda xato",
      error: err.message,
    });
  }
};
