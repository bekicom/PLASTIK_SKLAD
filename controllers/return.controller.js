const mongoose = require("mongoose");

const SaleReturn = require("../modules/returns/SaleReturn");
const Sale = require("../modules/sales/Sale");
const Warehouse = require("../modules/Warehouse/Warehouse");

// Sizda stock qayerda yuradi — shu funksiya ichini moslab qo‘yasiz
async function updateWarehouseStock({
  session,
  warehouseId,
  productId,
  qtyPlus,
}) {
  // TODO: sizdagi stock modelga moslab yozamiz
  return true;
}

function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function asId(x) {
  if (!x) return null;
  if (typeof x === "object" && x._id) return x._id; // populate bo‘lsa
  return x;
}

/**
 * POST /returns/create
 */
exports.createReturn = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // ✅ AUTH: req.user bo‘lishi shart
      const userId = req.user?._id || req.user?.id || req.userId;

      if (!userId) {
        throw new Error(
          "Auth error: userId topilmadi (Authorization header yuborilganmi?)"
        );
      }

      const { sale_id, warehouse_id, refund_type, refund_amount, items, note } =
        req.body || {};

      if (!mongoose.isValidObjectId(sale_id))
        throw new Error("sale_id noto‘g‘ri");
      if (!mongoose.isValidObjectId(warehouse_id))
        throw new Error("warehouse_id noto‘g‘ri");
      if (!["CASH", "BALANCE", "NO_REFUND"].includes(refund_type))
        throw new Error("refund_type noto‘g‘ri");
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

      // ✅ Sale items map: productId + warehouseId bo‘yicha
      const saleItems = Array.isArray(sale.items) ? sale.items : [];
      if (saleItems.length === 0) throw new Error("Sale.items bo‘sh");

      // Key: `${productId}|${warehouseId}`
      const saleItemMap = new Map();
      for (const it of saleItems) {
        const pId = asId(it.productId);
        const wId = asId(it.warehouseId);
        if (!pId || !wId) continue;
        saleItemMap.set(`${String(pId)}|${String(wId)}`, it);
      }

      // ✅ Oldingi returnlar bo‘yicha qaytgan qty (productId + warehouseId)
      const prevReturns = await SaleReturn.find({ sale_id: sale._id })
        .select("items warehouse_id")
        .lean()
        .session(session);

      const returnedQtyMap = new Map();
      for (const r of prevReturns) {
        const rWhId = asId(r.warehouse_id);
        for (const ri of r.items || []) {
          const key = `${String(ri.product_id)}|${String(rWhId)}`;
          returnedQtyMap.set(
            key,
            safeNum(returnedQtyMap.get(key), 0) + safeNum(ri.qty, 0)
          );
        }
      }

      // ✅ Validatsiya + hisob
      const normalizedItems = [];
      let returnSubtotal = 0;

      for (const row of items) {
        const productId = row?.product_id;
        const qty = safeNum(row?.qty, 0);

        if (!mongoose.isValidObjectId(productId))
          throw new Error("items.product_id noto‘g‘ri");
        if (qty <= 0) throw new Error("items.qty 0 dan katta bo‘lishi kerak");

        // 🔥 shu warehouse bo‘yicha topamiz
        const saleKey = `${String(productId)}|${String(wh._id)}`;
        const saleIt = saleItemMap.get(saleKey);

        if (!saleIt) {
          throw new Error(
            "Bu product ushbu sale ichida yo‘q yoki boshqa ombordan sotilgan (qaytarib bo‘lmaydi)"
          );
        }

        const soldQty = safeNum(saleIt.qty, 0);
        const alreadyReturned = safeNum(returnedQtyMap.get(saleKey), 0);

        if (alreadyReturned + qty > soldQty) {
          throw new Error(
            `Qaytarish limiti oshib ketdi. Sold: ${soldQty}, Returned: ${alreadyReturned}, New: ${qty}`
          );
        }

        const price = safeNum(saleIt.price, 0);
        const subtotal = price * qty;

        // ✅ MUHIM: SaleReturn schema items.price REQUIRED -> price qo‘shildi
        normalizedItems.push({
          product_id: productId,
          qty,
          price, // ✅ required
          subtotal, // ✅ required
          reason: row?.reason ? String(row.reason).trim() : undefined,

          // ixtiyoriy snapshotlar (schema’da bo‘lsa saqlanadi)
          name_snapshot: saleIt.nameSnapshot,
          unit_snapshot: saleIt.unitSnapshot,
        });

        returnSubtotal += subtotal;
      }

      // ✅ refund policy
      const refundAmt = safeNum(refund_amount, 0);
      if (refund_type === "NO_REFUND" && refundAmt > 0)
        throw new Error("NO_REFUND bo‘lsa refund_amount 0 bo‘lishi kerak");
      if (refundAmt < 0) throw new Error("refund_amount noto‘g‘ri");
      if (refundAmt > returnSubtotal)
        throw new Error("refund_amount returnSubtotal dan oshmasin");

      // ✅ Return hujjati
      const [created] = await SaleReturn.create(
        [
          {
            sale_id: sale._id,
            customer_id: customerId,
            warehouse_id: wh._id,
            items: normalizedItems,
            returnSubtotal,
            refund_type,
            refund_amount: refundAmt,
            note: note ? String(note).trim() : undefined,
            createdBy: userId, // ✅ required
          },
        ],
        { session }
      );

      // ✅ Stockni omborga qaytaramiz
      for (const it of normalizedItems) {
        await updateWarehouseStock({
          session,
          warehouseId: wh._id,
          productId: it.product_id,
          qtyPlus: it.qty,
        });
      }

      // ✅ Sale returnStatus (shu warehouse bo‘yicha)
      let totalSold = 0;
      for (const it of saleItems) {
        const wId = asId(it.warehouseId);
        if (String(wId) === String(wh._id)) totalSold += safeNum(it.qty, 0);
      }

      let totalReturnedAll = 0;
      for (const [k, v] of returnedQtyMap.entries()) {
        if (k.endsWith(`|${String(wh._id)}`)) totalReturnedAll += safeNum(v, 0);
      }

      let newReturned = 0;
      for (const it of normalizedItems) newReturned += safeNum(it.qty, 0);

      const totalReturnedNow = totalReturnedAll + newReturned;

      let returnStatus = "PARTIAL_RETURN";
      if (totalReturnedNow <= 0) returnStatus = "NO_RETURN";
      else if (totalSold > 0 && totalReturnedNow >= totalSold)
        returnStatus = "FULL_RETURN";

      sale.returnStatus = returnStatus;
      await sale.save({ session });

      return res.status(201).json({
        ok: true,
        message: "Vozvrat yaratildi",
        data: created,
      });
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



