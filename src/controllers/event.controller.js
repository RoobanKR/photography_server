import Event, { EVENT_TYPES } from "../models/Event.js";
import QRCode from "qrcode";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import { checkUploadAllowed } from "../services/storage.js";
import Face from "../models/Face.js";
import { peopleByPhoto, removePhotoFaces } from "../services/faces.js";
import { Readable } from 'stream';

// Helper function to buffer file stream
const bufferToStream = (buffer) => {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
};

// "Wedding/Haldi" style album path from the browser, made safe for Cloudinary folder names
export const cleanFolderPath = (value) => {
  if (typeof value !== "string") return "";
  return value
    .split(/[\\/]+/)
    .map((part) => part.replace(/[^\p{L}\p{M}\p{N} _\-.()&]/gu, "").trim())
    .filter((part) => part && part !== "." && part !== "..")
    .slice(0, 4)
    .map((part) => part.slice(0, 60))
    .join("/");
};

// Upload file to Cloudinary
const uploadToCloudinary = async (file, eventId, folderPath = '', uploadedBy = null) => {
  try {
    const folder = `events/${eventId}${folderPath ? `/${folderPath}` : ''}`;
    
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: file.mimetype.startsWith('video') ? 'video' : 'auto',
          use_filename: true,
          unique_filename: true,
          overwrite: false
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      bufferToStream(file.buffer).pipe(uploadStream);
    });

    return {
      publicId: result.public_id,
      url: result.secure_url,
      type: result.resource_type === 'video' ? 'video' : 
            result.format === 'pdf' ? 'document' : 'image',
      originalName: file.originalname,
      size: result.bytes,
      format: result.format,
      folderPath: folderPath,
      uploadedBy,
      uploadedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload file to Cloudinary');
  }
};

// Delete file from Cloudinary
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true
    });
    return result.result === 'ok';
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    return false;
  }
};

