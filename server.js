require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// 🔹 ROUTERS
const skladRoutes = require("./routes"); // routes/index.js → sklad.routes.js
const appRoutes = require("./routes/appRouter.Route"); // faqat MOBILE APP

const app = express();

/**
 * CORS
 */
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : true;

/**
 * Middlewares
 */
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/**
 * ROUTES
 * 🔥 IKKITA ALOHIDA API OQIMI
 */
app.use("/api", skladRoutes); // 🏢 ZKLAD / ADMIN
app.use("/api", appRoutes); // 📱 MOBILE APP

/**
 * HTTP + SOCKET.IO
 */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// controllerlardan foydalanish uchun
app.set("io", io);

io.on("connection", (socket) => {
  // hozircha test uchun
  socket.join("cashiers");
  console.log("SOCKET CONNECTED:", socket.id);

  socket.emit("socket:ready", { ok: true });

  socket.on("disconnect", (reason) => {
    console.log("SOCKET DISCONNECT:", socket.id, reason);
  });
});

/**
 * MongoDB
 */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
     
    });
  })
  .catch((err) => {
    console.error("MongoDB error:", err);
  });
