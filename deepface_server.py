from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np
import cv2
import requests
from io import BytesIO
from PIL import Image
import tempfile
import os
import json
from typing import Optional, List, Dict, Any
import time



# DeepFace imports
try:
    from deepface import DeepFace
    from deepface.commons import functions
    from deepface.modules import verification, detection, modeling
    DEEPFACE_AVAILABLE = True
except ImportError:
    print("DeepFace not installed. Installing...")
    import subprocess
    subprocess.run(["pip", "install", "deepface", "opencv-python", "pillow"])
    try:
        from deepface import DeepFace
        from deepface.commons import functions
        from deepface.modules import verification, detection, modeling
        DEEPFACE_AVAILABLE = True
    except:
        DEEPFACE_AVAILABLE = False
        print("Failed to import DeepFace")

app = FastAPI(
    title="DeepFace AI Server",
    description="Face recognition and analysis API using DeepFace",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://photography-theta-self.vercel.app", "http://localhost:5000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Available models and detectors
AVAILABLE_MODELS = ["VGG-Face", "Facenet", "OpenFace", "DeepFace", "DeepID", "ArcFace"]
AVAILABLE_DETECTORS = ["opencv", "ssd", "mtcnn", "dlib", "retinaface"]
AVAILABLE_METRICS = ["cosine", "euclidean", "euclidean_l2"]

@app.get("/")
async def root():
    return {
        "message": "DeepFace AI Server",
        "version": "1.0.0",
        "endpoints": {
            "/health": "Server health check",
            "/api/analyze": "Analyze faces in an image",
            "/api/verify": "Verify if two faces match",
            "/api/models": "List available models",
            "/api/detectors": "List available detectors"
        }
    }

@app.get("/health")
async def health_check():
    status = {
        "status": "healthy" if DEEPFACE_AVAILABLE else "error",
        "deepface_available": DEEPFACE_AVAILABLE,
        "models": AVAILABLE_MODELS if DEEPFACE_AVAILABLE else [],
        "detectors": AVAILABLE_DETECTORS if DEEPFACE_AVAILABLE else [],
        "metrics": AVAILABLE_METRICS if DEEPFACE_AVAILABLE else [],
        "timestamp": time.time()
    }
    return status

@app.get("/api/models")
async def get_models():
    return {
        "success": True,
        "models": AVAILABLE_MODELS,
        "default": "VGG-Face"
    }

@app.get("/api/detectors")
async def get_detectors():
    return {
        "success": True,
        "detectors": AVAILABLE_DETECTORS,
        "default": "opencv",
        "recommendations": {
            "opencv": "Fastest, good for real-time",
            "mtcnn": "More accurate, slower",
            "retinaface": "Most accurate, slowest"
        }
    }

def load_image_from_url(url: str):
    """Load image from URL"""
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content))
        
        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Convert to numpy array
        img_array = np.array(image)
        
        # Convert BGR to RGB if needed
        if len(img_array.shape) == 3 and img_array.shape[2] == 3:
            img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
        
        return img_array
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load image from URL: {str(e)}")

def load_image_from_file(file: UploadFile):
    """Load image from uploaded file"""
    try:
        contents = file.file.read()
        image = Image.open(BytesIO(contents))
        
        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Convert to numpy array
        img_array = np.array(image)
        
        # Convert BGR to RGB if needed
        if len(img_array.shape) == 3 and img_array.shape[2] == 3:
            img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
        
        return img_array
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load image: {str(e)}")
    finally:
        file.file.seek(0)

