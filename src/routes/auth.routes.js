import express from "express";
import { login, logout, verifyToken, getCurrentUser } from "../controllers/auth.controller.js";

const router = express.Router();

// Login route
router.post("/login", login);

// Logout route
router.post("/logout", logout);

// Protected route example
router.get("/me", verifyToken, getCurrentUser);

export default router;