/**
 * Image preprocessing utilities for TFLite models.
 * All operations run on the JS thread; hot paths are kept tight.
 */

/** Bilinear resize of an RGBA Uint8Array (width × height × 4) → Float32Array (targetW × targetH × 3) */
export function resizeAndNormalizeRGBA(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  /** 'zero_one' → [0,1]; 'minus_one_one' → [-1,1] */
  norm: 'zero_one' | 'minus_one_one' = 'zero_one',
): Float32Array {
  const out = new Float32Array(targetW * targetH * 3);
  const scaleX = srcW / targetW;
  const scaleY = srcH / targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcXf = (x + 0.5) * scaleX - 0.5;
      const srcYf = (y + 0.5) * scaleY - 0.5;

      const x0 = Math.max(0, Math.floor(srcXf));
      const y0 = Math.max(0, Math.floor(srcYf));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const wx = srcXf - x0;
      const wy = srcYf - y0;

      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * srcW + x0) * 4 + c];
        const p10 = src[(y0 * srcW + x1) * 4 + c];
        const p01 = src[(y1 * srcW + x0) * 4 + c];
        const p11 = src[(y1 * srcW + x1) * 4 + c];

        let val = (1 - wy) * ((1 - wx) * p00 + wx * p10)
                +  wy      * ((1 - wx) * p01 + wx * p11);

        val /= 255;
        if (norm === 'minus_one_one') val = val * 2 - 1;

        out[(y * targetW + x) * 3 + c] = val;
      }
    }
  }

  return out;
}

/**
 * Crop a face region from an RGBA frame, with padding.
 * @param paddingFactor 1.0 = tight crop; 1.4 = 40% padding around face box
 */
export function cropFaceRegion(
  frame: Uint8Array,
  frameW: number,
  frameH: number,
  x1Norm: number,
  y1Norm: number,
  x2Norm: number,
  y2Norm: number,
  paddingFactor: number = 1.3,
): { data: Uint8Array; w: number; h: number } {
  const cx = (x1Norm + x2Norm) / 2;
  const cy = (y1Norm + y2Norm) / 2;
  let bw = (x2Norm - x1Norm) * paddingFactor;
  let bh = (y2Norm - y1Norm) * paddingFactor;
  const half = Math.max(bw, bh) / 2;

  const px1 = Math.max(0, Math.floor((cx - half) * frameW));
  const py1 = Math.max(0, Math.floor((cy - half) * frameH));
  const px2 = Math.min(frameW, Math.ceil((cx + half) * frameW));
  const py2 = Math.min(frameH, Math.ceil((cy + half) * frameH));

  const cw = px2 - px1;
  const ch = py2 - py1;
  const out = new Uint8Array(cw * ch * 4);

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const srcIdx = ((py1 + y) * frameW + (px1 + x)) * 4;
      const dstIdx = (y * cw + x) * 4;
      out[dstIdx]     = frame[srcIdx];
      out[dstIdx + 1] = frame[srcIdx + 1];
      out[dstIdx + 2] = frame[srcIdx + 2];
      out[dstIdx + 3] = 255;
    }
  }

  return { data: out, w: cw, h: ch };
}

/**
 * Apply simple CLAHE-like local contrast enhancement for outdoor lighting.
 * Runs per-channel histogram equalization on luminance.
 */
export function enhanceOutdoorLighting(
  rgba: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const out = new Uint8Array(rgba.length);

  // Compute histogram of luminance
  const hist = new Int32Array(256);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[lum]++;
  }

  // CDF
  const cdf = new Int32Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
  const cdfMin = cdf.find(v => v > 0) ?? 0;
  const total = w * h;

  // Equalization LUT
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(((cdf[i] - cdfMin) / (total - cdfMin + 1e-6)) * 255);
  }

  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const newLum = lut[lum];
    const scale = lum > 0 ? newLum / lum : 1;

    out[i * 4]     = Math.min(255, Math.round(r * scale));
    out[i * 4 + 1] = Math.min(255, Math.round(g * scale));
    out[i * 4 + 2] = Math.min(255, Math.round(b * scale));
    out[i * 4 + 3] = 255;
  }

  return out;
}