@app.post("/api/analyze")
async def analyze_faces(
    image: Optional[UploadFile] = File(None),
    image_url: Optional[str] = Form(None),
    detector: str = Form("opencv"),
    enforce_detection: bool = Form(True)
):
    """
    Analyze faces in an image
    Returns face locations, emotions, age, gender, and race
    """
    if not DEEPFACE_AVAILABLE:
        raise HTTPException(status_code=503, detail="DeepFace not available")
    
    if detector not in AVAILABLE_DETECTORS:
        raise HTTPException(status_code=400, detail=f"Invalid detector. Available: {AVAILABLE_DETECTORS}")
    
    try:
        # Load image from either file or URL
        if image:
            img_array = load_image_from_file(image)
        elif image_url:
            img_array = load_image_from_url(image_url)
        else:
            raise HTTPException(status_code=400, detail="Either image file or image_url must be provided")
        
        # Perform face analysis
        analysis = DeepFace.analyze(
            img_path=img_array,
            actions=['emotion', 'age', 'gender', 'race'],
            detector_backend=detector,
            enforce_detection=enforce_detection,
            silent=True
        )
        
        # Convert analysis to serializable format
        faces = []
        if isinstance(analysis, list):
            for face in analysis:
                faces.append({
                    "region": {
                        "x": int(face.get("region", {}).get("x", 0)),
                        "y": int(face.get("region", {}).get("y", 0)),
                        "w": int(face.get("region", {}).get("w", 0)),
                        "h": int(face.get("region", {}).get("h", 0))
                    },
                    "confidence": float(face.get("confidence", 0.9)),
                    "emotion": face.get("dominant_emotion", "neutral"),
                    "emotions": face.get("emotion", {}),
                    "age": int(face.get("age", 0)),
                    "gender": face.get("dominant_gender", "unknown"),
                    "gender_distribution": face.get("gender", {}),
                    "race": face.get("dominant_race", "unknown"),
                    "race_distribution": face.get("race", {})
                })
        else:
            faces.append({
                "region": {
                    "x": int(analysis.get("region", {}).get("x", 0)),
                    "y": int(analysis.get("region", {}).get("y", 0)),
                    "w": int(analysis.get("region", {}).get("w", 0)),
                    "h": int(analysis.get("region", {}).get("h", 0))
                },
                "confidence": float(analysis.get("confidence", 0.9)),
                "emotion": analysis.get("dominant_emotion", "neutral"),
                "emotions": analysis.get("emotion", {}),
                "age": int(analysis.get("age", 0)),
                "gender": analysis.get("dominant_gender", "unknown"),
                "gender_distribution": analysis.get("gender", {}),
                "race": analysis.get("dominant_race", "unknown"),
                "race_distribution": analysis.get("race", {})
            })
        
        return {
            "success": True,
            "faces": faces,
            "face_count": len(faces),
            "detector": detector,
            "analysis_time": time.time()
        }
        
    except Exception as e:
        error_msg = str(e)
        # Check if it's a "face not detected" error
        if "Face could not be detected" in error_msg:
            return {
                "success": True,
                "faces": [],
                "face_count": 0,
                "detector": detector,
                "message": "No faces detected in the image",
                "analysis_time": time.time()
            }
        raise HTTPException(status_code=500, detail=f"Analysis failed: {error_msg}")

@app.post("/api/verify")
async def verify_faces(
    img1: Optional[UploadFile] = File(None),
    img2: Optional[UploadFile] = File(None),
    img1_url: Optional[str] = Form(None),
    img2_url: Optional[str] = Form(None),
    model: str = Form("VGG-Face"),
    detector: str = Form("opencv"),
    metrics: str = Form("cosine"),
    enforce_detection: bool = Form(False)
):
    """
    Verify if two faces match
    Returns similarity score and verification result
    """
    if not DEEPFACE_AVAILABLE:
        raise HTTPException(status_code=503, detail="DeepFace not available")
    
    if model not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid model. Available: {AVAILABLE_MODELS}")
    
    if detector not in AVAILABLE_DETECTORS:
        raise HTTPException(status_code=400, detail=f"Invalid detector. Available: {AVAILABLE_DETECTORS}")
    
    if metrics not in AVAILABLE_METRICS:
        raise HTTPException(status_code=400, detail=f"Invalid metric. Available: {AVAILABLE_METRICS}")
    
    try:
        # Load first image
        if img1:
            img1_array = load_image_from_file(img1)
        elif img1_url:
            img1_array = load_image_from_url(img1_url)
        else:
            raise HTTPException(status_code=400, detail="First image must be provided")
        
        # Load second image
        if img2:
            img2_array = load_image_from_file(img2)
        elif img2_url:
            img2_array = load_image_from_url(img2_url)
        else:
            raise HTTPException(status_code=400, detail="Second image must be provided")
        
        # Perform face verification
        start_time = time.time()
        
        result = DeepFace.verify(
            img1_path=img1_array,
            img2_path=img2_array,
            model_name=model,
            detector_backend=detector,
            distance_metric=metrics,
            enforce_detection=enforce_detection,
            silent=True
        )
        
        processing_time = time.time() - start_time
        
        # Convert result to serializable format
        response = {
            "success": True,
            "verified": bool(result.get("verified", False)),
            "distance": float(result.get("distance", 1.0)),
            "similarity": float(1 - result.get("distance", 1.0)),
            "threshold": float(result.get("threshold", 0.4)),
            "model": model,
            "detector": detector,
            "metrics": metrics,
            "processing_time": processing_time,
            "analysis": {
                "img1_face": result.get("facial_areas", {}).get("img1", {}),
                "img2_face": result.get("facial_areas", {}).get("img2", {})
            }
        }
        
        return response
        
    except Exception as e:
        error_msg = str(e)
        # Check if it's a "face not detected" error
        if "Face could not be detected" in error_msg:
            return {
                "success": True,
                "verified": False,
                "distance": 1.0,
                "similarity": 0.0,
                "message": "Face could not be detected in one or both images",
                "model": model,
                "detector": detector,
                "metrics": metrics
            }
        raise HTTPException(status_code=500, detail=f"Verification failed: {error_msg}")

