/** Additional geometry utilities for landmark analysis */

/** Angle (degrees) between three points: B is the vertex */
export function angleDeg(A: [number, number], B: [number, number], C: [number, number]): number {
  const ABx = A[0] - B[0], ABy = A[1] - B[1];
  const CBx = C[0] - B[0], CBy = C[1] - B[1];
  const dot = ABx * CBx + ABy * CBy;
  const magAB = Math.sqrt(ABx ** 2 + ABy ** 2);
  const magCB = Math.sqrt(CBx ** 2 + CBy ** 2);
  return (Math.acos(dot / (magAB * magCB + 1e-8)) * 180) / Math.PI;
}

/** Check if two bounding boxes overlap significantly (for face tracking) */
export function boxOverlap(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): number {
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aArea = (ax2 - ax1) * (ay2 - ay1);
  return inter / (aArea + 1e-8);
}

/** Clamp value between min and max */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
