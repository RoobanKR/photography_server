import * as faceapi from '@vladmandic/face-api';
import { Canvas, Image } from 'canvas';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FaceRecognitionService {
  constructor() {
    this.initialized = false;
    this.modelPath = path.join(__dirname, '../models');
    this.minConfidence = 0.6;
    this.maxResults = 5;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Load face-api models
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(this.modelPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(this.modelPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(this.modelPath);
      
      console.log('✅ Face recognition models loaded');
      this.initialized = true;
    } catch (error) {
      console.error('❌ Error loading face recognition models:', error);
      throw error;
    }
  }

  async loadImageFromUrl(url) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const img = new Image();
      img.src = Buffer.from(response.data);
      return img;
    } catch (error) {
      console.error('Error loading image from URL:', error);
      throw error;
    }
  }

  async loadImageFromFile(filePath) {
    const img = new Image();
    img.src = fs.readFileSync(filePath);
    return img;
  }

  async loadImageFromBuffer(buffer) {
    const img = new Image();
    img.src = buffer;
    return img;
  }

  async detectFaces(image) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const canvas = new Canvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);

      // Detect faces
      const detections = await faceapi
        .detectAllFaces(canvas)
        .withFaceLandmarks()
        .withFaceDescriptors();

      return detections.map(detection => ({
        detection: detection.detection,
        landmarks: detection.landmarks,
        descriptor: detection.descriptor,
        box: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height
        }
      }));
    } catch (error) {
      console.error('Error detecting faces:', error);
      throw error;
    }
  }

  async computeFaceDescriptors(image) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const canvas = new Canvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);

      const detections = await faceapi
        .detectAllFaces(canvas)
        .withFaceLandmarks()
        .withFaceDescriptors();

      return detections.map(detection => detection.descriptor);
    } catch (error) {
      console.error('Error computing face descriptors:', error);
      throw error;
    }
  }

  async findSimilarFaces(sourceDescriptor, targetDescriptors, threshold = 0.6) {
    if (!sourceDescriptor || !targetDescriptors || targetDescriptors.length === 0) {
      return [];
    }

    const results = [];

    for (let i = 0; i < targetDescriptors.length; i++) {
      const distance = faceapi.euclideanDistance(sourceDescriptor, targetDescriptors[i]);
      const similarity = 1 - distance; // Convert distance to similarity score
      
      if (similarity >= threshold) {
        results.push({
          index: i,
          similarity: similarity,
          distance: distance,
          isMatch: similarity >= threshold
        });
      }
    }

    // Sort by similarity (highest first)
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, this.maxResults);
  }

  async compareFaces(sourceImage, targetImage) {
    try {
      // Compute descriptors for both images
      const sourceDescriptors = await this.computeFaceDescriptors(sourceImage);
      const targetDescriptors = await this.computeFaceDescriptors(targetImage);

      if (sourceDescriptors.length === 0 || targetDescriptors.length === 0) {
        return { matches: [], sourceFaces: 0, targetFaces: 0 };
      }

      // Find best matches for each face in source image
      const allMatches = [];

      for (const sourceDescriptor of sourceDescriptors) {
        const matches = await this.findSimilarFaces(sourceDescriptor, targetDescriptors);
        allMatches.push(...matches);
      }

      // Remove duplicates and get unique best matches
      const uniqueMatches = [];
      const usedIndices = new Set();

      for (const match of allMatches) {
        if (!usedIndices.has(match.index)) {
          uniqueMatches.push(match);
          usedIndices.add(match.index);
        }
      }

      return {
        matches: uniqueMatches,
        sourceFaces: sourceDescriptors.length,
        targetFaces: targetDescriptors.length,
        bestMatch: uniqueMatches.length > 0 ? uniqueMatches[0] : null
      };
    } catch (error) {
      console.error('Error comparing faces:', error);
      throw error;
    }
  }

  async validateImageForFaceDetection(image) {
    try {
      const faces = await this.detectFaces(image);
      
      const issues = [];
      const isValid = faces.length > 0;

      if (!isValid) {
        issues.push('No faces detected in the image');
      }

      // Check image quality based on detected faces
      if (faces.length > 0) {
        const face = faces[0];
        const { width, height } = face.box;

        // Check face size
        if (width < 50 || height < 50) {
          issues.push('Face is too small for accurate recognition');
        }

        // Check if face is centered enough (optional)
        const imageCenterX = image.width / 2;
        const imageCenterY = image.height / 2;
        const faceCenterX = face.box.x + face.box.width / 2;
        const faceCenterY = face.box.y + face.box.height / 2;

        const distanceFromCenter = Math.sqrt(
          Math.pow(faceCenterX - imageCenterX, 2) + 
          Math.pow(faceCenterY - imageCenterY, 2)
        );

        if (distanceFromCenter > Math.min(image.width, image.height) * 0.4) {
          issues.push('Face is too far from center');
        }
      }

      return {
        isValid,
        issues,
        faceCount: faces.length,
        imageSize: { width: image.width, height: image.height },
        faces: faces.map(face => face.box)
      };
    } catch (error) {
      console.error('Error validating image:', error);
      throw error;
    }
  }
}

// Singleton instance
const faceRecognitionService = new FaceRecognitionService();

export default faceRecognitionService;