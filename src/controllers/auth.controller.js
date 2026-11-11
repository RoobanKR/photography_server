import jwt from "jsonwebtoken";
import User from "../models/User.js";
import UserToken from "../models/UserToken.js";
import Role from "../models/Role.js";
import { ALL_PERMISSIONS } from "../config/permissions.js";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this";
const JWT_EXPIRES_IN = "24h";

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// Works out which studio a user belongs to and what they may do there.
// Studio owners always have every permission; team members get their role's permissions.
export const resolveAccess = async (user) => {
  if (user.isOwner()) {
    return { studioId: user._id, permissions: ALL_PERMISSIONS, roleName: "Owner", isOwner: true };
  }
  const role = user.roleId ? await Role.findOne({ _id: user.roleId, studioId: user.studioId }) : null;
  return {
    studioId: user.studioId,
    // The locked Admin role always has everything, including permissions added later
    permissions: role?.isSystem ? ALL_PERMISSIONS : role?.permissions ?? [],
    roleName: role?.name ?? "No role",
    isOwner: false
  };
};

// The user object the client stores and shows
const toSessionUser = (user, access) => ({
  id: user._id,
  email: user.email,
  name: user.name,
  role: access.roleName,
  permissions: access.permissions,
  isOwner: access.isOwner
});

// Login Controller
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email: String(email || "").trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account is disabled. Contact your studio admin."
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Store token in UserToken collection
    const userToken = new UserToken({
      userId: user._id,
      token: token,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress
    });
    await userToken.save();

    user.lastLoginAt = new Date();
    await user.save();

    const access = await resolveAccess(user);

    // Send response
    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: toSessionUser(user, access)
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login"
    });
  }
};

// Verify Token Middleware
// Sets req.user, req.studioId and req.permissions for the routes after it
export const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided"
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if token exists in database
    const tokenExists = await UserToken.findOne({
      token: token,
      userId: decoded.userId
    });

    if (!tokenExists) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token"
      });
    }

    // Get user
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found"
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Your account is disabled"
      });
    }

    const access = await resolveAccess(user);
    req.user = user;
    req.studioId = access.studioId;
    req.permissions = access.permissions;
    req.access = access;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Token expired"
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid token"
    });
  }
};

// Use after verifyToken: allows the request only if the user has every listed permission
export const requirePermission = (...keys) => (req, res, next) => {
  const missing = keys.filter((key) => !req.permissions?.includes(key));
  if (missing.length > 0) {
    return res.status(403).json({
      success: false,
      message: "You don't have permission to do this"
    });
  }
  next();
};

// Logout Controller
export const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies.token;

    if (token) {
      // Remove token from database
      await UserToken.deleteOne({ token: token });
    }

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during logout"
    });
  }
};

// Get current user (with up-to-date role and permissions)
export const getCurrentUser = async (req, res) => {
  res.status(200).json({
    success: true,
    user: toSessionUser(req.user, req.access)
  });
};
