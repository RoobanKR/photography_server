import mongoose from "mongoose";
import User from "../models/User.js";
import Role from "../models/Role.js";
import UserToken from "../models/UserToken.js";
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from "../config/permissions.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

const slugify = (text) =>
  String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "role";

const cleanPermissions = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((p) => ALL_PERMISSIONS.includes(p)))] : [];

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const toTeamMember = (user, rolesById, studioId) => {
  const isOwner = user._id.toString() === studioId.toString();
  const role = user.roleId ? rolesById.get(user.roleId.toString()) : null;
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    isOwner,
    roleId: isOwner ? null : user.roleId,
    roleName: isOwner ? "Owner" : role?.name ?? "No role",
    isActive: user.isActive !== false,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };
};

// Loads a team member of the current studio (never the owner) or sends an error
const findMember = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    fail(res, 400, "Invalid user ID");
    return null;
  }
  if (id === req.studioId.toString()) {
    fail(res, 403, "The studio owner can't be changed here");
    return null;
  }
  const user = await User.findOne({ _id: id, studioId: req.studioId });
  if (!user) {
    fail(res, 404, "User not found");
    return null;
  }
  return user;
};

const findStudioRole = (studioId, roleId) =>
  mongoose.Types.ObjectId.isValid(roleId) ? Role.findOne({ _id: roleId, studioId }) : null;

// ---------- Permissions ----------

export const getPermissionCatalog = (req, res) => {
  res.json({ success: true, groups: PERMISSION_GROUPS });
};

// ---------- Users ----------

export const listUsers = async (req, res) => {
  try {
    const roles = await Role.ensureDefaults(req.studioId);
    const rolesById = new Map(roles.map((r) => [r._id.toString(), r]));
    const users = await User.find({ $or: [{ _id: req.studioId }, { studioId: req.studioId }] })
      .select("-password")
      .sort({ createdAt: 1 });

    res.json({ success: true, users: users.map((u) => toTeamMember(u, rolesById, req.studioId)) });
  } catch (error) {
    console.error("List users error:", error);
    fail(res, 500, "Server error while loading users");
  }
};

export const createUser = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");

    if (!name) return fail(res, 400, "Name is required");
    if (!EMAIL_PATTERN.test(email)) return fail(res, 400, "Enter a valid email");
    if (password.length < MIN_PASSWORD) return fail(res, 400, `Password must be at least ${MIN_PASSWORD} characters`);

    const role = await findStudioRole(req.studioId, req.body.roleId);
    if (!role) return fail(res, 400, "Choose a role");

    if (await User.exists({ email })) return fail(res, 409, "A user with this email already exists");

    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: "member",
      studioId: req.studioId,
      roleId: role._id,
      isActive: true
    });

    const rolesById = new Map([[role._id.toString(), role]]);
    res.status(201).json({ success: true, user: toTeamMember(user, rolesById, req.studioId) });
  } catch (error) {
    console.error("Create user error:", error);
    fail(res, 500, "Server error while creating user");
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await findMember(req, res);
    if (!user) return;

    const isSelf = user._id.toString() === req.user._id.toString();
    let signOut = false;

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return fail(res, 400, "Name is required");
      user.name = name;
    }
    if (req.body.phone !== undefined) user.phone = String(req.body.phone).trim();

    if (req.body.roleId !== undefined) {
      const role = await findStudioRole(req.studioId, req.body.roleId);
      if (!role) return fail(res, 400, "Choose a role");
      user.roleId = role._id;
    }

    if (req.body.isActive !== undefined) {
      const isActive = Boolean(req.body.isActive);
      if (isSelf && !isActive) return fail(res, 400, "You can't disable your own account");
      if (user.isActive && !isActive) signOut = true;
      user.isActive = isActive;
    }

    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < MIN_PASSWORD) return fail(res, 400, `Password must be at least ${MIN_PASSWORD} characters`);
      user.password = password;
      signOut = !isSelf;
    }

    await user.save();
    // Disabled users and users whose password was reset must sign in again
    if (signOut) await UserToken.deleteMany({ userId: user._id });

    const roles = await Role.find({ studioId: req.studioId });
    const rolesById = new Map(roles.map((r) => [r._id.toString(), r]));
    res.json({ success: true, user: toTeamMember(user, rolesById, req.studioId) });
  } catch (error) {
    console.error("Update user error:", error);
    fail(res, 500, "Server error while updating user");
  }
};

