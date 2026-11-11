import "./config/env.js" // must stay first: loads src/.env before other modules read it
import mongoose from "mongoose"
import cors from "cors"
import cookieParser from "cookie-parser"
import express from "express"

const app = express()
const PORT = process.env.PORT || 5000

// Middleware
app.use(express.json({ limit: "5mb" })) // face scan results are larger than the 100 KB default
app.use(cookieParser())
// CLIENT_URL may list several origins, comma-separated (deployed site + local dev)
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    // no Origin header: same-origin, curl, or a mobile webview
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin.replace(/\/+$/, ""))) return cb(null, true)
    return cb(new Error(`Origin ${origin} is not allowed by CORS`))
  },
  credentials: true
}))

if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set. Add it to src/.env")
  process.exit(1)
}

mongoose
  .connect(process.env.MONGODB_URI, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message)
    process.exit(1)
  })


// Import routes
import authRoutes from "./routes/auth.routes.js"
import eventRoutes from "./routes/event.routes.js" // New event routes
import teamRoutes from "./routes/team.routes.js"
import bookingRoutes from "./routes/booking.routes.js"
import storageRoutes from "./routes/storage.routes.js"
import analyticsRoutes from "./routes/analytics.routes.js"

app.use("/api/auth", authRoutes)
app.use("/api/events", eventRoutes) // Add event routes
app.use("/api/team", teamRoutes)
app.use("/api/bookings", bookingRoutes)
app.use("/api/storage", storageRoutes)
app.use("/api/analytics", analyticsRoutes)

// Test route
app.get("/", (req, res) => {
  res.send("Server is running and MongoDB is connected")
})

// Upload and other unhandled errors as JSON, so the client can show the message
app.use((err, req, res, next) => {
  if (err.name === "MulterError") {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is larger than 100 MB" : err.message
    return res.status(400).json({ success: false, message })
  }
  if (err.message?.startsWith("Invalid file type")) {
    return res.status(400).json({ success: false, message: err.message })
  }
  console.error("Unhandled error:", err)
  res.status(500).json({ success: false, message: "Server error" })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})