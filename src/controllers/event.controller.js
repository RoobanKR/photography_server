import Event from "../models/Event.js";
import QRCode from "qrcode";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import { Readable } from 'stream';

// Helper function to buffer file stream
const bufferToStream = (buffer) => {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
};

// Upload file to Cloudinary
const uploadToCloudinary = async (file, eventId, folderPath = '') => {
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

// Generate QR Code for event
const generateQRCode = async (eventId) => {
  try {
    const eventData = `${process.env.PUBLIC_URL || "https://photography-theta-self.vercel.app"}/event/${eventId}`;
    const qrCode = await QRCode.toDataURL(eventData);
    return qrCode;
  } catch (error) {
    console.error("QR Code generation error:", error);
    throw new Error("Failed to generate QR code");
  }
};

// Create Event
export const createEvent = async (req, res) => {
  try {
    const { eventName, description, eventDate, eventPlace, expiryDate, clientId } = req.body;
    const userId = req.user._id;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required"
      });
    }

    const now = new Date();
    const eventDateObj = new Date(eventDate);
    const expiryDateObj = new Date(expiryDate);

    if (eventDateObj < now) {
      return res.status(400).json({
        success: false,
        message: "Event date cannot be in the past"
      });
    }

    if (expiryDateObj < eventDateObj) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be after event date"
      });
    }

    const event = new Event({
      eventName,
      description,
      eventDate: eventDateObj,
      eventPlace,
      expiryDate: expiryDateObj,
      userId,
      clientId,
      status: "active",
      mediaFiles: []
    });

    const qrCode = await generateQRCode(event._id);
    event.qrCode = qrCode;

    await event.save();

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      event: {
        id: event._id,
        eventName: event.eventName,
        description: event.description,
        eventDate: event.eventDate,
        eventPlace: event.eventPlace,
        expiryDate: event.expiryDate,
        qrCode: event.qrCode,
        mediaFiles: event.mediaFiles,
        status: event.status,
        clientId: event.clientId,
        createdAt: event.createdAt
      }
    });

  } catch (error) {
    console.error("Create event error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while creating event",
      error: error.message
    });
  }
};

// Upload Media Files to Event
export const uploadEventMedia = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;
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

    if (event.userId.toString() !== userId.toString() && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to upload media to this event"
      });
    }

    // Process file uploads
    const uploadPromises = files.map(async (file) => {
      let folderPath = '';
      if (file.originalname.includes('/')) {
        const parts = file.originalname.split('/');
        folderPath = parts.slice(0, -1).join('/');
      }
      
      return await uploadToCloudinary(file, eventId, folderPath);
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    // Add uploaded files to event
    event.mediaFiles.push(...uploadedFiles);
    await event.save();

    res.status(200).json({
      success: true,
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
      uploadedFiles,
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
    const userId = req.user._id;

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

    if (event.userId.toString() !== userId.toString() && req.user.role !== "admin") {
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
    await event.save();

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
    const userId = req.user._id;

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

    if (event.userId.toString() !== userId.toString() && req.user.role !== "admin") {
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
    await event.save();

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
    const userId = req.user._id;
    const events = await Event.find({ userId })
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

    if (event.userId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this event"
      });
    }

    res.status(200).json({
      success: true,
      event
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
    const { id } = req.params;
    const { eventName, description, eventDate, eventPlace, expiryDate } = req.body;

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

    if (event.userId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this event"
      });
    }

    // Update fields
    if (eventName) event.eventName = eventName;
    if (description) event.description = description;
    if (eventDate) event.eventDate = new Date(eventDate);
    if (eventPlace) event.eventPlace = eventPlace;
    if (expiryDate) event.expiryDate = new Date(expiryDate);

    // Validate updated dates
    if (event.eventDate < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Event date cannot be in the past"
      });
    }

    if (event.expiryDate < event.eventDate) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be after event date"
      });
    }

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

    if (event.userId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
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
      .select("eventName description eventDate eventPlace expiryDate status mediaFiles createdAt");

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found"
      });
    }

    // Check if event is expired
    if (event.isExpired() && event.status === "active") {
      event.status = "expired";
      await event.save();
    }

    res.status(200).json({
      success: true,
      event
    });
  } catch (error) {
    console.error("Get event by QR error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching event"
    });
  }
};