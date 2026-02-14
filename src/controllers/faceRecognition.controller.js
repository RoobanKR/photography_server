import FaceRecognitionService from '../config/faceRecognitionService.js';
import multer from 'multer';
import path from 'path';
import Event from '../models/Event.js';

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPEG, JPG, PNG)'));
    }
  }
}).single('selfie');

class FaceRecognitionController {
  constructor() {
    this.faceService = FaceRecognitionService;
  }

  // Initialize face recognition
  async initializeModels(req, res) {
    try {
      await this.faceService.initialize();
      res.status(200).json({
        success: true,
        message: 'Face recognition models initialized successfully'
      });
    } catch (error) {
      console.error('Error initializing models:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to initialize face recognition models',
        error: error.message
      });
    }
  }

  // Validate selfie image
  validateSelfie = (req, res) => {
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Please upload an image file'
        });
      }

      try {
        // Initialize face recognition service
        await this.faceService.initialize();

        // Create image from buffer
        const { createCanvas, loadImage } = await import('canvas');
        const img = await loadImage(req.file.buffer);

        // Validate image for face detection
        const validation = await this.faceService.validateImageForFaceDetection(img);

        res.status(200).json({
          success: true,
          validation,
          message: validation.isValid ? 
            'Image validated successfully' : 
            'Image validation failed',
          imageInfo: {
            size: req.file.size,
            mimetype: req.file.mimetype,
            originalName: req.file.originalname
          }
        });
      } catch (error) {
        console.error('Error validating selfie:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to validate image',
          error: error.message
        });
      }
    });
  }

  // Find matching faces in event photos
  findMatches = async (req, res) => {
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Please upload a selfie image'
        });
      }

      const { eventId } = req.params;
      const { threshold = 0.6 } = req.body;

      try {
        // Initialize face recognition service
        await this.faceService.initialize();

        // Load event and its media files
        const event = await Event.findById(eventId)
          .populate('mediaFiles')
          .exec();

        if (!event) {
          return res.status(404).json({
            success: false,
            message: 'Event not found'
          });
        }

        // Load selfie image
        const { createCanvas, loadImage } = await import('canvas');
        const selfieImg = await loadImage(req.file.buffer);

        // Get selfie face descriptors
        const selfieDescriptors = await this.faceService.computeFaceDescriptors(selfieImg);

        if (selfieDescriptors.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'No faces detected in the uploaded selfie'
          });
        }

        // Filter image files only
        const imageFiles = event.mediaFiles.filter(file => 
          file.type === 'image' && 
          file.url && 
          (file.url.startsWith('http') || file.url.startsWith('data:'))
        );

        const matches = [];
        const totalImages = imageFiles.length;
        let processedImages = 0;

        // Process each image file
        for (const imageFile of imageFiles) {
          try {
            // Load target image
            let targetImg;
            
            if (imageFile.url.startsWith('data:')) {
              // Handle base64 encoded images
              targetImg = await loadImage(imageFile.url);
            } else {
              // Handle URL images (for demo, use direct URL)
              targetImg = await loadImage(imageFile.url);
            }

            // Compute descriptors for target image
            const targetDescriptors = await this.faceService.computeFaceDescriptors(targetImg);

            if (targetDescriptors.length > 0) {
              // Compare with selfie descriptors
              for (const selfieDescriptor of selfieDescriptors) {
                const matchResults = await this.faceService.findSimilarFaces(
                  selfieDescriptor,
                  targetDescriptors,
                  parseFloat(threshold)
                );

                if (matchResults.length > 0) {
                  // Get face locations for visualization
                  const faceDetections = await this.faceService.detectFaces(targetImg);
                  
                  matches.push({
                    file: {
                      _id: imageFile._id,
                      url: imageFile.url,
                      originalName: imageFile.originalName,
                      type: imageFile.type,
                      size: imageFile.size,
                      format: imageFile.format,
                      uploadedAt: imageFile.uploadedAt
                    },
                    matches: matchResults.map(match => ({
                      similarity: match.similarity,
                      distance: match.distance,
                      confidence: match.similarity * 100
                    })),
                    bestMatch: {
                      confidence: matchResults[0].similarity * 100,
                      similarity: matchResults[0].similarity,
                      distance: matchResults[0].distance
                    },
                    faceCount: targetDescriptors.length,
                    faceLocations: faceDetections.map(detection => [
                      Math.round(detection.box.y), // top
                      Math.round(detection.box.x + detection.box.width), // right
                      Math.round(detection.box.y + detection.box.height), // bottom
                      Math.round(detection.box.x) // left
                    ]),
                    processingTime: 0.5 // Simulated for now
                  });
                  break; // Found at least one match, move to next image
                }
              }
            }

            processedImages++;
            
            // Optional: Send progress updates (for long operations)
            if (req.query.progress === 'true' && totalImages > 10) {
              const progress = Math.round((processedImages / totalImages) * 100);
              // You could implement WebSocket or Server-Sent Events for real-time progress
            }

          } catch (error) {
            console.error(`Error processing image ${imageFile._id}:`, error);
            // Continue with next image
          }
        }

        // Sort matches by confidence (highest first)
        matches.sort((a, b) => b.bestMatch.confidence - a.bestMatch.confidence);

        // Calculate statistics
        const totalFaces = matches.reduce((sum, match) => sum + match.faceCount, 0);
        const avgConfidence = matches.length > 0 
          ? matches.reduce((sum, match) => sum + match.bestMatch.confidence, 0) / matches.length 
          : 0;

        res.status(200).json({
          success: true,
          matches,
          statistics: {
            totalImagesProcessed: totalImages,
            imagesWithMatches: matches.length,
            totalFacesDetected: totalFaces,
            averageConfidence: avgConfidence,
            selfieFaces: selfieDescriptors.length,
            processingTime: totalImages * 0.1 // Simulated
          },
          message: matches.length > 0 
            ? `Found ${matches.length} matching photos with ${totalFaces} face matches`
            : 'No matching photos found'
        });

      } catch (error) {
        console.error('Error finding matches:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to find matching photos',
          error: error.message
        });
      }
    });
  }

  // Demo endpoint for testing without actual processing
  findDemoMatches = async (req, res) => {
    const { eventId } = req.params;
    const { count = 8 } = req.query;

    try {
      const event = await Event.findById(eventId)
        .populate('mediaFiles')
        .exec();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }

      // Filter image files only
      const imageFiles = event.mediaFiles.filter(file => file.type === 'image');
      const demoMatches = [];

      // Create demo matches
      for (let i = 0; i < Math.min(parseInt(count), imageFiles.length); i++) {
        const file = imageFiles[i];
        const hasFace = Math.random() > 0.3; // 70% chance of having a face
        
        if (hasFace) {
          const confidence = 65 + (Math.random() * 30); // 65-95% confidence
          const faceCount = Math.floor(Math.random() * 3) + 1; // 1-3 faces
          
          const faceLocations = Array.from({ length: faceCount }, (_, idx) => [
            50 + idx * 100, // top
            150 + idx * 120, // right
            200 + idx * 100, // bottom
            100 + idx * 120  // left
          ]);

          demoMatches.push({
            file: {
              _id: file._id,
              url: file.url,
              originalName: file.originalName,
              type: file.type,
              size: file.size,
              format: file.format,
              uploadedAt: file.uploadedAt
            },
            bestMatch: {
              confidence: confidence,
              similarity: confidence / 100,
              distance: 1 - (confidence / 100)
            },
            matches: [{
              similarity: confidence / 100,
              distance: 1 - (confidence / 100),
              confidence: confidence
            }],
            faceCount: faceCount,
            faceLocations: faceLocations,
            processingTime: 0.3 + Math.random() * 0.4
          });
        }
      }

      // Sort by confidence
      demoMatches.sort((a, b) => b.bestMatch.confidence - a.bestMatch.confidence);

      // Calculate statistics
      const totalFaces = demoMatches.reduce((sum, match) => sum + match.faceCount, 0);
      const avgConfidence = demoMatches.length > 0 
        ? demoMatches.reduce((sum, match) => sum + match.bestMatch.confidence, 0) / demoMatches.length 
        : 0;

      res.status(200).json({
        success: true,
        matches: demoMatches,
        statistics: {
          totalImagesProcessed: imageFiles.length,
          imagesWithMatches: demoMatches.length,
          totalFacesDetected: totalFaces,
          averageConfidence: avgConfidence,
          selfieFaces: 1,
          processingTime: imageFiles.length * 0.1
        },
        message: 'Demo matches generated successfully',
        isDemo: true
      });

    } catch (error) {
      console.error('Error generating demo matches:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate demo matches',
        error: error.message
      });
    }
  }

  // Get face recognition status
  getStatus = async (req, res) => {
    try {
      await this.faceService.initialize();
      
      res.status(200).json({
        success: true,
        status: 'active',
        initialized: true,
        models: ['ssdMobilenetv1', 'faceRecognitionNet', 'faceLandmark68Net'],
        minConfidence: this.faceService.minConfidence,
        maxResults: this.faceService.maxResults,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(200).json({
        success: true,
        status: 'inactive',
        initialized: false,
        error: error.message,
        fallbackAvailable: true,
        timestamp: new Date().toISOString()
      });
    }
  }
}

export default new FaceRecognitionController();