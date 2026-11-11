import express from "express";
import {
  createEvent,
  getUserEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  getEventByQR,
  uploadEventMedia,
  deleteEventMedia,
  bulkDeleteEventMedia,
  regenerateEventQR,
  setEventCover
} from "../controllers/event.controller.js";
import { matchGuestFace, resetEventFaces, saveEventFaces } from "../controllers/face.controller.js";
import { requirePermission, verifyToken } from "../controllers/auth.controller.js";
import multer from "multer";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images and videos
    if (
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype === 'application/pdf'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos and PDFs are allowed.'), false);
    }
  }
});

// Protected routes
router.post("/create", verifyToken, requirePermission("events.create"), createEvent);
router.get("/my-events", verifyToken, requirePermission("events.view"), getUserEvents);
router.get("/:id", verifyToken, requirePermission("events.view"), getEventById);
router.put("/:id", verifyToken, requirePermission("events.edit"), updateEvent);
router.delete("/:id", verifyToken, requirePermission("events.delete"), deleteEvent);
router.post("/:id/qr", verifyToken, requirePermission("events.edit"), regenerateEventQR);
router.put("/:id/cover", verifyToken, requirePermission("events.edit"), setEventCover);

// Media upload routes
router.post("/:eventId/upload-media", 
  verifyToken,
  requirePermission("media.upload"),
  upload.array('files', 20), // The client sends large selections in smaller batches
  uploadEventMedia
);

// Fix: Change route order - specific routes before general ones
router.delete("/:eventId/media/:publicId", verifyToken, requirePermission("media.delete"), deleteEventMedia);
router.post("/:eventId/media/bulk-delete", verifyToken, requirePermission("media.delete"), bulkDeleteEventMedia);

// Faces found by the studio's browser, grouped into people for the guest gallery
router.post("/:eventId/faces", verifyToken, requirePermission("media.upload"), saveEventFaces);
router.delete("/:eventId/faces", verifyToken, requirePermission("media.upload"), resetEventFaces);

// Public route for QR code scanning
router.get("/public/:eventId", getEventByQR);
router.post("/public/:eventId/match", matchGuestFace);

export default router;