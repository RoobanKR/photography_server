// Loads src/.env before any other module reads process.env.
// Import this first in server.js so values like JWT_SECRET are always the same,
// however the server is started (npm start, nodemon, or node src/server.js).
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
