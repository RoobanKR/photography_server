import mongoose from "mongoose";
import { EVENT_TYPES } from "./Event.js";

export const BOOKING_STATUSES = ["enquiry", "confirmed", "completed", "cancelled"];
export const BOOKING_SOURCES = ["phone", "walk-in", "website", "instagram", "referral", "other"];
export const PAYMENT_METHODS = ["cash", "upi", "card", "bank", "other"];

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0.01 },
  method: { type: String, enum: PAYMENT_METHODS, default: "cash" },
  note: { type: String, trim: true, default: "" },
  paidAt: { type: Date, default: Date.now },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
});

const bookingSchema = new mongoose.Schema({
  studioId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // Per-studio running number shown as BK-0001
  number: { type: Number, required: true },

  status: { type: String, enum: BOOKING_STATUSES, default: "enquiry" },
  source: { type: String, enum: BOOKING_SOURCES, default: "phone" },

  clientName: { type: String, required: [true, "Client name is required"], trim: true },
  clientPhone: { type: String, required: [true, "Client phone is required"], trim: true },
  clientEmail: { type: String, trim: true, lowercase: true, default: "" },

  eventType: { type: String, enum: EVENT_TYPES, default: "wedding" },
  eventDate: { type: Date, required: [true, "Event date is required"] },
  startTime: { type: String, default: "" },
  eventPlace: { type: String, trim: true, default: "" },

  packageName: { type: String, trim: true, default: "" },
  packagePrice: { type: Number, min: 0, default: 0 },
  payments: [paymentSchema],

  // Team members working on this booking
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  notes: { type: String, trim: true, default: "" },
  cancelReason: { type: String, trim: true, default: "" },

  // Set once the booking is turned into an event
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

bookingSchema.index({ studioId: 1, number: 1 }, { unique: true });
bookingSchema.index({ studioId: 1, eventDate: 1 });

bookingSchema.virtual("amountPaid").get(function () {
  return (this.payments ?? []).reduce((sum, p) => sum + (p.amount || 0), 0);
});

bookingSchema.virtual("balance").get(function () {
  return Math.max((this.packagePrice || 0) - this.amountPaid, 0);
});

bookingSchema.set("toJSON", { virtuals: true });

bookingSchema.pre("save", function () {
  this.updatedAt = new Date();
});

// Next running number for a studio (retried by the controller if two saves race)
bookingSchema.statics.nextNumber = async function (studioId) {
  const last = await this.findOne({ studioId }).sort({ number: -1 }).select("number");
  return (last?.number ?? 0) + 1;
};

const Booking = mongoose.model("Booking", bookingSchema);
export default Booking;
