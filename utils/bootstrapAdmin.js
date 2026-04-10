const bcrypt = require("bcrypt");
const User = require("../modules/Users/User");

async function bootstrapAdmin() {
  const adminLogin = String(process.env.BOOTSTRAP_ADMIN_LOGIN || "admin")
    .trim()
    .toLowerCase();
  const adminPassword = String(
    process.env.BOOTSTRAP_ADMIN_PASSWORD || "123456",
  ).trim();
  const adminName = String(process.env.BOOTSTRAP_ADMIN_NAME || "Admin").trim();
  const adminPhone = String(
    process.env.BOOTSTRAP_ADMIN_PHONE || "998900000000",
  ).trim();

  if (!adminLogin || !adminPassword) return;

  const existing = await User.findOne({
    login: { $regex: `^${adminLogin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });

  const hashed = await bcrypt.hash(adminPassword, 10);

  if (existing) {
    existing.login = adminLogin;
    existing.password = hashed;
    existing.role = "ADMIN";
    if (!existing.name) existing.name = adminName;
    if (!existing.phone) existing.phone = adminPhone;
    await existing.save();
    return;
  }

  const phoneTaken = await User.findOne({ phone: adminPhone });
  await User.create({
    name: adminName,
    phone: phoneTaken ? `9${Date.now().toString().slice(-11)}` : adminPhone,
    login: adminLogin,
    password: hashed,
    role: "ADMIN",
  });
}

module.exports = { bootstrapAdmin };

