import crypto from 'crypto';
import { FaceDB } from './FaceDB';

export interface VerificationResult {
  valid: boolean;
  firstBreak: string | null;
  logs: any[];
}

export const LedgerVerifier = {
  async verifyChain(): Promise<VerificationResult> {
    try {
      const logs = await FaceDB.getRawLogs();
      if (logs.length === 0) {
        return { valid: true, firstBreak: null, logs: [] };
      }

      let expectedPrevHash = '';
      
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        
        // Ensure values are numbers for hashing matching FaceDB schema
        const verifiedInt = log.verified === 1 || log.verified === true ? 1 : 0;
        const livenessInt = log.liveness_passed === 1 || log.liveness_passed === true ? 1 : 0;
        const similarityVal = typeof log.similarity === 'number' ? log.similarity : parseFloat(log.similarity) || 0;
        const prevHashVal = log.prev_hash || '';

        // Cryptographic link formula: SHA-256(id + user_id + timestamp + verified + similarity + liveness_passed + prev_hash)
        const hashInput = `${log.id}${log.user_id}${log.timestamp}${verifiedInt}${similarityVal.toFixed(4)}${livenessInt}${prevHashVal}`;
        const recomputedHash = crypto.createHash('sha256').update(hashInput).digest('hex');

        // 1. Data Tampering Check (Value Manipulation)
        // Check log_hash column if exists/set, fallback to hash
        const storedHash = log.log_hash || log.hash;
        if (storedHash !== recomputedHash) {
          console.warn(`[LedgerVerifier] Signature mismatch at log ${log.id}. Stored: ${storedHash}, Computed: ${recomputedHash}`);
          return { valid: false, firstBreak: log.id, logs };
        }

        // 2. Chain Disruption Check (Log Deletions / Swaps)
        if (i > 0) {
          const prevStoredHash = logs[i - 1].log_hash || logs[i - 1].hash;
          if (prevHashVal !== prevStoredHash) {
            console.warn(`[LedgerVerifier] Chain broken at log ${log.id}. expected prev_hash: ${prevStoredHash}, actual: ${prevHashVal}`);
            return { valid: false, firstBreak: log.id, logs };
          }
        }
      }

      return { valid: true, firstBreak: null, logs };
    } catch (err) {
      console.error('[LedgerVerifier] Error during chain verification:', err);
      return { valid: false, firstBreak: 'error', logs: [] };
    }
  }
};
