// Face grouping ("People", like Google Photos) and selfie matching for event galleries

import Event from "../models/Event.js";
import Face from "../models/Face.js";

// Grouping works in two passes (face-api.js descriptor distances, lower = more alike):
// 1. faces are merged into groups while the average distance between two groups stays under STRICT
// 2. faces left out join the closest real group when their average distance to it is under JOIN
// Tested on real event photos: looser values start mixing people who wear sunglasses.
const STRICT = 0.55;
const JOIN = 0.6;
// Someone becomes a "person" once they appear in this many photos
export const MIN_PHOTOS_PER_PERSON = 3;
// Default selfie match distance for guests
export const MATCH_THRESHOLD = 0.55;

const distance = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
};

export const isDescriptor = (value) =>
  Array.isArray(value) && value.length === 128 && value.every((n) => typeof n === "number" && Number.isFinite(n));

// Small binary min-heap of [priority, ...data] entries
class MinHeap {
  items = [];
  get size() {
    return this.items.length;
  }
  push(entry) {
    const a = this.items;
    a.push(entry);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Groups faces into people. faces: [{ publicId, descriptor }], oldest first.
// Returns arrays of face indexes; two faces from the same photo never share a group.
export const groupFaces = (faces) => {
  const n = faces.length;
  const clusters = faces.map((f, i) => ({ members: [i], photos: new Set([f.publicId]), alive: true, version: 0, sums: new Map() }));
  const heap = new MinHeap();

  // Candidate pairs: only groups with at least one close pair can have a low average
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (faces[i].publicId === faces[j].publicId) continue;
      const d = distance(faces[i].descriptor, faces[j].descriptor);
      if (d < STRICT) {
        clusters[i].sums.set(j, d);
        clusters[j].sums.set(i, d);
        heap.push([d, i, j, 0, 0]);
      }
    }
  }

  const sumBetween = (a, b) => {
    let s = 0;
    for (const i of clusters[a].members) for (const j of clusters[b].members) s += distance(faces[i].descriptor, faces[j].descriptor);
    return s;
  };
  const overlaps = (a, b) => {
    for (const p of clusters[b].photos) if (clusters[a].photos.has(p)) return true;
    return false;
  };

  // Pass 1: average-linkage merging, closest groups first. The lower index survives,
  // so a group keeps the id of its oldest face as photos are added later.
  while (heap.size) {
    const [, a, b, va, vb] = heap.pop();
    const A = clusters[a];
    const B = clusters[b];
    if (!A.alive || !B.alive || A.version !== va || B.version !== vb || overlaps(a, b)) continue;

    const others = new Set([...A.sums.keys(), ...B.sums.keys()]);
    others.delete(a);
    others.delete(b);
    const merged = new Map();
    for (const c of others) {
      if (!clusters[c].alive) continue;
      const s = (A.sums.has(c) ? A.sums.get(c) : sumBetween(a, c)) + (B.sums.has(c) ? B.sums.get(c) : sumBetween(b, c));
      merged.set(c, s);
    }

    A.members.push(...B.members);
    for (const p of B.photos) A.photos.add(p);
    A.version += 1;
    A.sums = merged;
    B.alive = false;
    B.members = [];
    B.sums = new Map();

    for (const [c, s] of merged) {
      const C = clusters[c];
      C.sums.delete(b);
      C.sums.set(a, s);
      const avg = s / (A.members.length * C.members.length);
      if (avg < STRICT && !overlaps(a, c)) heap.push([avg, Math.min(a, c), Math.max(a, c), clusters[Math.min(a, c)].version, clusters[Math.max(a, c)].version]);
    }
  }

  const alive = clusters.filter((c) => c.alive);
  const groups = alive.filter((c) => c.photos.size >= MIN_PHOTOS_PER_PERSON);
  const leftovers = alive.filter((c) => c.photos.size < MIN_PHOTOS_PER_PERSON).flatMap((c) => c.members).sort((x, y) => x - y);

