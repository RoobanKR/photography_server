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
  // Who uploaded it; counts towards their storage limit
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  // Set once the studio's browser has looked for faces in this photo
  facesScanned: {
    type: Boolean,
    default: false
  }
});

// A person found in several photos (see services/faces.js)
const personSchema = new mongoose.Schema({
  personId: { type: String, required: true },
  photoCount: { type: Number, default: 0 },
  coverPublicId: { type: String, default: "" },
  coverBox: { x: Number, y: Number, w: Number, h: Number }
}, { _id: false });

export const EVENT_TYPES = [
  "wedding", "engagement", "pre-wedding", "reception", "birthday",
  "baby-shower", "maternity", "corporate", "portrait", "other"
];

const eventSchema = new mongoose.Schema({
  eventName: {
    type: String,
    required: [true, "Event name is required"],
    trim: true
  },
  eventType: {
    type: String,
    enum: EVENT_TYPES,
    default: "other"
  },
  // Client details (optional on old events, required for new ones by the controller)
  clientName: { type: String, trim: true, default: "" },
  clientPhone: { type: String, trim: true, default: "" },
  clientEmail: { type: String, trim: true, lowercase: true, default: "" },
  description: {
    type: String,
    trim: true,
    default: ""
  },
  eventDate: {
    type: Date,
    required: [true, "Event date is required"]
  },
  // "HH:mm", kept separate so eventDate stays a plain calendar date
  startTime: { type: String, default: "" },
  eventPlace: {
    type: String,
    required: [true, "Event place is required"],
    trim: true
  },
  expiryDate: {
    type: Date,
    required: [true, "Expiry date is required"]
  },
  // The studio (owner's user id) the event belongs to
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  // The team member who created it
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  clientId: {
    type: String,
    default: ""
  },
  qrCode: {
    type: String,
    default: ""
  },
  // publicId of the media file shown as the event cover
  coverPublicId: {
    type: String,
    default: ""
  },
  mediaFiles: [mediaSchema], // Array of media files
  people: { type: [personSchema], default: [] },
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

eventSchema.pre("save", function () {
  this.updatedAt = new Date();
});

// Check if event is expired
// expiryDate is a calendar date (UTC midnight), so the gallery stays open through that whole day
eventSchema.methods.isExpired = function() {
  const endOfExpiryDay = new Date(this.expiryDate.getTime() + 24 * 60 * 60 * 1000);
  return new Date() > endOfExpiryDay;
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