@app.post("/api/batch-verify")
async def batch_verify(
    target_image: UploadFile = File(...),
    image_urls: str = Form(...),
    model: str = Form("VGG-Face"),
    detector: str = Form("opencv"),
    metrics: str = Form("cosine"),
    threshold: float = Form(0.4)
):
    """
    Batch verify target image against multiple image URLs
    """
    if not DEEPFACE_AVAILABLE:
        raise HTTPException(status_code=503, detail="DeepFace not available")
    
    try:
        # Load target image
        target_array = load_image_from_file(target_image)
        
        # Parse image URLs
        urls = json.loads(image_urls)
        if not isinstance(urls, list):
            raise HTTPException(status_code=400, detail="image_urls must be a JSON array")
        
        results = []
        start_time = time.time()
        
        for i, url in enumerate(urls):
            try:
                # Load comparison image
                compare_array = load_image_from_url(url)
                
                # Verify faces
                result = DeepFace.verify(
                    img1_path=target_array,
                    img2_path=compare_array,
                    model_name=model,
                    detector_backend=detector,
                    distance_metric=metrics,
                    enforce_detection=False,
                    silent=True
                )
                
                similarity = 1 - result.get("distance", 1.0)
                verified = similarity > threshold
                
                results.append({
                    "url": url,
                    "verified": bool(verified),
                    "distance": float(result.get("distance", 1.0)),
                    "similarity": float(similarity),
                    "match": bool(result.get("verified", False))
                })
                
            except Exception as e:
                results.append({
                    "url": url,
                    "verified": False,
                    "distance": 1.0,
                    "similarity": 0.0,
                    "match": False,
                    "error": str(e)
                })
        
        processing_time = time.time() - start_time
        
        # Count successful matches
        matches = [r for r in results if r.get("verified", False)]
        
        return {
            "success": True,
            "results": results,
            "summary": {
                "total_images": len(urls),
                "matches": len(matches),
                "match_rate": len(matches) / len(urls) if urls else 0,
                "processing_time": processing_time,
                "avg_time_per_image": processing_time / len(urls) if urls else 0
            },
            "model": model,
            "detector": detector,
            "metrics": metrics,
            "threshold": threshold
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch verification failed: {str(e)}")

@app.post("/api/detect")
async def detect_faces(
    image: Optional[UploadFile] = File(None),
    image_url: Optional[str] = Form(None),
    detector: str = Form("opencv")
):
    """
    Detect faces in an image (faster than full analysis)
    """
    if not DEEPFACE_AVAILABLE:
        raise HTTPException(status_code=503, detail="DeepFace not available")
    
    try:
        # Load image
        if image:
            img_array = load_image_from_file(image)
        elif image_url:
            img_array = load_image_from_url(image_url)
        else:
            raise HTTPException(status_code=400, detail="Either image file or image_url must be provided")
        
        # Detect faces only
        faces = detection.extract_faces(
            img_path=img_array,
            detector_backend=detector,
            enforce_detection=False,
            align=True
        )
        
        # Extract face regions
        face_regions = []
        for face_obj in faces:
            if hasattr(face_obj, 'shape'):
                # Face object is numpy array
                h, w = face_obj.shape[:2]
                face_regions.append({
                    "width": w,
                    "height": h
                })
            elif isinstance(face_obj, dict) and 'face' in face_obj:
                # Face object with metadata
                face = face_obj['face']
                if isinstance(face, np.ndarray):
                    h, w = face.shape[:2]
                    face_regions.append({
                        "width": w,
                        "height": h
                    })
        
        return {
            "success": True,
            "faces": face_regions,
            "face_count": len(face_regions),
            "detector": detector
        }
        
    except Exception as e:
        error_msg = str(e)
        if "Face could not be detected" in error_msg:
            return {
                "success": True,
                "faces": [],
                "face_count": 0,
                "detector": detector,
                "message": "No faces detected"
            }
        raise HTTPException(status_code=500, detail=f"Detection failed: {error_msg}")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": str(exc),
            "message": "Internal server error"
        }
    )

if __name__ == "__main__":
    import uvicorn
    
    print("=" * 50)
    print("DeepFace AI Server")
    print("=" * 50)
    print(f"Available models: {AVAILABLE_MODELS}")
    print(f"Available detectors: {AVAILABLE_DETECTORS}")
    print(f"Available metrics: {AVAILABLE_METRICS}")
    print("=" * 50)
    print("Server starting on http://localhost:8000")
    print("=" * 50)
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=True
    )