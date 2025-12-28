const mongoose = require("mongoose");

const SaleReturn = require("../modules/returns/SaleReturn");
const Sale = require("../modules/sales/Sale");
const Warehouse = require("../modules/Warehouse/Warehouse");

/**
 * Warehouse stock update (default variant)
 * Assumption: Warehouse schema has: products: [{ product_id, qty }]
 * Agar sende boshqacha bo‘lsa, shu funksiyani moslab qo‘yamiz.
 */
async function updateWarehouseStock({
  session,
  warehouseId,
  productId,
  qtyPlus,
}) {
  const inc = Number(qtyPlus || 0);
  if (!Number.isFinite(inc) || inc <= 0) return true;

  // mavjud bo‘lsa inc
  const r1 = await Warehouse.updateOne(
    { _id: warehouseId, "products.product_id": productId },
    { $inc: { "products.$.qty": inc } },
    { session }
  );

  // mavjud bo‘lmasa push
  if (r1.modifiedCount === 0) {
    await Warehouse.updateOne(
      { _id: warehouseId, "products.product_id": { $ne: productId } },
      { $push: { products: { product_id: productId, qty: inc } } },
      { session }
    );
  }

  return true;
}

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
 * POST /returns/create
 * Body: { sale_id, warehouse_id, items:[{product_id, qty, reason?}], note? }
 */
exports.createReturn = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let responseData = null;

    await session.withTransaction(async () => {
      const userId = req.user?._id || req.user?.id || req.userId;
      if (!userId) {
        throw new Error(
          "Auth error: userId topilmadi (Authorization yuborilganmi?)"
        );
      }

      const { sale_id, warehouse_id, items, note } = req.body || {};

      if (!mongoose.isValidObjectId(sale_id))
        throw new Error("sale_id noto‘g‘ri");
      if (!mongoose.isValidObjectId(warehouse_id))
        throw new Error("warehouse_id noto‘g‘ri");
      if (!Array.isArray(items) || items.length === 0)
        throw new Error("items majburiy");

      const wh = await Warehouse.findById(warehouse_id).session(session);
      if (!wh) throw new Error("Ombor topilmadi");

      const sale = await Sale.findById(sale_id).session(session);
      if (!sale) throw new Error("Sale topilmadi");

      const customerId = asId(sale.customerId);
      if (!customerId || !mongoose.isValidObjectId(customerId)) {
        throw new Error("Sale.customerId topilmadi yoki noto‘g‘ri");
      }

      const saleItems = Array.isArray(sale.items) ? sale.items : [];
      if (saleItems.length === 0) throw new Error("Sale.items bo‘sh");

      // Sale items map: productId|warehouseId -> saleItem
      const saleItemMap = new Map();
      for (const it of saleItems) {
        const pId = asId(it.productId);
        const wId = asId(it.warehouseId);
        if (!pId || !wId) continue;
        saleItemMap.set(`${String(pId)}|${String(wId)}`, it);
      }

      // ✅ Normalizatsiya + subtotal hisob
      const normalizedItems = [];
      let returnSubtotal = 0;

      for (const row of items) {
        const productId = row?.product_id;
        const qty = safeNum(row?.qty, 0);

        if (!mongoose.isValidObjectId(productId))
          throw new Error("items.product_id noto‘g‘ri");
        if (qty <= 0) throw new Error("items.qty 0 dan katta bo‘lishi kerak");

        const saleKey = `${String(productId)}|${String(wh._id)}`;
        const saleIt = saleItemMap.get(saleKey);

        if (!saleIt) {
          throw new Error(
            "Bu product ushbu sale ichida yo‘q yoki boshqa ombordan sotilgan (qaytarib bo‘lmaydi)"
          );
        }

        // ✅ LIMIT YO‘Q (sening talabing)
        // oldingi limit tekshiruvi olib tashlandi

        const price = safeNum(
          saleIt.price ?? saleIt.price_snapshot ?? saleIt.priceSnapshot,
          0
        );

        const subtotal = price * qty;

        normalizedItems.push({
          product_id: productId,
          qty,
          price,
          subtotal,
          reason: row?.reason ? String(row.reason).trim() : undefined,
          name_snapshot: saleIt.nameSnapshot || saleIt.name_snapshot,
          unit_snapshot: saleIt.unitSnapshot || saleIt.unit_snapshot,
          price_snapshot: price,
        });

        returnSubtotal += subtotal;
      }

      // ✅ Return hujjati yaratamiz
      const [created] = await SaleReturn.create(
        [
          {
            sale_id: sale._id,
            customer_id: customerId,
            warehouse_id: wh._id,
            items: normalizedItems,
            returnSubtotal,
            note: note ? String(note).trim() : undefined,
            createdBy: userId,
          },
        ],
        { session }
      );

      // ✅ Omborga qayta kirim (stock +)
      for (const it of normalizedItems) {
        await updateWarehouseStock({
          session,
          warehouseId: wh._id,
          productId: it.product_id,
          qtyPlus: it.qty,
        });
      }

      // ✅ Sale.items dan qaytgan qty ni kamaytiramiz (tarixda ko‘rinmasin)
      const retMap = new Map(); // productId|warehouseId -> returnedQty
      for (const it of normalizedItems) {
        const key = `${String(it.product_id)}|${String(wh._id)}`;
        retMap.set(key, safeNum(retMap.get(key), 0) + safeNum(it.qty, 0));
      }

      const newSaleItems = [];
      for (const it of sale.items || []) {
        const pId = asId(it.productId);
        const wId = asId(it.warehouseId);
        const key = `${String(pId)}|${String(wId)}`;

        const retQty = safeNum(retMap.get(key), 0);
        if (retQty <= 0) {
          newSaleItems.push(it);
          continue;
        }

        const oldQty = safeNum(it.qty, 0);
        const newQty = oldQty - retQty;

        // qty 0 yoki manfiy bo‘lsa — item sale’dan tushadi
        if (newQty > 0) {
          it.qty = newQty;

          const price = safeNum(
            it.price ?? it.price_snapshot ?? it.priceSnapshot,
            0
          );
          if (it.subtotal !== undefined) it.subtotal = price * newQty;

          newSaleItems.push(it);
        }
      }

      sale.items = newSaleItems;

      // ✅ returnStatus + yashirish
      if (!sale.items || sale.items.length === 0) {
        sale.returnStatus = "FULL_RETURN";
        sale.isHidden = true; // ✅ sotuv tarixida ko‘rinmasin
      } else {
        sale.returnStatus = "PARTIAL_RETURN";
        // Agar partial ham tarixdan yo‘qolsin desang:
        // sale.isHidden = true;
      }

      await sale.save({ session });

      responseData = created;
    });

    return res.status(201).json({
      ok: true,
      message: "Vozvrat yaratildi",
      data: responseData,
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
