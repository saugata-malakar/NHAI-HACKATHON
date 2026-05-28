/**
 * LSHIndex
 * Locality Sensitive Hashing (LSH) Index for 512-d face embeddings.
 * Replaces O(n) linear scans of decrypted face database rows with a sub-linear bucket query.
 * Fast, 100% offline, and operates entirely in-memory.
 */

// Seeded PRNG for stable, reproducible hyperplanes across restarts
function createPRNG(seed: number) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const PRNG = createPRNG(42);
const BUCKET_COUNT = 64; // 64 random hyperplanes → 64-bit signatures
const DIM = 512;

// Generate deterministic random hyperplanes of 512-d using Box-Muller transform
const hyperplanes: Float32Array[] = [];
for (let i = 0; i < BUCKET_COUNT; i++) {
  const hp = new Float32Array(DIM);
  for (let j = 0; j < DIM; j++) {
    const u1 = PRNG() || 1e-10;
    const u2 = PRNG() || 1e-10;
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    hp[j] = z0;
  }
  hyperplanes.push(hp);
}

export interface LSHEntry {
  userId: string;
  userName: string;
  embedding: Float32Array;
}

// Local LSH in-memory bucket map
const index: Map<string, LSHEntry[]> = new Map();

/**
 * Compute the 64-bit signature of a 512-dimensional embedding
 */
function computeSignature(embedding: Float32Array): string {
  let sig = '';
  for (let i = 0; i < BUCKET_COUNT; i++) {
    let dot = 0;
    const hp = hyperplanes[i];
    for (let j = 0; j < DIM; j++) {
      dot += embedding[j] * hp[j];
    }
    sig += dot >= 0 ? '1' : '0';
  }
  return sig;
}

export const LSHIndex = {
  /**
   * Reset in-memory database index
   */
  clear(): void {
    index.clear();
  },

  /**
   * Build the LSH index from scratch
   */
  build(gallery: LSHEntry[]): void {
    index.clear();
    for (const entry of gallery) {
      this.addEntry(entry);
    }
  },

  /**
   * Incrementally add a single entry to the index without a full rebuild
   */
  addEntry(entry: LSHEntry): void {
    const sig = computeSignature(entry.embedding);
    if (!index.has(sig)) {
      index.set(sig, []);
    }
    // Clone Float32Array to protect LSH index from downstream memory scrubbing (scrubbers zero in-place)
    const entryCopy = {
      userId: entry.userId,
      userName: entry.userName,
      embedding: new Float32Array(entry.embedding),
    };
    index.get(sig)!.push(entryCopy);
  },

  /**
   * Retrieve candidate matches using multi-probe Hamming distance lookup
   */
  query(queryEmbedding: Float32Array, topK: number = 10): LSHEntry[] {
    const querySig = computeSignature(queryEmbedding);
    
    // Direct match bucket
    const directCandidates = index.get(querySig) || [];
    if (directCandidates.length >= topK) {
      return directCandidates.slice(0, topK);
    }

    // Retrieve nearest buckets sorting by Hamming distance (Multi-Probe LSH)
    const allBuckets = Array.from(index.keys());
    const bucketDistances: Array<{ bucket: string; dist: number }> = [];

    for (const bucket of allBuckets) {
      if (bucket === querySig) continue;
      let dist = 0;
      for (let i = 0; i < BUCKET_COUNT; i++) {
        if (bucket[i] !== querySig[i]) dist++;
      }
      bucketDistances.push({ bucket, dist });
    }

    // Sort by Hamming distance
    bucketDistances.sort((a, b) => a.dist - b.dist);

    const mergedCandidates = [...directCandidates];
    for (const item of bucketDistances) {
      if (mergedCandidates.length >= topK * 3) break; // Limit candidates ceiling
      const bucketEntries = index.get(item.bucket) || [];
      mergedCandidates.push(...bucketEntries);
    }

    return mergedCandidates.slice(0, topK * 2);
  }
};
