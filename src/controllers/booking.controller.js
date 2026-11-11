import mongoose from "mongoose";
import Booking, { BOOKING_SOURCES, BOOKING_STATUSES, PAYMENT_METHODS } from "../models/Booking.js";
import Event, { EVENT_TYPES } from "../models/Event.js";
import User from "../models/User.js";
import Role from "../models/Role.js";
import { generateQRCode } from "./event.controller.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Allowed status moves. Cancelled bookings must be reopened (back to enquiry) first.
const TRANSITIONS = {
  enquiry: ["confirmed", "cancelled"],
  confirmed: ["enquiry", "completed", "cancelled"],
  completed: ["confirmed"],
  cancelled: ["enquiry"]
};

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const canManage = (req) => req.permissions.includes("bookings.manage");

// Team members who can't manage bookings only see the ones assigned to them
const visibleFilter = (req) =>
  canManage(req) ? { studioId: req.studioId } : { studioId: req.studioId, assignedTo: req.user._id };

const populateBooking = (query) => query.populate("assignedTo", "name email");

const typeLabel = (type) =>
  String(type || "event").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const findBooking = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    fail(res, 400, "Invalid booking ID");
    return null;
  }
  const booking = await Booking.findOne({ _id: id, ...visibleFilter(req) });
  if (!booking) {
    fail(res, 404, "Booking not found");
    return null;
  }
  return booking;
};

// Keeps only ids of active people in this studio
const cleanAssignees = async (studioId, ids) => {
  if (!Array.isArray(ids)) return [];
  const valid = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const users = await User.find({
    _id: { $in: valid },
    $or: [{ _id: studioId }, { studioId }],
    isActive: { $ne: false }
  }).select("_id");
  return users.map((u) => u._id);
};

// Copies and validates the editable fields. Returns { values } or { error }.
const readBookingFields = (body, { partial }) => {
  const text = (v) => (v === undefined ? undefined : String(v).trim());
  const values = {
    clientName: text(body.clientName),
    clientPhone: text(body.clientPhone),
    clientEmail: text(body.clientEmail)?.toLowerCase(),
    source: text(body.source),
    eventType: text(body.eventType),
    eventDate: body.eventDate ? new Date(body.eventDate) : undefined,
    startTime: text(body.startTime),
    eventPlace: text(body.eventPlace),
    packageName: text(body.packageName),
    packagePrice: body.packagePrice === undefined || body.packagePrice === "" ? undefined : Number(body.packagePrice),
    notes: text(body.notes)
  };

  const required = (key, message) => (!partial || values[key] !== undefined) && !values[key] ? message : null;
  const error =
    required("clientName", "Client name is required") ||
    required("clientPhone", "Client phone is required") ||
    (!partial && !values.eventDate ? "Event date is required" : null) ||
    (values.eventDate && isNaN(values.eventDate) ? "Event date is not valid" : null) ||
    (values.clientEmail && !EMAIL_PATTERN.test(values.clientEmail) ? "Client email is not valid" : null) ||
    (values.startTime && !TIME_PATTERN.test(values.startTime) ? "Start time must be HH:mm" : null) ||
    (values.eventType && !EVENT_TYPES.includes(values.eventType) ? "Choose a valid event type" : null) ||
    (values.source && !BOOKING_SOURCES.includes(values.source) ? "Choose a valid source" : null) ||
    (values.packagePrice !== undefined && (isNaN(values.packagePrice) || values.packagePrice < 0) ? "Package price must be 0 or more" : null);

  if (error) return { error };
  return { values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) };
};

const sendBooking = async (res, booking, status = 200) => {
  await booking.populate("assignedTo", "name email");
  res.status(status).json({ success: true, booking });
};

// ---------- Endpoints ----------

export const listBookings = async (req, res) => {
  try {
    const bookings = await populateBooking(Booking.find(visibleFilter(req)).sort({ eventDate: 1 }));
    res.json({ success: true, bookings, canManage: canManage(req) });
  } catch (error) {
    console.error("List bookings error:", error);
    fail(res, 500, "Server error while loading bookings");
  }
};

