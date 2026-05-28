/**
 * FaceDetector
 * Wraps BlazeFace short-range TFLite model.
 *
 * Input:  128×128 RGB float32 tensor  [1, 128, 128, 3]
 * Output: regressors [1, 896, 16] + classificators [1, 896, 1]
 *
 * Returns normalized bounding boxes [x1,y1,x2,y2] in [0,1] range.
 */

import { ModelLoader } from './ModelLoader';

export interface FaceBox {
  x1: number; // normalized [0,1]
  y1: number;
  x2: number;
  y2: number;
  score: number;
  /** Six keypoints: [rightEye, leftEye, nose, mouth, rightEar, leftEar] */
  keypoints: Array<[number, number]>;
}

const INPUT_SIZE = 128;
const SCORE_THRESHOLD = 0.75;
const NMS_IOU_THRESHOLD = 0.3;

/** Pre-computed BlazeFace anchor grid for 128×128 short-range model */
function generateAnchors(): Array<[number, number]> {
  const anchors: Array<[number, number]> = [];
  const strides = [8, 16];
  const anchorsPerCell = [2, 6];

  for (let s = 0; s < strides.length; s++) {
    const stride = strides[s];
    const gridSize = Math.ceil(INPUT_SIZE / stride);
    const count = anchorsPerCell[s];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        for (let a = 0; a < count; a++) {
          anchors.push([
            (x + 0.5) / gridSize,
            (y + 0.5) / gridSize,
          ]);
        }
      }
    }
  }
  return anchors;
}

const ANCHORS = generateAnchors(); // 896 anchors

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function iou(a: FaceBox, b: FaceBox): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const intersection = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
  const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
  return intersection / (aArea + bArea - intersection + 1e-6);
}

function nms(boxes: FaceBox[]): FaceBox[] {
  boxes.sort((a, b) => b.score - a.score);
  const kept: FaceBox[] = [];
  for (const box of boxes) {
    if (kept.every(k => iou(k, box) < NMS_IOU_THRESHOLD)) {
      kept.push(box);
    }
  }
  return kept;
}

/**
 * Detect faces in a preprocessed 128×128 RGB float32 tensor.
 * @param inputTensor Flat Float32Array of length 128*128*3 in [0,1] range
 */
export async function detectFaces(inputTensor: Float32Array): Promise<FaceBox[]> {
  const model = ModelLoader.get('blazeface');

  const outputs = await model.run([inputTensor]);
  const regressors: Float32Array = outputs[0] as Float32Array;   // [896, 16]
  const scores: Float32Array = outputs[1] as Float32Array;       // [896, 1]

  const candidates: FaceBox[] = [];

  for (let i = 0; i < 896; i++) {
    const score = sigmoid(scores[i]);
    if (score < SCORE_THRESHOLD) continue;

    const [anchorX, anchorY] = ANCHORS[i];
    const base = i * 16;

    // Decode box (cx, cy, w, h)
    const cx = regressors[base + 0] / INPUT_SIZE + anchorX;
    const cy = regressors[base + 1] / INPUT_SIZE + anchorY;
    const w  = regressors[base + 2] / INPUT_SIZE;
    const h  = regressors[base + 3] / INPUT_SIZE;

    // Decode 6 keypoints
    const kps: Array<[number, number]> = [];
    for (let k = 0; k < 6; k++) {
      const kx = regressors[base + 4 + k * 2 + 0] / INPUT_SIZE + anchorX;
      const ky = regressors[base + 4 + k * 2 + 1] / INPUT_SIZE + anchorY;
      kps.push([kx, ky]);
    }

    candidates.push({
      x1: cx - w / 2, y1: cy - h / 2,
      x2: cx + w / 2, y2: cy + h / 2,
      score, keypoints: kps,
    });
  }

  return nms(candidates);
}

/** Returns the largest (highest-area) face box, or null if none detected */
export function getLargestFace(boxes: FaceBox[]): FaceBox | null {
  if (!boxes.length) return null;
  return boxes.reduce((best, b) => {
    const area = (b.x2 - b.x1) * (b.y2 - b.y1);
    const bestArea = (best.x2 - best.x1) * (best.y2 - best.y1);
    return area > bestArea ? b : best;
  });
}