export const deleteUser = async (req, res) => {
  try {
    const user = await findMember(req, res);
    if (!user) return;
    if (user._id.toString() === req.user._id.toString()) return fail(res, 400, "You can't delete your own account");

    await UserToken.deleteMany({ userId: user._id });
    await user.deleteOne();
    res.json({ success: true, message: "User removed" });
  } catch (error) {
    console.error("Delete user error:", error);
    fail(res, 500, "Server error while removing user");
  }
};

// ---------- Roles ----------

export const listRoles = async (req, res) => {
  try {
    const roles = await Role.ensureDefaults(req.studioId);
    const counts = await User.aggregate([
      { $match: { studioId: new mongoose.Types.ObjectId(req.studioId) } },
      { $group: { _id: "$roleId", count: { $sum: 1 } } }
    ]);
    const countByRole = new Map(counts.map((c) => [String(c._id), c.count]));

    res.json({
      success: true,
      roles: roles.map((r) => ({
        id: r._id,
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        isSystem: r.isSystem,
        userCount: countByRole.get(r._id.toString()) ?? 0
      }))
    });
  } catch (error) {
    console.error("List roles error:", error);
    fail(res, 500, "Server error while loading roles");
  }
};

export const createRole = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return fail(res, 400, "Role name is required");

    await Role.ensureDefaults(req.studioId);
    const key = slugify(name);
    if (await Role.exists({ studioId: req.studioId, key })) return fail(res, 409, "A role with this name already exists");

    const role = await Role.create({
      studioId: req.studioId,
      key,
      name,
      description: String(req.body.description || "").trim(),
      permissions: cleanPermissions(req.body.permissions)
    });

    res.status(201).json({ success: true, role: { id: role._id, ...role.toObject(), userCount: 0 } });
  } catch (error) {
    console.error("Create role error:", error);
    fail(res, 500, "Server error while creating role");
  }
};

export const updateRole = async (req, res) => {
  try {
    const role = await findStudioRole(req.studioId, req.params.id);
    if (!role) return fail(res, 404, "Role not found");
    if (role.isSystem) return fail(res, 403, "The Admin role can't be changed");

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return fail(res, 400, "Role name is required");
      const key = slugify(name);
      const clash = await Role.exists({ studioId: req.studioId, key, _id: { $ne: role._id } });
      if (clash) return fail(res, 409, "A role with this name already exists");
      role.name = name;
      role.key = key;
    }
    if (req.body.description !== undefined) role.description = String(req.body.description).trim();
    if (req.body.permissions !== undefined) role.permissions = cleanPermissions(req.body.permissions);

    await role.save();
    res.json({ success: true, role: { id: role._id, ...role.toObject() } });
  } catch (error) {
    console.error("Update role error:", error);
    fail(res, 500, "Server error while updating role");
  }
};

export const deleteRole = async (req, res) => {
  try {
    const role = await findStudioRole(req.studioId, req.params.id);
    if (!role) return fail(res, 404, "Role not found");
    if (role.isSystem) return fail(res, 403, "The Admin role can't be deleted");

    const assigned = await User.countDocuments({ studioId: req.studioId, roleId: role._id });
    if (assigned > 0) return fail(res, 409, `Move the ${assigned} user(s) with this role to another role first`);

    await role.deleteOne();
    res.json({ success: true, message: "Role deleted" });
  } catch (error) {
    console.error("Delete role error:", error);
    fail(res, 500, "Server error while deleting role");
  }
};
