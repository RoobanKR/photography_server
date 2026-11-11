import mongoose from "mongoose";

// One detected face in one event photo. Kept out of the Event document because
// 128-number descriptors for thousands of faces would outgrow MongoDB's 16 MB limit.
const faceSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    publicId: { type: String, required: true },
    // Position inside the photo, as fractions (0–1) of its width and height
    box: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      w: { type: Number, required: true },
      h: { type: Number, required: true },
    },
    // face-api.js 128-value face descriptor
    descriptor: { type: [Number], required: true },
    // Group this face belongs to; empty when the person appears in too few photos
    personId: { type: String, default: "" },
  },
  { timestamps: true }
);

faceSchema.index({ eventId: 1, publicId: 1 });

export default mongoose.model("Face", faceSchema);
