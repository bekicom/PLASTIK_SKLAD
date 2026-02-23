const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const cron = require("node-cron");

const connectDB = require("./config/db");
const mainRoutes = require("./routes");
const initPrinterServer = require("./utils/printerServer");
const Order = require("./models/Order");
const Payment = require("./models/Payment");
const GlobalOrder = require("./models/GlobalOrder");

dotenv.config();

const app = express();

// ✅ Ruxsat berilgan manzillar
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://192.168.0.101:5173",
];

// ✅ CORS sozlamalari
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS bloklandi: " + origin));
      }
    },
    credentials: true,
  }),
);

// ✅ JSON body parser
app.use(express.json());

// ✅ Printer server integratsiyasi
initPrinterServer(app);

// ✅ Lokal MongoDB ulanish
connectDB();

// ✅ API router
app.use("/api", mainRoutes);

// 🚀 Serverni ishga tushirish
const PORT = process.env.PORT || 5034;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server ishga tushdi: ${PORT}-portda`);
});

// ====================================================
// 🧹 Eski buyurtmalarni o‘chirish (har 2 kunda 19:00)
// ====================================================
cron.schedule("0 19 */1 * *", async () => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 10);

    const oldOrders = await Order.find({
      status: "completed",
      paidAt: { $lte: cutoffDate },
    }).select("_id");

    if (!oldOrders.length) {
      console.log("🧹 Eski order topilmadi");
      return;
    }

    const orderIds = oldOrders.map((o) => o._id);

    await Order.deleteMany({ _id: { $in: orderIds } });
    await Payment.deleteMany({ order_id: { $in: orderIds } });

    console.log(`🧹 ${orderIds.length} ta eski buyurtma o‘chirildi`);
  } catch (err) {
    console.error("❌ Cleanup xatolik:", err.message);
  }
});

// ====================================================
// 🔄 SYNC JOB — har 1 daqiqa ishlaydi
// ====================================================
cron.schedule("*/1 * * * *", async () => {
  try {
    console.log("⏰ Global sync (MOVE) boshlandi...");

    // 1️⃣ faqat to‘langan va hali sync bo‘lmaganlar
    const orders = await Order.find({
      status: "paid",
      synced: { $ne: true },
    }).lean();

    if (!orders.length) {
      console.log("✅ Sync qilinadigan zakaz yo‘q");
      return;
    }

    // 2️⃣ _id ni olib tashlaymiz (global DB o‘zi yaratadi)
    const payload = orders.map(({ _id, ...rest }) => rest);

    // 3️⃣ Global DB ga yozamiz
    const inserted = await GlobalOrder.insertMany(payload, {
      ordered: false,
    });

    // ⚠️ Qancha real yozildi
    const insertedCount = inserted.length;

    // 4️⃣ Faqat yozilgan zakazlarni local DB dan o‘chiramiz
    const idsToDelete = orders.slice(0, insertedCount).map((o) => o._id);

    await Order.deleteMany({ _id: { $in: idsToDelete } });

    console.log(
      `🌍 ${insertedCount} ta zakaz global DB ga o‘tkazildi va local DB dan o‘chirildi`,
    );
  } catch (err) {
    if (err.code === 11000) {
      console.warn("⚠️ Dublikat zakazlar bor, ba’zilari o‘tkazilmadi");
    } else {
      console.error("❌ Global sync xatolik:", err);
    }
  }
});





mongodb+srv://bekicomdev_db_user:pN7MhVvgtxms6nns@cluster0.qkwmvb4.mongodb.net/global_orders











// models/GlobalOrder.js
const mongoose = require("mongoose");
const OrderSchema = require("./Order").schema;

// Global ulanish uchun connection
// models/GlobalOrder.js
const mongoose = require("mongoose");
const OrderSchema = require("./Order").schema;

// Global ulanish uchun connection
const globalConn = mongoose.createConnection(
  "mongodb+srv://bekicomdev_db_user:km1Pwg5abT2yhuoH@cluster0.qlcsese.mongodb.net/global_orders",
  { useNewUrlParser: true, useUnifiedTopology: true }
);

const GlobalOrder = globalConn.model("GlobalOrder", OrderSchema);
module.exports = GlobalOrder;
