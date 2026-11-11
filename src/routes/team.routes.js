import express from "express";
import { requirePermission, verifyToken } from "../controllers/auth.controller.js";
import {
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  getPermissionCatalog,
  listRoles,
  listUsers,
  updateRole,
  updateUser
} from "../controllers/team.controller.js";

const router = express.Router();

router.use(verifyToken);

const canView = requirePermission("users.view");
const canManage = requirePermission("users.manage");

router.get("/permissions", canView, getPermissionCatalog);

router.get("/users", canView, listUsers);
router.post("/users", canManage, createUser);
router.put("/users/:id", canManage, updateUser);
router.delete("/users/:id", canManage, deleteUser);

router.get("/roles", canView, listRoles);
router.post("/roles", canManage, createRole);
router.put("/roles/:id", canManage, updateRole);
router.delete("/roles/:id", canManage, deleteRole);

export default router;
