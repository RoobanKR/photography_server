import cv2
import numpy as np
import face_recognition
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import aiofiles
import os
from PIL import Image
import io
import base64

app = FastAPI(title="Face Matching API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
FACE_MATCH_THRESHOLD = 0.6
KNOWN_FACES_DIR = "known_faces"

# Create directories if they don't exist
os.makedirs(KNOWN_FACES_DIR, exist_ok=True)

class FaceMatchingService:
    def __init__(self):
        self.known_face_encodings = []
        self.known_face_names = []
    
    def load_known_faces(self, event_id: str):
        """Load known faces for a specific event"""
        event_dir = os.path.join(KNOWN_FACES_DIR, event_id)
        if not os.path.exists(event_dir):
            return []
        
        face_encodings = []
        for filename in os.listdir(event_dir):
            if filename.endswith(".npy"):
                encoding = np.load(os.path.join(event_dir, filename))
                face_encodings.append(encoding)
        
        return face_encodings
    
    async def extract_face_encoding(self, image_bytes: bytes) -> Optional[np.ndarray]:
        """Extract face encoding from image bytes"""
        try:
            # Load image
            image = face_recognition.load_image_file(io.BytesIO(image_bytes))
            
            # Find face locations
            face_locations = face_recognition.face_locations(image)
            
            if len(face_locations) == 0:
                return None
            
            # Get face encodings
            face_encodings = face_recognition.face_encodings(image, face_locations)
            
            if len(face_encodings) > 0:
                return face_encodings[0]
            
            return None
            
        except Exception as e:
            print(f"Error extracting face encoding: {e}")
            return None
    
    async def find_matching_faces(self, selfie_bytes: bytes, event_images: List[dict]) -> List[dict]:
        """Find matching faces between selfie and event images"""
        try:
            # Extract selfie face encoding
            selfie_encoding = await self.extract_face_encoding(selfie_bytes)
            
            if selfie_encoding is None:
                return []
            
            matching_images = []
            
            for event_image in event_images:
                try:
                    # Download or get event image
                    event_image_bytes = await self.download_image(event_image['url'])
                    
                    if event_image_bytes:
                        # Extract face encodings from event image
                        event_face_encodings = face_recognition.face_encodings(
                            face_recognition.load_image_file(io.BytesIO(event_image_bytes)),
                            face_recognition.face_locations(
                                face_recognition.load_image_file(io.BytesIO(event_image_bytes))
                            )
                        )
                        
                        # Compare with selfie
                        for event_encoding in event_face_encodings:
                            # Calculate face distance
                            face_distance = face_recognition.face_distance([selfie_encoding], event_encoding)[0]
                            
                            # Convert distance to similarity (1 - distance)
                            similarity = 1 - face_distance
                            
                            if similarity >= FACE_MATCH_THRESHOLD:
                                matching_images.append({
                                    'file_id': event_image['_id'],
                                    'file_url': event_image['url'],
                                    'file_name': event_image['originalName'],
                                    'similarity': float(similarity),
                                    'confidence': float(similarity * 100),
                                    'face_distance': float(face_distance)
                                })
                                break
                                
                except Exception as e:
                    print(f"Error processing event image: {e}")
                    continue
            
            # Sort by similarity (descending)
            matching_images.sort(key=lambda x: x['similarity'], reverse=True)
            
            return matching_images
            
        except Exception as e:
            print(f"Error in find_matching_faces: {e}")
            return []
    
    async def download_image(self, url: str) -> Optional[bytes]:
        """Download image from URL"""
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        return await response.read()
                    return None
        except Exception as e:
            print(f"Error downloading image: {e}")
            return None

# Initialize service
face_service = FaceMatchingService()

@app.post("/api/face-match/process-selfie")
async def process_selfie(
    event_id: str,
    selfie: UploadFile = File(...),
    min_confidence: float = 0.6
):
    """Process selfie and find matching faces in event"""
    try:
        # Read selfie
        selfie_bytes = await selfie.read()
        
        # TODO: Load event images from database
        event_images = []  # This should come from your database
        
        # Find matching faces
        matches = await face_service.find_matching_faces(selfie_bytes, event_images)
        
        return {
            "success": True,
            "matches": matches,
            "total_matches": len(matches),
            "selfie_processed": True
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/face-match/extract-encoding")
async def extract_face_encoding(image: UploadFile = File(...)):
    """Extract face encoding from image"""
    try:
        image_bytes = await image.read()
        encoding = await face_service.extract_face_encoding(image_bytes)
        
        if encoding is None:
            raise HTTPException(status_code=400, detail="No face detected in image")
        
        # Convert to list for JSON serialization
        encoding_list = encoding.tolist()
        
        return {
            "success": True,
            "encoding": encoding_list,
            "encoding_length": len(encoding_list)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/face-match/compare-faces")
async def compare_faces(
    encoding1: List[float],
    encoding2: List[float]
):
    """Compare two face encodings"""
    try:
        # Convert lists to numpy arrays
        enc1 = np.array(encoding1)
        enc2 = np.array(encoding2)
        
        # Calculate face distance
        distance = face_recognition.face_distance([enc1], enc2)[0]
        similarity = 1 - distance
        
        return {
            "success": True,
            "distance": float(distance),
            "similarity": float(similarity),
            "match": similarity >= FACE_MATCH_THRESHOLD
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/face-match/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "face_matching",
        "version": "1.0.0"
    }