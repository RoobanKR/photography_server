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
  bulkDeleteEventMedia
} from "../controllers/event.controller.js";
import { verifyToken } from "../controllers/auth.controller.js";
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
router.post("/create", verifyToken, createEvent);
router.get("/my-events", verifyToken, getUserEvents);
router.get("/:id", verifyToken, getEventById);
router.put("/:id", verifyToken, updateEvent);
router.delete("/:id", verifyToken, deleteEvent);

// Media upload routes
router.post("/:eventId/upload-media", 
  verifyToken, 
  upload.array('files', 50), // Allow up to 50 files
  uploadEventMedia
);

// Fix: Change route order - specific routes before general ones
router.delete("/:eventId/media/:publicId", verifyToken, deleteEventMedia);
router.post("/:eventId/media/bulk-delete", verifyToken, bulkDeleteEventMedia);

// Public route for QR code scanning
router.get("/public/:eventId", getEventByQR);

export default router;