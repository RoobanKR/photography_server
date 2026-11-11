// Every permission a role can grant, grouped for the role editor.
// Keys are stored on roles, so rename them only with a data migration.
export const PERMISSION_GROUPS = [
  {
    key: "events",
    label: "Events",
    permissions: [
      { key: "events.view", label: "View events", description: "See the event list and event details" },
      { key: "events.create", label: "Create events", description: "Add new events" },
      { key: "events.edit", label: "Edit events", description: "Change event details, cover photo and QR code" },
      { key: "events.delete", label: "Delete events", description: "Delete an event and all its media" },
    ],
  },
  {
    key: "media",
    label: "Photos & videos",
    permissions: [
      { key: "media.upload", label: "Upload media", description: "Upload photos and videos to events" },
      { key: "media.delete", label: "Delete media", description: "Delete photos and videos from events" },
    ],
  },
  {
    key: "bookings",
    label: "Bookings",
    permissions: [
      { key: "bookings.view", label: "View bookings", description: "See bookings and enquiries" },
      { key: "bookings.manage", label: "Manage bookings", description: "Create, edit and cancel bookings" },
    ],
  },
  {
    key: "team",
    label: "Users & roles",
    permissions: [
      { key: "users.view", label: "View team", description: "See users and roles" },
      { key: "users.manage", label: "Manage team", description: "Add, edit and remove users and roles" },
    ],
  },
  {
    key: "storage",
    label: "Storage",
    permissions: [{ key: "storage.view", label: "View storage", description: "See storage usage" }],
  },
  {
    key: "analytics",
    label: "Analytics",
    permissions: [
      { key: "analytics.view", label: "View analytics", description: "See revenue, payments, client and storage reports" },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

// Created for every studio the first time its roles are loaded
export const DEFAULT_ROLES = [
  {
    key: "admin",
    name: "Admin",
    description: "Full access to everything in the studio",
    permissions: ALL_PERMISSIONS,
    isSystem: true,
  },
  {
    key: "manager",
    name: "Manager",
    description: "Runs events and bookings, can't manage the team",
    permissions: [
      "events.view", "events.create", "events.edit", "events.delete",
      "media.upload", "media.delete", "bookings.view", "bookings.manage",
      "users.view", "storage.view", "analytics.view",
    ],
  },
  {
    key: "photographer",
    name: "Photographer",
    description: "Sees events and uploads photos and videos",
    permissions: ["events.view", "media.upload", "bookings.view"],
  },
  {
    key: "editor",
    name: "Editor",
    description: "Uploads and cleans up edited photos",
    permissions: ["events.view", "media.upload", "media.delete"],
  },
];
