import express from 'express';
import faceRecognitionController from '../controllers/faceRecognition.controller.js';

const router = express.Router();

// Public routes
router.get('/status', faceRecognitionController.getStatus);
router.post('/validate-selfie', faceRecognitionController.validateSelfie);
router.post('/events/:eventId/find-matches', faceRecognitionController.findMatches);
router.get('/events/:eventId/demo-matches', faceRecognitionController.findDemoMatches);

// Admin routes (optional)
router.post('/initialize', faceRecognitionController.initializeModels);

export default router;