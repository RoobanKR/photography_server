import Booking from "../models/Booking.js";
import Event from "../models/Event.js";
import User from "../models/User.js";

// Bookings that count as real work (money is expected)
const BOOKED = new Set(["confirmed", "completed"]);

const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// Every month from `from` to `to`, oldest first
const monthsBetween = (from, to) => {
  const out = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (d <= end && out.length < 60) {
    out.push(monthKey(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
};

// The same client across bookings and events: by phone (last 10 digits), else by name
const clientKey = (name, phone) => {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  if (digits.length >= 6) return `p:${digits}`;
  const n = String(name || "").trim().toLowerCase();
  return n ? `n:${n}` : "";
};

const paidOf = (booking) => (booking.payments ?? []).reduce((sum, p) => sum + (p.amount || 0), 0);

const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Money, bookings, events, storage and per-client figures for one studio.
export const getAnalytics = async (req, res) => {
  try {
    const studioId = req.studioId;
    const [bookings, events, owner] = await Promise.all([
      Booking.find({ studioId }).lean(),
      Event.find({ userId: studioId })
        .select("eventName eventType eventDate clientName clientPhone clientEmail mediaFiles.size mediaFiles.type mediaFiles.uploadedAt")
        .lean(),
      User.findById(studioId).select("storageLimitBytes").lean(),
    ]);

    // Period: defaults to the last 12 months; "all" uses the earliest data
    const now = new Date();
    let to = parseDate(req.query.to) ?? now;
    to = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999));
    let from = parseDate(req.query.from);
    if (req.query.all === "1" || !from) {
      if (req.query.all === "1") {
        const dates = [...bookings.map((b) => b.eventDate), ...events.map((e) => e.eventDate)].filter(Boolean).map((d) => new Date(d));
        from = dates.length ? new Date(Math.min(...dates)) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const latest = dates.length ? new Date(Math.max(...dates)) : now;
        if (latest > to) to = latest;
      } else {
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      }
    }
    if (from > to) [from, to] = [to, from];
    const inRange = (date) => {
      if (!date) return false;
      const d = new Date(date);
      return d >= from && d <= to;
    };

    const months = monthsBetween(from, to);
    const monthly = new Map(months.map((m) => [m, { month: m, booked: 0, collected: 0, bookings: 0, events: 0, uploadedBytes: 0 }]));

    // ---------- Bookings and money ----------
    const periodBookings = bookings.filter((b) => inRange(b.eventDate));
    const byStatus = { enquiry: 0, confirmed: 0, completed: 0, cancelled: 0 };
    const byType = new Map();
    const bySource = new Map();
    const byMethod = new Map();
    let bookedValue = 0;
    let bookedCount = 0;

    for (const b of periodBookings) {
      byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
      const m = monthly.get(monthKey(b.eventDate));
      if (m) m.bookings++;
      if (!BOOKED.has(b.status)) continue;
      bookedValue += b.packagePrice || 0;
      bookedCount++;
      if (m) m.booked += b.packagePrice || 0;
      const t = byType.get(b.eventType) ?? { type: b.eventType, bookings: 0, value: 0 };
      t.bookings++;
      t.value += b.packagePrice || 0;
      byType.set(b.eventType, t);
      const s = bySource.get(b.source) ?? { source: b.source, bookings: 0, value: 0 };
      s.bookings++;
      s.value += b.packagePrice || 0;
      bySource.set(b.source, s);
    }

    // Money received in the period, whenever the shoot is
    let collected = 0;
    for (const b of bookings) {
      for (const p of b.payments ?? []) {
        if (!inRange(p.paidAt)) continue;
        collected += p.amount || 0;
        const m = monthly.get(monthKey(p.paidAt));
        if (m) m.collected += p.amount || 0;
        byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + (p.amount || 0));
      }
    }

    // Still owed today on all confirmed/completed bookings
    const outstanding = bookings
      .filter((b) => BOOKED.has(b.status))
      .reduce((sum, b) => sum + Math.max((b.packagePrice || 0) - paidOf(b), 0), 0);
    const decided = byStatus.confirmed + byStatus.completed + byStatus.cancelled + byStatus.enquiry;

    // ---------- Events and storage ----------
    const storage = { bytes: 0, photos: 0, videos: 0, photoBytes: 0, videoBytes: 0, uploadedInPeriod: 0 };
    const eventRows = events.map((e) => {
      let bytes = 0;
      let photos = 0;
      let videos = 0;
      for (const f of e.mediaFiles ?? []) {
        const size = f.size || 0;
        bytes += size;
        if (f.type === "image") {
          photos++;
          storage.photoBytes += size;
        } else if (f.type === "video") {
          videos++;
          storage.videoBytes += size;
        }
        if (inRange(f.uploadedAt)) {
          storage.uploadedInPeriod += size;
          const m = monthly.get(monthKey(f.uploadedAt));
          if (m) m.uploadedBytes += size;
        }
      }
      storage.bytes += bytes;
      storage.photos += photos;
      storage.videos += videos;
      const m = inRange(e.eventDate) ? monthly.get(monthKey(e.eventDate)) : null;
      if (m) m.events++;
      return { id: e._id, eventName: e.eventName, eventType: e.eventType, eventDate: e.eventDate, clientName: e.clientName, clientPhone: e.clientPhone, clientEmail: e.clientEmail, bytes, photos, videos };
    });
    const periodEvents = eventRows.filter((e) => inRange(e.eventDate));

    // ---------- Clients ----------
    const clients = new Map();
    const clientFor = (name, phone, email) => {
      const key = clientKey(name, phone);
      if (!key) return null;
      if (!clients.has(key)) {
        clients.set(key, { key, name: name || "", phone: phone || "", email: email || "", bookings: [], events: [], value: 0, paid: 0, balance: 0, photos: 0, videos: 0, bytes: 0, lastDate: null });
      }
      const c = clients.get(key);
      if (!c.name && name) c.name = name;
      if (!c.phone && phone) c.phone = phone;
      if (!c.email && email) c.email = email;
      return c;
    };
    const touch = (c, date) => {
      if (date && (!c.lastDate || new Date(date) > new Date(c.lastDate))) c.lastDate = date;
    };

    for (const b of periodBookings) {
      const c = clientFor(b.clientName, b.clientPhone, b.clientEmail);
      if (!c) continue;
      const paid = paidOf(b);
      const counts = BOOKED.has(b.status);
      c.bookings.push({
        id: b._id,
        number: b.number,
        status: b.status,
        eventType: b.eventType,
        eventDate: b.eventDate,
        packageName: b.packageName,
        packagePrice: b.packagePrice || 0,
        paid,
        balance: counts ? Math.max((b.packagePrice || 0) - paid, 0) : 0,
      });
      if (counts) {
        c.value += b.packagePrice || 0;
        c.paid += paid;
        c.balance += Math.max((b.packagePrice || 0) - paid, 0);
      }
      touch(c, b.eventDate);
    }
    for (const e of periodEvents) {
      const c = clientFor(e.clientName, e.clientPhone, e.clientEmail);
      if (!c) continue;
      c.events.push({ id: e.id, eventName: e.eventName, eventType: e.eventType, eventDate: e.eventDate, photos: e.photos, videos: e.videos, bytes: e.bytes });
      c.photos += e.photos;
      c.videos += e.videos;
      c.bytes += e.bytes;
      touch(c, e.eventDate);
    }
    const clientList = [...clients.values()].sort((a, b) => b.value - a.value || b.bytes - a.bytes);

    res.json({
      success: true,
      range: { from, to },
      totals: {
        bookedValue,
        collected,
        outstanding,
        averageBooking: bookedCount ? Math.round(bookedValue / bookedCount) : 0,
        bookings: periodBookings.length,
        bookedCount,
        byStatus,
        conversionRate: decided ? (byStatus.confirmed + byStatus.completed) / decided : 0,
        events: periodEvents.length,
        clients: clientList.length,
      },
      storage: { ...storage, limitBytes: owner?.storageLimitBytes ?? null },
      monthly: [...monthly.values()],
      byEventType: [...byType.values()].sort((a, b) => b.value - a.value),
      bySource: [...bySource.values()].sort((a, b) => b.value - a.value),
      byPaymentMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
      storageByEvent: [...eventRows].sort((a, b) => b.bytes - a.bytes).slice(0, 8),
      clients: clientList,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({ success: false, message: "Server error while building analytics" });
  }
};