// People a booking can be assigned to
export const listAssignees = async (req, res) => {
  try {
    const users = await User.find({ $or: [{ _id: req.studioId }, { studioId: req.studioId }], isActive: { $ne: false } })
      .select("name email roleId studioId")
      .sort({ name: 1 });
    const roles = await Role.find({ studioId: req.studioId }).select("name");
    const roleNames = new Map(roles.map((r) => [r._id.toString(), r.name]));
    res.json({
      success: true,
      users: users.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        roleName: u.studioId ? roleNames.get(String(u.roleId)) ?? "No role" : "Owner"
      }))
    });
  } catch (error) {
    console.error("List assignees error:", error);
    fail(res, 500, "Server error while loading the team");
  }
};

export const getBooking = async (req, res) => {
  try {
    const booking = await findBooking(req, res);
    if (!booking) return;
    await sendBooking(res, booking);
  } catch (error) {
    console.error("Get booking error:", error);
    fail(res, 500, "Server error while loading the booking");
  }
};

export const createBooking = async (req, res) => {
  try {
    const { values, error } = readBookingFields(req.body, { partial: false });
    if (error) return fail(res, 400, error);

    const assignedTo = await cleanAssignees(req.studioId, req.body.assignedTo);
    const advance = Number(req.body.advanceAmount || 0);
    if (isNaN(advance) || advance < 0) return fail(res, 400, "Advance must be 0 or more");
    if (advance > 0 && values.packagePrice !== undefined && advance > values.packagePrice) {
      return fail(res, 400, "Advance can't be more than the package price");
    }
    const advanceMethod = PAYMENT_METHODS.includes(req.body.advanceMethod) ? req.body.advanceMethod : "cash";

    // A paid advance means the client has committed
    const status = advance > 0 ? "confirmed" : "enquiry";

    // Two bookings saved at the same moment can pick the same number; retry with the next one
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const booking = new Booking({
          ...values,
          studioId: req.studioId,
          number: await Booking.nextNumber(req.studioId),
          status,
          assignedTo,
          createdBy: req.user._id,
          payments: advance > 0
            ? [{ amount: advance, method: advanceMethod, note: "Advance", recordedBy: req.user._id }]
            : []
        });
        await booking.save();
        return sendBooking(res, booking, 201);
      } catch (err) {
        if (err.code !== 11000 || attempt === 2) throw err;
      }
    }
  } catch (error) {
    console.error("Create booking error:", error);
    fail(res, 500, "Server error while creating the booking");
  }
};

export const updateBooking = async (req, res) => {
  try {
    const booking = await findBooking(req, res);
    if (!booking) return;

    const { values, error } = readBookingFields(req.body, { partial: true });
    if (error) return fail(res, 400, error);
    if (values.packagePrice !== undefined && values.packagePrice < booking.amountPaid) {
      return fail(res, 400, "Package price can't be less than what's already been paid");
    }

    Object.assign(booking, values);
    if (req.body.assignedTo !== undefined) booking.assignedTo = await cleanAssignees(req.studioId, req.body.assignedTo);

    await booking.save();
    await sendBooking(res, booking);
  } catch (error) {
    console.error("Update booking error:", error);
    fail(res, 500, "Server error while updating the booking");
  }
};

export const changeBookingStatus = async (req, res) => {
  try {
    const booking = await findBooking(req, res);
    if (!booking) return;

    const next = String(req.body.status || "");
    if (!BOOKING_STATUSES.includes(next)) return fail(res, 400, "Choose a valid status");
    if (!TRANSITIONS[booking.status].includes(next)) {
      return fail(res, 400, `This booking is ${booking.status} and can't be moved to ${next}`);
    }

    booking.status = next;
    booking.cancelReason = next === "cancelled" ? String(req.body.cancelReason || "").trim() : "";
    await booking.save();
    await sendBooking(res, booking);
  } catch (error) {
    console.error("Change booking status error:", error);
    fail(res, 500, "Server error while changing the status");
  }
};

