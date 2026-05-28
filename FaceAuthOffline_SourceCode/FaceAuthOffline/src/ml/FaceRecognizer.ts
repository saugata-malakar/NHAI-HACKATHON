/**
 * FaceRecognizer
 * Extracts 512-d face embeddings using MobileFaceNet (INT8 quantized, ArcFace loss).
 *
 * Input:  112×112 RGB float32 tensor normalized to [-1, 1]   [1, 112, 112, 3]
 * Output: 512-d L2-normalized embedding vector               [1, 512]
 *
 * Model: MobileFaceNet trained on MS-Celeb-1M + additional Indian face data
 *        Post-training INT8 quantization → ~2 MB
 *        LFW accuracy: 99.28% (full) | ~98.6% (INT8)
 */

import { ModelLoader } from './ModelLoader';

export const EMBEDDING_DIM = 512;
export const RECOGNITION_THRESHOLD = 0.60; // cosine similarity; tune per deployment

/**
 * Extract a face embedding from a 112×112 face crop.
 * @param facePixels Float32Array [112*112*3], values in [-1, 1] (BGR or RGB depending on training)
 * @returns 512-d L2-normalized embedding
 */
export async function extractEmbedding(facePixels: Float32Array): Promise<Float32Array> {
  const model = ModelLoader.get('facenet');
  const outputs = await model.run([facePixels]);
  const raw = outputs[0] as Float32Array; // [512]
  return l2Normalize(raw);
}

/** L2 normalize a vector in-place */
export function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) + 1e-10;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Cosine similarity between two L2-normalized embeddings */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // Both are L2-normalized, so this is already cosine similarity
}

/**
 * Match a query embedding against a list of stored embeddings.
 * Returns the best match and its similarity score.
 */
export interface MatchResult {
  userId: string;
  userName: string;
  similarity: number;
  verified: boolean;
}

export function matchEmbedding(
  query: Float32Array,
  gallery: Array<{ userId: string; userName: string; embedding: Float32Array }>,
  threshold: number = RECOGNITION_THRESHOLD,
): MatchResult | null {
  if (!gallery.length) return null;

  let best: MatchResult | null = null;

  for (const entry of gallery) {
    const sim = cosineSimilarity(query, entry.embedding);
    if (!best || sim > best.similarity) {
      best = {
        userId: entry.userId,
        userName: entry.userName,
        similarity: sim,
        verified: sim >= threshold,
      };
    }
  }

  return best;
}

/**
 * Serialize embedding to base64 string for storage
 */
export function embeddingToBase64(embedding: Float32Array): string {
  const bytes = Buffer.from(embedding.buffer);
  return bytes.toString('base64');
}

/**
 * Deserialize embedding from base64 string
 */
export function embeddingFromBase64(b64: string): Float32Array {
  const bytes = Buffer.from(b64, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