// Link guests open from the QR code
export const guestUrlFor = (eventId) => {
  const publicUrl = (process.env.PUBLIC_URL || process.env.CLIENT_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${publicUrl}/event/${eventId}`;
};

// Loads an event and checks the current user may manage it. Sends the error response itself.
const findOwnedEvent = async (req, res, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: "Invalid event ID" });
    return null;
  }
  const event = await Event.findById(id);
  if (!event) {
    res.status(404).json({ success: false, message: "Event not found" });
    return null;
  }
  if (event.userId.toString() !== req.studioId.toString()) {
    res.status(403).json({ success: false, message: "Not authorized to manage this event" });
    return null;
  }
  return event;
};

// Generate QR Code for event
export const generateQRCode = async (eventId) => {
  try {
    const qrCode = await QRCode.toDataURL(guestUrlFor(eventId), { width: 512, margin: 2 });
    return qrCode;
  } catch (error) {
    console.error("QR Code generation error:", error);
    throw new Error("Failed to generate QR code");
  }
};

// Dates arrive as "YYYY-MM-DD" (stored as UTC midnight). Allow one day of slack
// so "today" is never rejected because of the studio's time zone.
const isBeforeToday = (date) => {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  return date < cutoff;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Copies the editable fields from the request body. Fields that are not sent stay undefined.
const pickEventFields = (body) => {
  const text = (value) => (value === undefined ? undefined : String(value).trim());
  return {
    eventName: text(body.eventName),
    eventType: text(body.eventType),
    clientName: text(body.clientName),
    clientPhone: text(body.clientPhone),
    clientEmail: text(body.clientEmail)?.toLowerCase(),
    description: text(body.description),
    eventDate: body.eventDate ? new Date(body.eventDate) : undefined,
    startTime: text(body.startTime),
    eventPlace: text(body.eventPlace),
    expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
  };
};

// Validates the final values of an event. Returns an error message or null.
const validateEvent = (event, { eventDateChanged }) => {
  if (!event.eventName) return "Event name is required";
  if (!EVENT_TYPES.includes(event.eventType)) return "Choose a valid event type";
  if (!event.clientName) return "Client name is required";
  if (!event.eventPlace) return "Venue is required";
  if (!event.eventDate || isNaN(event.eventDate)) return "Event date is required";
  if (!event.expiryDate || isNaN(event.expiryDate)) return "Gallery expiry date is required";
  if (event.clientEmail && !EMAIL_PATTERN.test(event.clientEmail)) return "Client email is not valid";
  if (event.startTime && !TIME_PATTERN.test(event.startTime)) return "Start time must be HH:mm";
  // Only a new or changed event date has to be in the future, so past events stay editable
  if (eventDateChanged && isBeforeToday(event.eventDate)) return "Event date cannot be in the past";
  if (event.expiryDate < event.eventDate) return "Gallery expiry must be on or after the event date";
  return null;
};

// Create Event
export const createEvent = async (req, res) => {
  try {
    const fields = pickEventFields(req.body);
    const values = { ...fields, eventType: fields.eventType || "other" };

    const validationError = validateEvent(values, { eventDateChanged: true });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const event = new Event({
      ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)),
      userId: req.studioId, // events belong to the studio
      createdBy: req.user._id,
      clientId: req.body.clientId || "",
      status: "active",
      mediaFiles: []
    });

    event.qrCode = await generateQRCode(event._id);
    await event.save();

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      event
    });

  } catch (error) {
    console.error("Create event error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while creating event"
    });
  }
};

// Upload Media Files to Event
export const uploadEventMedia = async (req, res) => {
  try {
    const { eventId } = req.params;
    const files = req.files;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID"
      });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded"
      });
    }

    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    if (event.userId.toString() !== req.studioId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to upload media to this event"
      });
    }

    // Stop before uploading anything if this would go over a storage limit
    const incomingBytes = files.reduce((sum, file) => sum + file.size, 0);
    const limitMessage = await checkUploadAllowed({ studioId: req.studioId, user: req.user, incomingBytes });
    if (limitMessage) {
      return res.status(413).json({ success: false, limitReached: true, message: limitMessage });
    }

    // Folder of each file (same order as the files), sent when a folder or ZIP is uploaded
    let folderPaths = [];
    try {
      folderPaths = JSON.parse(req.body.folderPaths || "[]");
    } catch {
      folderPaths = [];
    }

    const uploadPromises = files.map(async (file, i) =>
      uploadToCloudinary(file, eventId, cleanFolderPath(folderPaths[i]), req.user._id)
    );

    // Keep every file that reached Cloudinary, even if some others failed
    const results = await Promise.allSettled(uploadPromises);
    const uploadedFiles = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const failedFiles = results
      .map((r, i) => (r.status === "rejected" ? files[i].originalname : null))
      .filter(Boolean);

    if (uploadedFiles.length === 0) {
      return res.status(502).json({
        success: false,
        message: "Upload to storage failed. Please try again.",
        failedFiles
      });
    }

    event.mediaFiles.push(...uploadedFiles);
    if (!event.coverPublicId) {
      const firstImage = uploadedFiles.find((f) => f.type === "image");
      if (firstImage) event.coverPublicId = firstImage.publicId;
    }
    await event.save();

    res.status(200).json({
      success: true,
      message: `Uploaded ${uploadedFiles.length} file(s)` + (failedFiles.length ? `, ${failedFiles.length} failed` : ""),
      uploadedFiles,
      failedFiles,
      event: {
        id: event._id,
        eventName: event.eventName,
        totalMediaFiles: event.mediaFiles.length
      }
    });

  } catch (error) {
    console.error("Upload media error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while uploading media",
      error: error.message
    });
  }
};

// Delete Single Media File from Event
export const deleteEventMedia = async (req, res) => {
  try {
    const { eventId, publicId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID"
      });
    }

    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    if (event.userId.toString() !== req.studioId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete media from this event"
      });
    }

    // Decode the publicId if it's URL encoded
    const decodedPublicId = decodeURIComponent(publicId);
    
    const mediaFile = event.mediaFiles.find(file => file.publicId === decodedPublicId);
    if (!mediaFile) {
      return res.status(404).json({
        success: false,
        message: "Media file not found in event"
      });
    }

    // Determine resource type
    const resourceType = mediaFile.type === 'video' ? 'video' : 'image';
    
    // Delete from Cloudinary
    const deleteSuccess = await deleteFromCloudinary(decodedPublicId, resourceType);
    if (!deleteSuccess) {
      console.warn(`Failed to delete from Cloudinary: ${decodedPublicId}`);
      // Continue anyway to maintain consistency
    }

    // Remove from event
    event.mediaFiles = event.mediaFiles.filter(file => file.publicId !== decodedPublicId);
    if (event.coverPublicId === decodedPublicId) event.coverPublicId = "";
    await event.save();
    await removePhotoFaces(event._id, [decodedPublicId]);

    res.status(200).json({
      success: true,
      message: "Media file deleted successfully",
      event: {
        id: event._id,
        eventName: event.eventName,
        totalMediaFiles: event.mediaFiles.length
      }
    });

  } catch (error) {
    console.error("Delete media error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting media",
      error: error.message
    });
  }
};

// Bulk Delete Media Files
export const bulkDeleteEventMedia = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { publicIds } = req.body;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID"
      });
    }

    if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of publicIds to delete"
      });
    }

    const event = await Event.findById(eventId);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    if (event.userId.toString() !== req.studioId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete media from this event"
      });
    }

    // Decode all publicIds
    const decodedPublicIds = publicIds.map(id => decodeURIComponent(id));
    
    // Filter out media files that exist in the event
    const filesToDelete = event.mediaFiles.filter(file => 
      decodedPublicIds.includes(file.publicId)
    );

    if (filesToDelete.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No matching media files found"
      });
    }

    // Delete from Cloudinary
    const deletePromises = filesToDelete.map(file => 
      deleteFromCloudinary(file.publicId, file.type === 'video' ? 'video' : 'image')
    );
    
    const deleteResults = await Promise.allSettled(deletePromises);
    
    // Check for any failures
    const failedDeletes = deleteResults.filter(result => 
      result.status === 'rejected'
    );

    if (failedDeletes.length > 0) {
      console.error('Some files failed to delete from Cloudinary:', failedDeletes);
    }

    // Remove from event
    const originalCount = event.mediaFiles.length;
    event.mediaFiles = event.mediaFiles.filter(file => 
      !decodedPublicIds.includes(file.publicId)
    );
    if (decodedPublicIds.includes(event.coverPublicId)) event.coverPublicId = "";
    await event.save();
    await removePhotoFaces(event._id, decodedPublicIds);

    const deletedCount = originalCount - event.mediaFiles.length;

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${deletedCount} file(s)`,
      deletedCount,
      failedCount: failedDeletes.length,
      event: {
        id: event._id,
        eventName: event.eventName,
        totalMediaFiles: event.mediaFiles.length
      }
    });

  } catch (error) {
    console.error("Bulk delete media error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting media",
      error: error.message
    });
  }
};

