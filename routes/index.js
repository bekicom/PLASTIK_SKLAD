const express = require("express");
const router = express.Router();

// Controllers
const authController = require("../controllers/auth.controller");
const userController = require("../controllers/user.controller");

// Middlewares
const { rAuth, rRole } = require("../middlewares/auth.middleware");

/**
 * AUTH
 */
router.post("/auth/register", authController.register);
router.post("/auth/login", authController.login);

/**
 * USERS (ADMIN only)
 */
router.post("/users/create", rAuth, rRole("ADMIN"), userController.createUser);
router.get("/users", rAuth, rRole("ADMIN"), userController.getUsers);
router.get("/users/:id", rAuth, rRole("ADMIN"), userController.getUserById);
router.put("/users/:id", rAuth, rRole("ADMIN"), userController.updateUser);
router.delete("/users/:id", rAuth, rRole("ADMIN"), userController.deleteUser);


module.exports = router;
