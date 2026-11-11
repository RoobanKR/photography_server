import { v2 as cloudinary } from 'cloudinary';
import './env.js';

const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
  .filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ Missing Cloudinary settings in src/.env: ${missing.join(', ')}`);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

export default cloudinary;