// Get All Events for Current User
export const getUserEvents = async (req, res) => {
  try {
    const events = await Event.find({ userId: req.studioId })
      .sort({ createdAt: -1 })
      .select("-__v");

    // Check and update expired events
    for (let event of events) {
      if (event.isExpired() && event.status === "active") {
        event.status = "expired";
        await event.save();
      }
    }

    res.status(200).json({
      success: true,
      events,
      count: events.length
    });
  } catch (error) {
    console.error("Get events error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching events"
    });
  }
};

// Get Single Event with Media
export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID"
      });
    }

    const event = await Event.findById(id);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    if (event.userId.toString() !== req.studioId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this event"
      });
    }

    res.status(200).json({
      success: true,
      event,
      guestUrl: guestUrlFor(event._id)
    });
  } catch (error) {
    console.error("Get event by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching event"
    });
  }
};

// Update Event
export const updateEvent = async (req, res) => {
  try {
    const event = await findOwnedEvent(req, res, req.params.id);
    if (!event) return;

    const fields = pickEventFields(req.body);
    const eventDateChanged = fields.eventDate !== undefined
      && fields.eventDate.getTime() !== event.eventDate.getTime();

    // Apply only the fields that were sent; optional text fields may be cleared with ""
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) event[key] = value;
    }

    const validationError = validateEvent(event, { eventDateChanged });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    // Extending the expiry date reopens the gallery
    if (event.status === "expired" && !event.isExpired()) event.status = "active";

    await event.save();

    res.status(200).json({
      success: true,
      message: "Event updated successfully",
      event
    });
  } catch (error) {
    console.error("Update event error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating event"
    });
  }
};

