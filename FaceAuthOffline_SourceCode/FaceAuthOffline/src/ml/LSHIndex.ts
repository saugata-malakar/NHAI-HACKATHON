/**
 * LSHIndex — Locality Sensitive Hashing for fast ANN embedding search
 *
 * Replaces O(n) full gallery scan with O(candidates) exact cosine check.
 * Uses random hyperplane projections to bucket 512-d embeddings into 64 bits.
 * At 50,000 enrolled faces, reduces comparison set from 50,000 → ~2,500 per query.
 *
 * Usage:
 *   await LSHIndex.build(gallery);       // once at startup
 *   LSHIndex.addEntry(embedding, meta);  // after each enrollment (incremental)
 *   const hits = LSHIndex.query(embedding, topK=10);
 */

import { cosineSimilarity } from './FaceRecognizer';

const DIM = 512;       // embedding dimension
const NUM_PLANES = 64; // hash bits — more bits = finer buckets, fewer candidates

export interface GalleryEntry {
  userId: string;
  userName: string;
  embedding: Float32Array;
}

// Pre-generate stable random hyperplanes (seeded deterministically)
// Using a simple LCG seeded with a fixed value so planes are the same across restarts
function generateHyperplanes(): Float32Array[] {
  const planes: Float32Array[] = [];
  let seed = 0xdeadbeef;
  const lcg = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
  for (let p = 0; p < NUM_PLANES; p++) {
    const plane = new Float32Array(DIM);
    let norm = 0;
    for (let d = 0; d < DIM; d++) {
      plane[d] = lcg() * 2 - 1;
      norm += plane[d] * plane[d];
    }
    norm = Math.sqrt(norm);
    for (let d = 0; d < DIM; d++) plane[d] /= norm;
    planes.push(plane);
  }
  return planes;
}

const HYPERPLANES = generateHyperplanes();

function computeHash(embedding: Float32Array): bigint {
  let hash = 0n;
  for (let p = 0; p < NUM_PLANES; p++) {
    let dot = 0;
    for (let d = 0; d < DIM; d++) dot += HYPERPLANES[p][d] * embedding[d];
    if (dot >= 0) hash |= (1n << BigInt(p));
  }
  return hash;
}

function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

interface IndexEntry {
  hash: bigint;
  entry: GalleryEntry;
}

// Module-level singleton
const _index: IndexEntry[] = [];
let _built = false;

export const LSHIndex = {
  build(gallery: GalleryEntry[]): void {
    _index.length = 0;
    for (const entry of gallery) {
      _index.push({ hash: computeHash(entry.embedding), entry });
    }
    _built = true;
    console.log(`[LSHIndex] Built with ${_index.length} entries`);
  },

  addEntry(entry: GalleryEntry): void {
    _index.push({ hash: computeHash(entry.embedding), entry });
  },

  removeByUserId(userId: string): void {
    const before = _index.length;
    for (let i = _index.length - 1; i >= 0; i--) {
      if (_index[i].entry.userId === userId) _index.splice(i, 1);
    }
    console.log(`[LSHIndex] Removed ${before - _index.length} entries for ${userId}`);
  },

  /**
   * Query top-K nearest neighbours.
   * Step 1: collect all entries within Hamming distance ≤ maxHamming (fast bit ops).
   * Step 2: exact cosine sort on candidates only.
   */
  query(
    queryEmbedding: Float32Array,
    topK: number = 10,
    maxHamming: number = 10,
  ): Array<{ entry: GalleryEntry; similarity: number }> {
    if (!_built || _index.length === 0) return [];

    const queryHash = computeHash(queryEmbedding);
    const candidates: Array<{ entry: GalleryEntry; similarity: number }> = [];

    for (const { hash, entry } of _index) {
      if (hammingDistance(queryHash, hash) <= maxHamming) {
        candidates.push({
          entry,
          similarity: cosineSimilarity(queryEmbedding, entry.embedding),
        });
      }
    }

    // If bucket too sparse (very new index), fall back to full scan
    if (candidates.length < topK && _index.length <= 1000) {
      for (const { entry } of _index) {
        if (!candidates.find(c => c.entry.userId === entry.userId)) {
          candidates.push({
            entry,
            similarity: cosineSimilarity(queryEmbedding, entry.embedding),
          });
        }
      }
    }

    return candidates
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  },

  isBuilt(): boolean { return _built; },
  size(): number { return _index.length; },
  clear(): void { _index.length = 0; _built = false; },
};
