require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const routes = require("./routes");

const app = express();

// ✅ Agar front domenlaring bo'lsa shu yerga yozib qo'y (tavsiya)
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

/**
 * Routes
 */
app.use("/api", routes);

/**
 * ✅ SOCKET.IO (HTTP serverga ulaymiz)
 */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// ✅ Controllerlarda ishlatish uchun
app.set("io", io);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
io.on("connection", (socket) => {
  // ✅ TEST: ulangan hammani cashiers roomga qo‘shamiz
  socket.join("cashiers");
  console.log("SOCKET CONNECTED:", socket.id, "-> joined cashiers");

  socket.emit("socket:ready", { ok: true, room: "cashiers" });

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

    // ✅ app.listen emas, server.listen
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB error:", err);
  });
