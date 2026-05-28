/**
 * LandmarkDetector
 * Runs MediaPipe Face Mesh Lite TFLite model.
 *
 * Input:  192×192 RGB float32 [0, 1]   [1, 192, 192, 3]
 * Output: 468 landmarks × (x, y, z)    [1, 1, 1404]  (x, y in [0,1]; z relative depth)
 *
 * Landmark indices used for liveness:
 *   Right eye: 33, 160, 158, 133, 153, 144
 *   Left eye:  362, 385, 387, 263, 373, 380
 *   Mouth corners: 61, 291
 *   Mouth top/bottom: 13, 14
 *   Nose tip: 4
 *   Face corners (for head pose): 10, 152, 234, 454
 */

import { ModelLoader } from './ModelLoader';

export interface Landmark {
  x: number; // [0, 1]
  y: number; // [0, 1]
  z: number; // relative depth
}

export type Landmarks = Landmark[];

/** Named landmark index constants */
export const LM = {
  // Right eye (anatomically right of subject)
  R_EYE_OUTER: 33,
  R_EYE_UPPER1: 160,
  R_EYE_UPPER2: 158,
  R_EYE_INNER: 133,
  R_EYE_LOWER1: 153,
  R_EYE_LOWER2: 144,

  // Left eye
  L_EYE_OUTER: 362,
  L_EYE_UPPER1: 385,
  L_EYE_UPPER2: 387,
  L_EYE_INNER: 263,
  L_EYE_LOWER1: 373,
  L_EYE_LOWER2: 380,

  // Mouth
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
  MOUTH_TOP: 13,
  MOUTH_BOTTOM: 14,
  MOUTH_UPPER_LIP: 0,
  MOUTH_LOWER_LIP: 17,

  // Nose
  NOSE_TIP: 4,
  NOSE_BRIDGE: 6,

  // Head pose reference points
  HEAD_TOP: 10,
  HEAD_CHIN: 152,
  HEAD_LEFT: 234,
  HEAD_RIGHT: 454,
  LEFT_TEMPLE: 356,
  RIGHT_TEMPLE: 127,
};

/**
 * Run face mesh on a 192×192 face crop.
 * @param facePixels Float32Array [192*192*3], values [0, 1]
 * @returns Array of 468 (x, y, z) landmarks, or null if no face found
 */
export async function detectLandmarks(facePixels: Float32Array): Promise<Landmarks | null> {
  const model = ModelLoader.get('facemesh');
  const outputs = await model.run([facePixels]);

  const raw = outputs[0] as Float32Array; // [1404]
  if (!raw || raw.length < 1404) return null;

  const landmarks: Landmarks = [];
  for (let i = 0; i < 468; i++) {
    landmarks.push({
      x: raw[i * 3 + 0],
      y: raw[i * 3 + 1],
      z: raw[i * 3 + 2],
    });
  }

  return landmarks;
}

/** Euclidean distance between two landmarks */
export function dist(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Eye Aspect Ratio (EAR) — Soukupová & Čech (2016)
 * EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
 * EAR < 0.21 → eye closed
 */
export function eyeAspectRatio(lm: Landmarks, side: 'left' | 'right'): number {
  const idx = side === 'right'
    ? [LM.R_EYE_OUTER, LM.R_EYE_UPPER1, LM.R_EYE_UPPER2, LM.R_EYE_INNER, LM.R_EYE_LOWER1, LM.R_EYE_LOWER2]
    : [LM.L_EYE_OUTER, LM.L_EYE_UPPER1, LM.L_EYE_UPPER2, LM.L_EYE_INNER, LM.L_EYE_LOWER1, LM.L_EYE_LOWER2];

  const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
  return (dist(p2, p6) + dist(p3, p5)) / (2 * dist(p1, p4) + 1e-6);
}

/**
 * Mouth Aspect Ratio (MAR) — smile/open mouth detection
 * MAR = vertical_gap / horizontal_width
 * MAR > 0.35 → open/smiling
 */
export function mouthAspectRatio(lm: Landmarks): number {
  const top = lm[LM.MOUTH_TOP];
  const bottom = lm[LM.MOUTH_BOTTOM];
  const left = lm[LM.MOUTH_LEFT];
  const right = lm[LM.MOUTH_RIGHT];
  return dist(top, bottom) / (dist(left, right) + 1e-6);
}

/**
 * Estimate head yaw (left-right rotation) from facial landmarks.
 * Returns angle in degrees. Positive = turned right, negative = turned left.
 */
export function headYaw(lm: Landmarks): number {
  const leftTemple = lm[LM.LEFT_TEMPLE];
  const rightTemple = lm[LM.RIGHT_TEMPLE];
  const nose = lm[LM.NOSE_TIP];

  const midX = (leftTemple.x + rightTemple.x) / 2;
  const totalWidth = Math.abs(rightTemple.x - leftTemple.x);
  const offset = (nose.x - midX) / (totalWidth + 1e-6);

  // offset: -0.5 (fully left) to +0.5 (fully right); map to degrees
  return offset * 90;
}

/**
 * Smile intensity — ratio of mouth width increase vs. neutral
 * Returns [0, 1]; > 0.5 = clear smile
 */
export function smileIntensity(lm: Landmarks): number {
  const mouthWidth = dist(lm[LM.MOUTH_LEFT], lm[LM.MOUTH_RIGHT]);
  const faceWidth = dist(lm[LM.HEAD_LEFT], lm[LM.HEAD_RIGHT]);
  // Typical neutral ratio ≈ 0.45; smile ≈ 0.55+
  const ratio = mouthWidth / (faceWidth + 1e-6);
  return Math.min(1, Math.max(0, (ratio - 0.40) / 0.20));
}
