/**
 * LedgerVerifier
 *
 * Write-time: every logAuth() call computes and stores
 *   SHA-256(id | userId | timestamp | verified | similarity | livenessPassed | prevHash)
 *
 * Read-time: verifyChain() re-computes the full chain and flags any broken link.
 *
 * Sync-time: refuseToSyncBrokenChain() prevents uploading a tampered ledger to AWS.
 *
 * Chain anchor: after each successful sync the tail hash is stored as
 * { key: 'chain_anchor', value: <hash> } in the settings table so the
 * next sync can verify continuity from the server perspective.
 */

import Crypto from 'react-native-crypto';

export interface LogRow {
  id: string;
  userId: string;
  timestamp: number;
  verified: boolean;
  similarity: number;
  livenessPassed: boolean;
  livnessChallenges?: string;
  logHash: string;
  prevHash: string;
}

export interface ChainVerifyResult {
  valid: boolean;
  totalRows: number;
  firstBreakId: string | null;
  firstBreakIndex: number | null;
  checkedAt: number;
}

export function computeLogHash(
  id: string,
  userId: string,
  timestamp: number,
  verified: boolean,
  similarity: number,
  livenessPassed: boolean,
  prevHash: string,
): string {
  const payload = [
    id,
    userId,
    String(timestamp),
    verified ? '1' : '0',
    similarity.toFixed(6),
    livenessPassed ? '1' : '0',
    prevHash,
  ].join('|');

  const hash = Crypto.createHash('sha256');
  hash.update(payload, 'utf8');
  return hash.digest('hex');
}

export function verifyChain(rows: LogRow[]): ChainVerifyResult {
  if (rows.length === 0) {
    return { valid: true, totalRows: 0, firstBreakId: null, firstBreakIndex: null, checkedAt: Date.now() };
  }

  // rows must be ordered by timestamp ASC
  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const expectedPrevHash = i === 0 ? '' : sorted[i - 1].logHash;

    // Verify prev_hash pointer
    if (row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalRows: rows.length,
        firstBreakId: row.id,
        firstBreakIndex: i,
        checkedAt: Date.now(),
      };
    }

    // Re-compute this row's hash
    const recomputed = computeLogHash(
      row.id,
      row.userId,
      row.timestamp,
      row.verified,
      row.similarity,
      row.livenessPassed,
      row.prevHash,
    );

    if (recomputed !== row.logHash) {
      return {
        valid: false,
        totalRows: rows.length,
        firstBreakId: row.id,
        firstBreakIndex: i,
        checkedAt: Date.now(),
      };
    }
  }

  return {
    valid: true,
    totalRows: rows.length,
    firstBreakId: null,
    firstBreakIndex: null,
    checkedAt: Date.now(),
  };
}

/** Simulates tamper on a row for the dev Tamper Lab (never call in production) */
export function simulateTamper(rows: LogRow[], targetIndex: number): LogRow[] {
  if (targetIndex < 0 || targetIndex >= rows.length) return rows;
  const copy = rows.map(r => ({ ...r }));
  copy[targetIndex] = {
    ...copy[targetIndex],
    similarity: copy[targetIndex].similarity + 0.05, // mutate data
    // logHash intentionally NOT updated — this is what tamper detection catches
  };
  return copy;
}
