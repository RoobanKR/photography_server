import mongoose from "mongoose";
import User from "../models/User.js";
import Role from "../models/Role.js";
import { computeStudioUsage, GB } from "../services/storage.js";

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// Studio storage: totals, per event and per team member, with their limits
export const getStorage = async (req, res) => {
  try {
    const studioId = new mongoose.Types.ObjectId(req.studioId);
    const [{ total, perEvent, byUser }, users, roles] = await Promise.all([
      computeStudioUsage(studioId),
      User.find({ $or: [{ _id: studioId }, { studioId }] }).select("name email roleId studioId isActive storageLimitBytes").sort({ createdAt: 1 }),
      Role.find({ studioId }).select("name")
    ]);
    const roleNames = new Map(roles.map((r) => [r._id.toString(), r.name]));
    const empty = { bytes: 0, photos: 0, photoBytes: 0, videos: 0, videoBytes: 0, others: 0, otherBytes: 0 };
    const owner = users.find((u) => u._id.equals(studioId));

    const people = users.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      isOwner: u._id.equals(studioId),
      roleName: u._id.equals(studioId) ? "Owner" : roleNames.get(String(u.roleId)) ?? "No role",
      isActive: u.isActive !== false,
      // The owner's own limit is the studio limit, so it isn't shown as a personal one
      limitBytes: u._id.equals(studioId) ? null : u.storageLimitBytes ?? null,
      ...(byUser.get(u._id.toString()) ?? empty)
    }));

    // Media from people who were removed from the team
    const knownIds = new Set(users.map((u) => u._id.toString()));
    for (const [id, usage] of byUser) {
      if (!knownIds.has(id)) {
        people.push({ id, name: "Removed user", email: "", isOwner: false, roleName: "—", isActive: false, limitBytes: null, ...usage });
      }
    }

    res.json({
      success: true,
      total,
      studioLimitBytes: owner?.storageLimitBytes ?? null,
      perEvent: perEvent.sort((a, b) => b.bytes - a.bytes),
      users: people,
      canManageLimits: req.permissions.includes("users.manage"),
      isOwner: req.access.isOwner
    });
  } catch (error) {
    console.error("Get storage error:", error);
    fail(res, 500, "Server error while loading storage");
  }
};

// Sets a storage limit in GB (null removes it). On the owner it limits the whole studio.
export const setStorageLimit = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return fail(res, 400, "Invalid user ID");

    const isStudioLimit = userId === req.studioId.toString();
    if (isStudioLimit && !req.access.isOwner) return fail(res, 403, "Only the studio owner can change the studio limit");

    const user = await User.findOne(isStudioLimit ? { _id: userId } : { _id: userId, studioId: req.studioId });
    if (!user) return fail(res, 404, "User not found");

    const { limitGB } = req.body;
    if (limitGB === null || limitGB === "" || limitGB === undefined) {
      user.storageLimitBytes = null;
    } else {
      const value = Number(limitGB);
      if (isNaN(value) || value <= 0 || value > 100000) return fail(res, 400, "Enter a limit more than 0 and up to 100000 GB");
      user.storageLimitBytes = Math.round(value * GB);
    }
    await user.save();

    res.json({ success: true, limitBytes: user.storageLimitBytes });
  } catch (error) {
    console.error("Set storage limit error:", error);
    fail(res, 500, "Server error while saving the limit");
  }
};