export const addPayment = async (req, res) => {
  try {
    const booking = await findBooking(req, res);
    if (!booking) return;

    const amount = Number(req.body.amount);
    if (!amount || isNaN(amount) || amount <= 0) return fail(res, 400, "Enter an amount more than 0");
    if (booking.packagePrice > 0 && amount > booking.balance + 0.001) {
      return fail(res, 400, `Payment is more than the balance due`);
    }
    const method = PAYMENT_METHODS.includes(req.body.method) ? req.body.method : "cash";
    const paidAt = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    if (isNaN(paidAt)) return fail(res, 400, "Payment date is not valid");

    booking.payments.push({
      amount,
      method,
      paidAt,
      note: String(req.body.note || "").trim() || (booking.payments.length === 0 ? "Advance" : ""),
      recordedBy: req.user._id
    });
    await booking.save();
    await sendBooking(res, booking);
  } catch (error) {
    console.error("Add payment error:", error);
    fail(res, 500, "Server error while recording the payment");
  }
};

export const deletePayment = async (req, res) => {
  try {
    const booking = await findBooking(req, res);
    if (!booking) return;

    const payment = booking.payments.id(req.params.paymentId);
    if (!payment) return fail(res, 404, "Payment not found");
    payment.deleteOne();
    await booking.save();
    await sendBooking(res, booking);
  } catch (error) {
    console.error("Delete payment error:", error);
    fail(res, 500, "Server error while removing the payment");
  }
};

// Turns the booking into an event with the same client and event details
export const convertBookingToEvent = async (req, res) => {
  try {
    const booking = await findBooking(req, res);
    if (!booking) return;

    if (booking.eventId && (await Event.exists({ _id: booking.eventId }))) {
      return res.status(409).json({ success: false, message: "This booking already has an event", eventId: booking.eventId });
    }
    if (booking.status === "cancelled") return fail(res, 400, "Reopen the booking before creating an event");
    if (!booking.eventPlace) return fail(res, 400, "Add the venue to the booking first");

    const expiryDate = req.body.expiryDate ? new Date(req.body.expiryDate) : new Date(booking.eventDate.getTime() + 30 * 864e5);
    if (isNaN(expiryDate) || expiryDate < booking.eventDate) return fail(res, 400, "Gallery expiry must be on or after the event date");

    const event = new Event({
      eventName: String(req.body.eventName || "").trim() || `${booking.clientName} ${typeLabel(booking.eventType)}`,
      eventType: booking.eventType,
      clientName: booking.clientName,
      clientPhone: booking.clientPhone,
      clientEmail: booking.clientEmail,
      description: [booking.packageName && `Package: ${booking.packageName}`, booking.notes].filter(Boolean).join("\n"),
      eventDate: booking.eventDate,
      startTime: booking.startTime,
      eventPlace: booking.eventPlace,
      expiryDate,
      userId: req.studioId,
      createdBy: req.user._id,
      status: "active",
      mediaFiles: []
    });
    event.qrCode = await generateQRCode(event._id);
    await event.save();

    booking.eventId = event._id;
    if (booking.status === "enquiry") booking.status = "confirmed";
    await booking.save();
    await booking.populate("assignedTo", "name email");

    res.status(201).json({ success: true, event: { _id: event._id, eventName: event.eventName }, booking });
  } catch (error) {
    console.error("Convert booking error:", error);
    fail(res, 500, "Server error while creating the event");
  }
};

export const deleteBooking = async (req, res) => {
  try {
    const booking = await findBooking(req, res);
    if (!booking) return;
    await booking.deleteOne();
    res.json({ success: true, message: "Booking deleted" });
  } catch (error) {
    console.error("Delete booking error:", error);
    fail(res, 500, "Server error while deleting the booking");
  }
};
