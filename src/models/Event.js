import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema({
  publicId: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ["image", "video", "document"],
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  format: {
    type: String,
    required: true
  },
  folderPath: {
    type: String
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const eventSchema = new mongoose.Schema({
  eventName: {
    type: String,
    required: [true, "Event name is required"],
    trim: true
  },
  description: {
    type: String,
    required: [true, "Description is required"],
    trim: true
  },
  eventDate: {
    type: Date,
    required: [true, "Event date is required"]
  },
  eventPlace: {
    type: String,
    required: [true, "Event place is required"],
    trim: true
  },
  expiryDate: {
    type: Date,
    required: [true, "Expiry date is required"]
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  clientId: {
    type: String,
    required: true
  },
  qrCode: {
    type: String,
    default: ""
  },
  mediaFiles: [mediaSchema], // Array of media files
  status: {
    type: String,
    enum: ["active", "expired", "cancelled"],
    default: "active"
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Check if event is expired
eventSchema.methods.isExpired = function() {
  return new Date() > this.expiryDate;
};

// Method to add media files
eventSchema.methods.addMediaFile = function(mediaData) {
  this.mediaFiles.push(mediaData);
  return this.save();
};

// Method to remove media file
eventSchema.methods.removeMediaFile = function(publicId) {
  this.mediaFiles = this.mediaFiles.filter(file => file.publicId !== publicId);
  return this.save();
};

// Index for better query performance
eventSchema.index({ userId: 1, createdAt: -1 });
eventSchema.index({ eventDate: 1 });
eventSchema.index({ status: 1 });

const Event = mongoose.model("Event", eventSchema);
export default Event;