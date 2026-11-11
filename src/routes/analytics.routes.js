import express from "express";
import { requirePermission, verifyToken } from "../controllers/auth.controller.js";
import { getAnalytics } from "../controllers/analytics.controller.js";

const router = express.Router();

router.get("/", verifyToken, requirePermission("analytics.view"), getAnalytics);

export default router;
