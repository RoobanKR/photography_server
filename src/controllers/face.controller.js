import mongoose from "mongoose";
import Event from "../models/Event.js";
import Face from "../models/Face.js";
import { isDescriptor, matchSelfie, MATCH_THRESHOLD, regroupEventFaces } from "../services/faces.js";

const MAX_PHOTOS_PER_REQUEST = 50;
const MAX_FACES_PER_PHOTO = 60;

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

// Save faces the studio's browser found in event photos, then regroup people
export const saveEventFaces = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { results } = req.body;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID" });
    }
    if (!Array.isArray(results) || results.length === 0 || results.length > MAX_PHOTOS_PER_REQUEST) {
      return res.status(400).json({ success: false, message: `Send between 1 and ${MAX_PHOTOS_PER_REQUEST} photo results` });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (event.userId.toString() !== req.studioId.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to update this event" });
    }

    const photos = new Map(event.mediaFiles.filter((m) => m.type === "image").map((m) => [m.publicId, m]));
    const docs = [];
    const scanned = [];

    for (const result of results) {
      const media = photos.get(result?.publicId);
      if (!media || !Array.isArray(result.faces)) continue;
      scanned.push(media.publicId);
      for (const face of result.faces.slice(0, MAX_FACES_PER_PHOTO)) {
        if (!isDescriptor(face?.descriptor) || !face.box) continue;
        docs.push({
          eventId,
          publicId: media.publicId,
          box: { x: clamp01(face.box.x), y: clamp01(face.box.y), w: clamp01(face.box.w), h: clamp01(face.box.h) },
          descriptor: face.descriptor,
        });
      }
    }

    // Rescanning a photo replaces its old faces
    await Face.deleteMany({ eventId, publicId: { $in: scanned } });
    if (docs.length) await Face.insertMany(docs);

    for (const publicId of scanned) photos.get(publicId).facesScanned = true;
    await event.save();

    const people = await regroupEventFaces(eventId);
    res.json({ success: true, scanned, facesSaved: docs.length, people });
  } catch (error) {
    console.error("Save faces error:", error);
    res.status(500).json({ success: false, message: "Server error while saving faces" });
  }
};

// Clear all faces of an event so the studio can scan again from scratch
export const resetEventFaces = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID" });
    }
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (event.userId.toString() !== req.studioId.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to update this event" });
    }

    await Face.deleteMany({ eventId });
    for (const media of event.mediaFiles) media.facesScanned = false;
    event.people = [];
    await event.save();
    res.json({ success: true });
  } catch (error) {
    console.error("Reset faces error:", error);
    res.status(500).json({ success: false, message: "Server error while resetting faces" });
  }
};

// Public: a guest sends the descriptor of their selfie and gets back their photos.
// The selfie itself never leaves the guest's browser.
export const matchGuestFace = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { descriptor, threshold } = req.body;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID" });
    }
    if (!isDescriptor(descriptor)) {
      return res.status(400).json({ success: false, message: "A face descriptor is required" });
    }

    const event = await Event.findById(eventId, "expiryDate status");
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (event.isExpired()) {
      return res.status(410).json({ success: false, expired: true, message: "This gallery has expired" });
    }

    const limit = Math.min(0.65, Math.max(0.35, Number(threshold) || MATCH_THRESHOLD));
    const matches = await matchSelfie(eventId, descriptor, limit);
    res.json({ success: true, matches });
  } catch (error) {
    console.error("Match face error:", error);
    res.status(500).json({ success: false, message: "Server error while matching face" });
  }
};
