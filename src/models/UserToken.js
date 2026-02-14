import mongoose from "mongoose";

const userTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  token: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // Token expires after 24 hours (in seconds)
  },
  userAgent: {
    type: String
  },
  ipAddress: {
    type: String
  }
});

const UserToken = mongoose.model('UserToken', userTokenSchema);
export default UserToken;