  // Pass 2: faces outside any group join the closest one (compared with up to 40 of its faces)
  for (const i of leftovers) {
    let best = null;
    let bestDistance = Infinity;
    for (const g of groups) {
      if (g.photos.has(faces[i].publicId)) continue;
      const sample = g.members.length > 40 ? g.members.filter((_, k) => k % Math.ceil(g.members.length / 40) === 0) : g.members;
      const avg = sample.reduce((s, j) => s + distance(faces[i].descriptor, faces[j].descriptor), 0) / sample.length;
      if (avg < bestDistance) {
        bestDistance = avg;
        best = g;
      }
    }
    if (best && bestDistance < JOIN) {
      best.members.push(i);
      best.photos.add(faces[i].publicId);
    }
  }

  return groups.map((g) => g.members);
};

// Rebuilds the person groups for an event and stores a summary on the event
export const regroupEventFaces = async (eventId) => {
  const faces = await Face.find({ eventId }, "publicId box descriptor personId").sort({ createdAt: 1, _id: 1 }).lean();

  const people = [];
  const personOf = new Map();
  for (const members of groupFaces(faces)) {
    const groupFacesList = members.map((i) => faces[i]);
    const id = String(faces[Math.min(...members)]._id);
    // The largest face makes the clearest thumbnail
    const cover = groupFacesList.reduce((a, b) => (b.box.w * b.box.h > a.box.w * a.box.h ? b : a));
    people.push({
      personId: id,
      photoCount: new Set(groupFacesList.map((f) => f.publicId)).size,
      coverPublicId: cover.publicId,
      coverBox: cover.box,
    });
    for (const f of groupFacesList) personOf.set(String(f._id), id);
  }
  people.sort((a, b) => b.photoCount - a.photoCount);

  const updates = faces
    .filter((f) => (personOf.get(String(f._id)) ?? "") !== f.personId)
    .map((f) => ({ updateOne: { filter: { _id: f._id }, update: { $set: { personId: personOf.get(String(f._id)) ?? "" } } } }));
  if (updates.length) await Face.bulkWrite(updates);

  await Event.updateOne({ _id: eventId }, { $set: { people } });
  return people;
};

// Photos containing a face like the given selfie descriptor, best match first
export const matchSelfie = async (eventId, descriptor, threshold = MATCH_THRESHOLD) => {
  const faces = await Face.find({ eventId }, "publicId descriptor personId").lean();

  const best = new Map();
  const matchedPeople = new Set();
  for (const face of faces) {
    const d = distance(descriptor, face.descriptor);
    if (d >= threshold) continue;
    if (!best.has(face.publicId) || d < best.get(face.publicId)) best.set(face.publicId, d);
    // A confident match pulls in the rest of that person's photos too
    if (face.personId && d < threshold - 0.05) matchedPeople.add(face.personId);
  }

  for (const face of faces) {
    if (face.personId && matchedPeople.has(face.personId) && !best.has(face.publicId)) {
      best.set(face.publicId, threshold);
    }
  }

  return [...best.entries()]
    .map(([publicId, d]) => ({ publicId, distance: Math.round(d * 1000) / 1000 }))
    .sort((a, b) => a.distance - b.distance);
};

// publicId -> person ids, for the guest gallery's "photos of this person" filter
export const peopleByPhoto = async (eventId) => {
  const faces = await Face.find({ eventId, personId: { $ne: "" } }, "publicId personId").lean();
  const map = {};
  for (const f of faces) {
    map[f.publicId] ??= [];
    if (!map[f.publicId].includes(f.personId)) map[f.publicId].push(f.personId);
  }
  return map;
};

export const removePhotoFaces = async (eventId, publicIds) => {
  const { deletedCount } = await Face.deleteMany({ eventId, publicId: { $in: publicIds } });
  if (deletedCount) await regroupEventFaces(eventId);
};
