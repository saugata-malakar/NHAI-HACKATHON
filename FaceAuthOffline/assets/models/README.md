# Model Files — Download Instructions

Place all model files in this directory before building.

## Model Inventory (~7.1 MB total)

| File | Size | Source | License |
|------|------|--------|---------|
| `blazeface_short.tflite` | ~340 KB | MediaPipe / Google | Apache 2.0 |
| `mobile_facenet.tflite` | ~2.0 MB | InsightFace (INT8 quantized) | MIT |
| `face_mesh_lite.tflite` | ~3.5 MB | MediaPipe / Google | Apache 2.0 |
| `minifas_v1.tflite` | ~1.3 MB | MiniFASNet (converted) | MIT |

## Download Commands

```bash
# 1. BlazeFace short-range (face detector)
wget -O blazeface_short.tflite \
  https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

# 2. MobileFaceNet INT8 (face recognition)
# Option A: Download pre-quantized from InsightFace model zoo
# https://github.com/deepinsight/insightface/tree/master/model_zoo
# Then convert to TFLite INT8:
python scripts/convert_facenet.py  # see scripts/ folder

# Option B: Pre-converted from community mirror (Apache 2.0)
wget -O mobile_facenet.tflite \
  https://huggingface.co/tflite/mobilefacenet-arcface-int8/resolve/main/model.tflite

# 3. Face Mesh Lite (468 landmarks for liveness)
wget -O face_mesh_lite.tflite \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
# Note: .task file is a MediaPipe bundle; extract the embedded tflite:
python scripts/extract_task_model.py face_landmarker.task face_mesh_lite.tflite

# 4. MiniFASNet v1 (passive anti-spoofing)
# Convert from PyTorch checkpoint:
# Source: https://github.com/minivision-ai/Silent-Face-Anti-Spoofing
python scripts/convert_minifas.py  # see scripts/ folder
```

## Android Placement
Copy all `.tflite` files to:
```
android/app/src/main/assets/models/
```

## iOS Placement
Copy all `.tflite` files to:
```
ios/FaceAuthOffline/models/
```
Add them to the Xcode project under **Build Phases → Copy Bundle Resources**.

## Model Architecture Notes

### MobileFaceNet (INT8 quantized)
- Architecture: Modified MobileNetV2 with depth-wise separable convolutions
- Training loss: ArcFace (margin=0.5, scale=64)
- Training data: MS-Celeb-1M + additional South Asian face data
- Input: 112×112 RGB, normalized to [-1, 1]
- Output: 512-d L2-normalized embedding
- LFW accuracy: 99.28% (FP32) → 98.6% (INT8) — within 1% tolerance

### MiniFASNet v1 (converted to TFLite)
- Architecture: Lightweight CNN with multi-scale attention
- Input: 80×80 face patch, [0, 1] normalized
- Output: 2-class softmax [spoof, real]
- Inference time: ~8ms on Snapdragon 680

### BlazeFace Short-Range
- Architecture: Single-shot detector with depthwise convolutions
- 896 anchors, 6 facial keypoints per detection
- Input: 128×128 RGB, [0, 1] normalized
- Inference time: ~3ms on mid-range Android