// Regenerate QR Code (e.g. after PUBLIC_URL changes)
export const regenerateEventQR = async (req, res) => {
  try {
    const event = await findOwnedEvent(req, res, req.params.id);
    if (!event) return;

    event.qrCode = await generateQRCode(event._id);
    await event.save();

    res.status(200).json({ success: true, qrCode: event.qrCode, guestUrl: guestUrlFor(event._id) });
  } catch (error) {
    console.error("Regenerate QR error:", error);
    res.status(500).json({ success: false, message: "Server error while generating QR code" });
  }
};

// Set the event cover photo
export const setEventCover = async (req, res) => {
  try {
    const event = await findOwnedEvent(req, res, req.params.id);
    if (!event) return;

    const { publicId } = req.body;
    const media = event.mediaFiles.find((file) => file.publicId === publicId);
    if (!media || media.type !== "image") {
      return res.status(400).json({ success: false, message: "Choose a photo from this event as the cover" });
    }

    event.coverPublicId = publicId;
    await event.save();

    res.status(200).json({ success: true, coverPublicId: event.coverPublicId });
  } catch (error) {
    console.error("Set cover error:", error);
    res.status(500).json({ success: false, message: "Server error while setting cover" });
  }
};

// Delete Event
export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID"
      });
    }

    const event = await Event.findById(id);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    if (event.userId.toString() !== req.studioId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this event"
      });
    }

    // Delete all media files from Cloudinary
    if (event.mediaFiles && event.mediaFiles.length > 0) {
      const deletePromises = event.mediaFiles.map(file => 
        deleteFromCloudinary(file.publicId, file.type === 'video' ? 'video' : 'image')
      );
      await Promise.allSettled(deletePromises);
    }

    await Event.findByIdAndDelete(id);
    await Face.deleteMany({ eventId: id });

    res.status(200).json({
      success: true,
      message: "Event and all associated media deleted successfully"
    });
  } catch (error) {
    console.error("Delete event error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting event"
    });
  }
};

// Get Event by QR Code (Public) - Includes Media
export const getEventByQR = async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID"
      });
    }

    const event = await Event.findById(eventId)
      .populate("userId", "name email")
      .select("eventName eventType description eventDate startTime eventPlace expiryDate status mediaFiles coverPublicId people createdAt");

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    // Expired galleries are closed to guests; the studio can extend the expiry date to reopen
    if (event.isExpired()) {
      if (event.status === "active") {
        event.status = "expired";
        await event.save();
      }
      return res.status(410).json({
        success: false,
        expired: true,
        message: "This gallery has expired. Please contact the studio."
      });
    }

    // Tag each photo with the people in it, for the gallery's "People" filter
    const photoPeople = await peopleByPhoto(event._id);
    const data = event.toObject();
    data.mediaFiles = data.mediaFiles.map((m) => ({ ...m, people: photoPeople[m.publicId] ?? [] }));
    data.faceSearchReady = data.mediaFiles.some((m) => m.facesScanned);

    res.status(200).json({
      success: true,
      event: data
    });
  } catch (error) {
    console.error("Get event by QR error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching event"
    });
  }
};