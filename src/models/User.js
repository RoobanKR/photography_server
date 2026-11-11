import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    trim: true,
    default: ""
  },
  // Legacy account type. Studio owners are "admin"; team members are "member".
  role: {
    type: String,
    enum: ['user', 'admin', 'client', 'member'],
    default: 'user'
  },
  // Team members belong to the studio of the owner who added them.
  // Empty for studio owners: their own _id is the studio id.
  studioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  // The team member's role and permissions (owners always have full access)
  roleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  // Storage this user may use, in bytes (null = no limit).
  // On the studio owner it is the limit for the whole studio.
  storageLimitBytes: {
    type: Number,
    default: null,
    min: 0
  },
  clientId: {
    type: String,
    default: null,
    sparse: true // Allows multiple null values but enforces uniqueness for non-null values
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash the password whenever it is set or changed
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isOwner = function() {
  return !this.studioId;
};

userSchema.methods.getStudioId = function() {
  return this.studioId || this._id;
};

const User = mongoose.model('User', userSchema);
export default User;
