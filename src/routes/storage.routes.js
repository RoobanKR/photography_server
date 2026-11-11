import express from "express";
import { requirePermission, verifyToken } from "../controllers/auth.controller.js";
import { getStorage, setStorageLimit } from "../controllers/storage.controller.js";

const router = express.Router();

router.use(verifyToken);

router.get("/", requirePermission("storage.view"), getStorage);
router.put("/limits/:userId", requirePermission("users.manage"), setStorageLimit);

export default router;
