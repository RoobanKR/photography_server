import mongoose from "mongoose";
import Event from "../models/Event.js";
import User from "../models/User.js";

export const GB = 1024 ** 3;

const emptyBucket = () => ({ bytes: 0, photos: 0, photoBytes: 0, videos: 0, videoBytes: 0, others: 0, otherBytes: 0 });

const addTo = (bucket, file) => {
  const size = file.size || 0;
  bucket.bytes += size;
  if (file.type === "image") {
    bucket.photos++;
    bucket.photoBytes += size;
  } else if (file.type === "video") {
    bucket.videos++;
    bucket.videoBytes += size;
  } else {
    bucket.others++;
    bucket.otherBytes += size;
  }
};

// Adds up every media file in a studio: in total, per event and per uploader.
// Files uploaded before uploaders were tracked count towards the studio owner.
export async function computeStudioUsage(studioId) {
  const events = await Event.find({ userId: studioId })
    .select("eventName eventType eventDate mediaFiles.size mediaFiles.type mediaFiles.uploadedBy")
    .lean();

  const total = emptyBucket();
  const byUser = new Map();
  const perEvent = events.map((event) => {
    const bucket = emptyBucket();
    for (const file of event.mediaFiles ?? []) {
      addTo(bucket, file);
      addTo(total, file);
      const uploader = String(file.uploadedBy ?? studioId);
      if (!byUser.has(uploader)) byUser.set(uploader, emptyBucket());
      addTo(byUser.get(uploader), file);
    }
    return { id: event._id, eventName: event.eventName, eventType: event.eventType, eventDate: event.eventDate, ...bucket };
  });

  return { total, perEvent, byUser };
}

// Checks whether `incomingBytes` more can be uploaded by this user.
// Returns null when allowed, or a message explaining which limit would be exceeded.
export async function checkUploadAllowed({ studioId, user, incomingBytes }) {
  const owner = user.isOwner() ? user : await User.findById(studioId).select("storageLimitBytes");
  const studioLimit = owner?.storageLimitBytes ?? null;
  const userLimit = user.isOwner() ? null : user.storageLimitBytes ?? null;
  if (studioLimit === null && userLimit === null) return null;

  const { total, byUser } = await computeStudioUsage(new mongoose.Types.ObjectId(studioId));
  const fmt = (bytes) => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  if (studioLimit !== null && total.bytes + incomingBytes > studioLimit) {
    return `Studio storage is full: ${fmt(total.bytes)} of ${fmt(studioLimit)} used. Delete old media or ask the owner to raise the limit.`;
  }
  const mine = byUser.get(String(user._id))?.bytes ?? 0;
  if (userLimit !== null && mine + incomingBytes > userLimit) {
    return `Your storage limit is reached: ${fmt(mine)} of ${fmt(userLimit)} used. Ask your studio admin to raise it.`;
  }
  return null;
}
