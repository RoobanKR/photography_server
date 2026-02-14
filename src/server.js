import mongoose from "mongoose"
import dotenv from "dotenv"
import cors from "cors"
import cookieParser from "cookie-parser"
import express from "express"
dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

// Middleware
app.use(express.json())
app.use(cookieParser())
app.use(cors({
  origin: process.env.CLIENT_URL || "https://photography-theta-self.vercel.app",
  credentials: true
}))

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

app.use("/api/auth", authRoutes)
app.use("/api/events", eventRoutes) // Add event routes

// Test route
app.get("/", (req, res) => {
  res.send("Server is running and MongoDB is connected")
})

// Start server
console.log("MONGO URI:", process.env.MONGODB_URI);

app.listen(PORT, () => {
  console.log(process.env.MONGODB_URI);
  
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})