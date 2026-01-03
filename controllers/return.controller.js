const mongoose = require("mongoose");

const SaleReturn = require("../modules/returns/SaleReturn");
const Sale = require("../modules/sales/Sale");
const Warehouse = require("../modules/Warehouse/Warehouse");

/* =======================
   HELPERS
======================= */
function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function asId(x) {
  if (!x) return null;
  if (typeof x === "object" && x._id) return x._id;
  return x;
}

/**
 * Warehouse stock update
 * Assumption: Warehouse schema:
 * products: [{ product_id, qty }]
 */
async function updateWarehouseStock({
  session,
  warehouseId,
  productId,
  qtyPlus,
}) {
  const inc = safeNum(qtyPlus);
  if (inc <= 0) return;

  const r1 = await Warehouse.updateOne(
    { _id: warehouseId, "products.product_id": productId },
    { $inc: { "products.$.qty": inc } },
    { session }
  );

  if (r1.modifiedCount === 0) {
    await Warehouse.updateOne(
      { _id: warehouseId },
      { $push: { products: { product_id: productId, qty: inc } } },
      { session }
    );
  }
}

/**
 * POST /returns/create
 * Body:
 * {
 *   sale_id,
 *   warehouse_id,
 *   items:[{ product_id, qty, reason? }],
 *   note?
 * }
 */
exports.createReturn = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let createdReturn = null;

    await session.withTransaction(async () => {
      const userId = req.user?._id || req.user?.id;
      if (!userId) throw new Error("Auth required");

      const { sale_id, warehouse_id, items, note } = req.body || {};

      if (!mongoose.isValidObjectId(sale_id))
        throw new Error("sale_id noto‘g‘ri");
      if (!mongoose.isValidObjectId(warehouse_id))
        throw new Error("warehouse_id noto‘g‘ri");
      if (!Array.isArray(items) || items.length === 0)
        throw new Error("items majburiy");

      const warehouse = await Warehouse.findById(warehouse_id).session(session);
      if (!warehouse) throw new Error("Ombor topilmadi");

      const sale = await Sale.findById(sale_id).session(session);
      if (!sale) throw new Error("Sale topilmadi");

      const customerId = asId(sale.customerId);
      if (!customerId) throw new Error("Sale.customerId topilmadi");

      if (!Array.isArray(sale.items) || sale.items.length === 0) {
        throw new Error("Sale.items bo‘sh");
      }

      /* =======================
         SALE ITEM MAP
      ======================= */
      const saleItemMap = new Map();
      for (const it of sale.items) {
        const pId = asId(it.productId);
        const wId = asId(it.warehouseId);
        if (pId && wId) {
          saleItemMap.set(`${pId}|${wId}`, it);
        }
      }

      /* =======================
         NORMALIZE RETURN ITEMS
      ======================= */
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

        const price = safeNum(
          saleItem.price ?? saleItem.price_snapshot ?? saleItem.priceSnapshot,
          0
        );

        const subtotal = price * qty;

        normalizedItems.push({
          product_id: productId,
          qty,
          price,
          subtotal,
          reason: row?.reason ? String(row.reason).trim() : undefined,

          // snapshotlar
          name_snapshot: saleItem.nameSnapshot,
          unit_snapshot: saleItem.unitSnapshot,
          price_snapshot: price,
        });

        returnSubtotal += subtotal;
      }

      /* =======================
         CREATE RETURN DOC
      ======================= */
      const [ret] = await SaleReturn.create(
        [
          {
            sale_id: sale._id,
            customer_id: customerId,
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

      /* =======================
         WAREHOUSE STOCK +
      ======================= */
      for (const it of normalizedItems) {
        await updateWarehouseStock({
          session,
          warehouseId: warehouse._id,
          productId: it.product_id,
          qtyPlus: it.qty,
        });
      }

      /* =======================
         UPDATE SALE (MUHIM JOY)
      ======================= */
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

        const oldQty = safeNum(it.qty);
        const newQty = oldQty - retQty;

        if (newQty > 0) {
          it.qty = newQty;

          const price = safeNum(
            it.price ?? it.price_snapshot ?? it.priceSnapshot,
            0
          );

          it.subtotal = price * newQty;
          newSaleItems.push(it);
        }
      }

      // ❗ ENG MUHIM FIX
      if (newSaleItems.length === 0) {
        // FULL RETURN
        sale.returnStatus = "FULL_RETURN";
        sale.isHidden = true;
        // ❌ sale.items = [] QILMAYMIZ
      } else {
        // PARTIAL RETURN
        sale.returnStatus = "PARTIAL_RETURN";
        sale.items = newSaleItems;
      }

      await sale.save({ session });
    });

    return res.status(201).json({
      ok: true,
      message: "Vozvrat yaratildi",
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
