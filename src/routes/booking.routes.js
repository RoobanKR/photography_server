import express from "express";
import { requirePermission, verifyToken } from "../controllers/auth.controller.js";
import {
  addPayment,
  changeBookingStatus,
  convertBookingToEvent,
  createBooking,
  deleteBooking,
  deletePayment,
  getBooking,
  listAssignees,
  listBookings,
  updateBooking
} from "../controllers/booking.controller.js";

const router = express.Router();

router.use(verifyToken);

const canView = requirePermission("bookings.view");
const canManage = requirePermission("bookings.manage");

router.get("/", canView, listBookings);
router.get("/team", canView, listAssignees);
router.post("/", canManage, createBooking);

router.get("/:id", canView, getBooking);
router.put("/:id", canManage, updateBooking);
router.put("/:id/status", canManage, changeBookingStatus);
router.delete("/:id", canManage, deleteBooking);

router.post("/:id/payments", canManage, addPayment);
router.delete("/:id/payments/:paymentId", canManage, deletePayment);

router.post("/:id/convert", canManage, requirePermission("events.create"), convertBookingToEvent);

export default router;
