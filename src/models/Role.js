import mongoose from "mongoose";
import { ALL_PERMISSIONS, DEFAULT_ROLES } from "../config/permissions.js";

const roleSchema = new mongoose.Schema({
  // The studio owner's user id; every studio has its own set of roles
  studioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  key: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: [true, "Role name is required"],
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ""
  },
  permissions: {
    type: [String],
    default: [],
    validate: {
      validator: (list) => list.every((p) => ALL_PERMISSIONS.includes(p)),
      message: "Unknown permission"
    }
  },
  // System roles (Admin) can't be edited or deleted
  isSystem: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

roleSchema.index({ studioId: 1, key: 1 }, { unique: true });

// Creates the default roles for a studio if it has none yet, then returns all its roles
roleSchema.statics.ensureDefaults = async function (studioId) {
  const existing = await this.find({ studioId }).sort({ createdAt: 1 });
  if (existing.length > 0) return existing;
  await this.insertMany(DEFAULT_ROLES.map((role) => ({ ...role, studioId })));
  return this.find({ studioId }).sort({ createdAt: 1 });
};

const Role = mongoose.model("Role", roleSchema);
export default Role;
