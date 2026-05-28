/**
 * FaceDB — Production-grade offline face enrollment database
 * Full Phase 1-7 implementation with migrations, AES-256-CBC,
 * chained ledger, LSH warm-up, chunked sync, retry queue, telemetry.
 */

import { open, OPSQLiteConnection } from '@op-engineering/op-sqlite';
import EncryptedStorage from 'react-native-encrypted-storage';
import { v4 as uuidv4 } from 'uuid';
import { Buffer } from 'buffer';
import Crypto from 'react-native-crypto';
import DeviceInfo from 'react-native-device-info';
import { embeddingToBase64, embeddingFromBase64 } from '../ml/FaceRecognizer';
import { LSHIndex } from '../ml/LSHIndex';
import { computeLogHash } from './LedgerVerifier';
import { runMigrations } from './migrations/runner';
import { EdgeLogger } from '../utils/EdgeLogger';

const DB_NAME             = 'faceauth.db';
const KEY_STORE_ID        = 'db_encryption_key';
const CHAIN_ANCHOR_KEY    = 'chain_anchor';
const SYNC_BATCH_SIZE     = 50;
const MAX_SYNC_ATTEMPTS   = 5;
const SYNC_RETRY_COOLDOWN = 24 * 60 * 60 * 1000;

let _cachedKey: Buffer | null = null;

async function getEncryptionKey(): Promise<Buffer> {
  if (_cachedKey) return _cachedKey;
  try {
    const stored = await EncryptedStorage.getItem(KEY_STORE_ID);
    if (stored) { _cachedKey = Buffer.from(stored, 'base64'); return _cachedKey; }
  } catch { /* fall through */ }
  const deviceId = await DeviceInfo.getUniqueId();
  const h = Crypto.createHash('sha256');
  h.update(deviceId, 'utf8');
  const keyBuf = Buffer.from(h.digest('hex'), 'hex');
  await EncryptedStorage.setItem(KEY_STORE_ID, keyBuf.toString('base64'));
  _cachedKey = keyBuf;
  return _cachedKey;
}

async function encryptEmbedding(b64: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv  = Buffer.from(Crypto.randomBytes(16));
  const c   = Crypto.createCipheriv('aes-256-cbc', key, iv);
  return iv.toString('base64') + ':' + c.update(b64, 'utf8', 'base64') + c.final('base64');
}

async function decryptEmbedding(enc: string): Promise<string> {
  const sep = enc.indexOf(':');
  if (sep === -1) throw new Error('[FaceDB] Bad ciphertext');
  const key = await getEncryptionKey();
  const iv  = Buffer.from(enc.slice(0, sep), 'base64');
  const d   = Crypto.createDecipheriv('aes-256-cbc', key, iv);
  return d.update(enc.slice(sep + 1), 'base64', 'utf8') + d.final('utf8');
}

export interface EnrollParams {
  userId: string; userName: string; department: string;
  embedding: Float32Array; deviceId: string; userRegistryId?: string;
}
export interface EnrollmentRecord {
  id: string; userId: string; userName: string; department: string;
  embedding: Float32Array; enrolledAt: number; synced: boolean; modelVersion: string;
}
export interface AuthLog {
  id: string; userId: string; timestamp: number; verified: boolean;
  similarity: number; livenessPassed: boolean;
  logHash: string; prevHash: string; synced: boolean; challenges: string;
}
export interface UserRecord {
  id: string; fullName: string; employeeId: string;
  department: string; designation: string; enrolledAt: number; active: boolean;
}
export interface TelemetryRow {
  blazefaceMs: number; facemeshMs: number; embeddingMs: number;
  antispoofMs: number; totalMs: number; result: string;
  similarity: number; challenges: string;
}

let db: OPSQLiteConnection | null = null;

export const FaceDB = {

  async init(): Promise<void> {
    db = open({ name: DB_NAME });
    await runMigrations(db);
    await getEncryptionKey();
    try {
      const gallery = await this.getAllEmbeddings();
      LSHIndex.build(gallery);
      EdgeLogger.sys(`[FaceDB] LSH built with ${gallery.length} entries`);
    } catch (e: any) { EdgeLogger.error(`[FaceDB] LSH build failed: ${e.message}`); }
    EdgeLogger.sys('[FaceDB] Initialized');
  },

  async upsertUser(u: UserRecord & { enrolledAt?: number }): Promise<void> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    await db.executeAsync(
      `INSERT OR REPLACE INTO users (id,full_name,employee_id,department,designation,enrolled_at,active)
       VALUES (?,?,?,?,?,?,?)`,
      [u.id, u.fullName, u.employeeId, u.department, u.designation,
       u.enrolledAt ?? Date.now(), u.active ? 1 : 0],
    );
  },

  async getUsers(activeOnly = false): Promise<UserRecord[]> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const sql = activeOnly
      ? `SELECT * FROM users WHERE active=1 ORDER BY full_name ASC`
      : `SELECT * FROM users ORDER BY full_name ASC`;
    const r = await db.executeAsync(sql);
    return (r.rows?._array ?? []).map((row: any): UserRecord => ({
      id: row.id, fullName: row.full_name, employeeId: row.employee_id,
      department: row.department, designation: row.designation,
      enrolledAt: row.enrolled_at, active: row.active === 1,
    }));
  },

  async searchUsers(query: string): Promise<UserRecord[]> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const q = `%${query.toLowerCase()}%`;
    const r = await db.executeAsync(
      `SELECT * FROM users WHERE lower(full_name) LIKE ? OR lower(employee_id) LIKE ? OR lower(department) LIKE ? ORDER BY full_name ASC`,
      [q, q, q],
    );
    return (r.rows?._array ?? []).map((row: any): UserRecord => ({
      id: row.id, fullName: row.full_name, employeeId: row.employee_id,
      department: row.department, designation: row.designation,
      enrolledAt: row.enrolled_at, active: row.active === 1,
    }));
  },

  async setUserActive(userId: string, active: boolean): Promise<void> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    await db.executeAsync(`UPDATE users SET active=? WHERE id=?`, [active ? 1 : 0, userId]);
    if (!active) LSHIndex.removeByUserId(userId);
  },

  async enrollFace(params: EnrollParams): Promise<string> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const id = uuidv4();
    const encryptedB64 = await encryptEmbedding(embeddingToBase64(params.embedding));
    await db.executeAsync(
      `INSERT OR REPLACE INTO enrollments
         (id,user_registry_id,user_id,user_name,department,embedding_b64,
          model_version,enrolled_at,synced,sync_attempts,last_sync_attempt,device_id)
       VALUES (?,?,?,?,?,?,'mobilefacenet_int8_v1',?,0,0,0,?)`,
      [id, params.userRegistryId ?? '', params.userId, params.userName,
       params.department, encryptedB64, Date.now(), params.deviceId],
    );
    LSHIndex.addEntry({ userId: params.userId, userName: params.userName, embedding: params.embedding });
    EdgeLogger.info(`[FaceDB] Enrolled ${params.userName}`);
    return id;
  },

  async getAllEmbeddings(): Promise<Array<{ userId: string; userName: string; embedding: Float32Array }>> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const r = await db.executeAsync(
      `SELECT e.user_id,e.user_name,e.embedding_b64
       FROM enrollments e LEFT JOIN users u ON e.user_registry_id=u.id
       WHERE u.active IS NULL OR u.active=1`,
    );
    return Promise.all((r.rows?._array ?? []).map(async (row: any) => ({
      userId: row.user_id, userName: row.user_name,
      embedding: embeddingFromBase64(await decryptEmbedding(row.embedding_b64)),
    })));
  },

  async logAuth(params: {
    userId: string; verified: boolean; similarity: number;
    livenessPassed: boolean; challenges?: string;
  }): Promise<void> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const prev = await db.executeAsync(
      `SELECT log_hash FROM auth_logs ORDER BY timestamp DESC LIMIT 1`
    );
    const prevHash: string = prev.rows?._array[0]?.log_hash ?? '';
    const id = uuidv4();
    const ts = Date.now();
    const logHash = computeLogHash(
      id, params.userId, ts, params.verified,
      params.similarity, params.livenessPassed, prevHash
    );
    await db.executeAsync(
      `INSERT INTO auth_logs
         (id,user_id,timestamp,verified,similarity,liveness_passed,
          liveness_challenges,log_hash,prev_hash,synced)
       VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [id, params.userId, ts, params.verified ? 1 : 0, params.similarity,
       params.livenessPassed ? 1 : 0, params.challenges ?? '', logHash, prevHash],
    );
  },

  async getAllLogs(limit = 200): Promise<AuthLog[]> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const r = await db.executeAsync(
      `SELECT * FROM auth_logs ORDER BY timestamp DESC LIMIT ?`, [limit]
    );
    return (r.rows?._array ?? []).map((row: any): AuthLog => ({
      id: row.id, userId: row.user_id, timestamp: row.timestamp,
      verified: row.verified === 1, similarity: row.similarity,
      livenessPassed: row.liveness_passed === 1,
      logHash: row.log_hash, prevHash: row.prev_hash,
      challenges: row.liveness_challenges ?? '',
      synced: row.synced === 1,
    }));
  },

  async getUnsyncedEnrollmentsBatch(offset: number): Promise<EnrollmentRecord[]> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const now = Date.now();
    const r = await db.executeAsync(
      `SELECT * FROM enrollments
       WHERE synced=0 AND sync_attempts<? AND (last_sync_attempt=0 OR last_sync_attempt<?)
       ORDER BY enrolled_at ASC LIMIT ? OFFSET ?`,
      [MAX_SYNC_ATTEMPTS, now - SYNC_RETRY_COOLDOWN, SYNC_BATCH_SIZE, offset],
    );
    return Promise.all((r.rows?._array ?? []).map(async (row: any): Promise<EnrollmentRecord> => ({
      id: row.id, userId: row.user_id, userName: row.user_name,
      department: row.department, modelVersion: row.model_version,
      embedding: embeddingFromBase64(await decryptEmbedding(row.embedding_b64)),
      enrolledAt: row.enrolled_at, synced: false,
    })));
  },

  async getUnsyncedLogs(): Promise<AuthLog[]> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const r = await db.executeAsync(
      `SELECT * FROM auth_logs WHERE synced=0 ORDER BY timestamp ASC`
    );
    return (r.rows?._array ?? []).map((row: any): AuthLog => ({
      id: row.id, userId: row.user_id, timestamp: row.timestamp,
      verified: row.verified === 1, similarity: row.similarity,
      livenessPassed: row.liveness_passed === 1,
      logHash: row.log_hash, prevHash: row.prev_hash,
      challenges: row.liveness_challenges ?? '', synced: false,
    }));
  },

  async incrementSyncAttempt(id: string): Promise<void> {
    if (!db) return;
    await db.executeAsync(
      `UPDATE enrollments SET sync_attempts=sync_attempts+1,last_sync_attempt=? WHERE id=?`,
      [Date.now(), id],
    );
  },

  async markSynced(table: 'enrollments' | 'auth_logs', ids: string[]): Promise<void> {
    if (!db || !ids.length) return;
    const ph = ids.map(() => '?').join(',');
    await db.executeAsync(`UPDATE ${table} SET synced=1 WHERE id IN (${ph})`, ids);
  },

  async resetStuckRecord(id: string): Promise<void> {
    if (!db) return;
    await db.executeAsync(
      `UPDATE enrollments SET sync_attempts=0,last_sync_attempt=0 WHERE id=?`, [id]
    );
  },

  async saveChainAnchor(hash: string): Promise<void> {
    if (!db) return;
    await db.executeAsync(
      `INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`, [CHAIN_ANCHOR_KEY, hash]
    );
  },

  async getChainAnchor(): Promise<string | null> {
    if (!db) return null;
    const r = await db.executeAsync(
      `SELECT value FROM settings WHERE key=?`, [CHAIN_ANCHOR_KEY]
    );
    return r.rows?._array[0]?.value ?? null;
  },

  async logTelemetry(row: TelemetryRow): Promise<void> {
    if (!db) return;
    try {
      await db.executeAsync(
        `INSERT INTO inference_telemetry
           (id,ts,blazeface_ms,facemesh_ms,embedding_ms,antispoof_ms,total_ms,result,similarity,challenges)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [uuidv4(), Date.now(), row.blazefaceMs, row.facemeshMs,
         row.embeddingMs, row.antispoofMs, row.totalMs,
         row.result, row.similarity, row.challenges],
      );
      await db.executeAsync(
        `DELETE FROM inference_telemetry WHERE id NOT IN
         (SELECT id FROM inference_telemetry ORDER BY ts DESC LIMIT 500)`
      );
    } catch (e: any) { EdgeLogger.error(`[FaceDB] Telemetry: ${e.message}`); }
  },

  async getTelemetryAverages(): Promise<{
    avgBlazefaceMs: number; avgFacemeshMs: number;
    avgEmbeddingMs: number; avgTotalMs: number;
  }> {
    if (!db) return { avgBlazefaceMs: 0, avgFacemeshMs: 0, avgEmbeddingMs: 0, avgTotalMs: 0 };
    const r = await db.executeAsync(
      `SELECT AVG(blazeface_ms) as bf,AVG(facemesh_ms) as fm,
              AVG(embedding_ms) as em,AVG(total_ms) as tot
       FROM (SELECT * FROM inference_telemetry ORDER BY ts DESC LIMIT 50)`
    );
    const row = r.rows?._array[0];
    return {
      avgBlazefaceMs: +(row?.bf ?? 0).toFixed(1),
      avgFacemeshMs:  +(row?.fm ?? 0).toFixed(1),
      avgEmbeddingMs: +(row?.em ?? 0).toFixed(1),
      avgTotalMs:     +(row?.tot ?? 0).toFixed(1),
    };
  },

  async purgeSynced(retentionDays = 7): Promise<{ enrollments: number; logs: number }> {
    if (!db) throw new Error('[FaceDB] Not initialized');
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const [e, l] = await Promise.all([
      db.executeAsync(`DELETE FROM enrollments WHERE synced=1 AND enrolled_at<?`, [cutoff]),
      db.executeAsync(`DELETE FROM auth_logs WHERE synced=1 AND timestamp<?`, [cutoff]),
    ]);
    return { enrollments: e.rowsAffected ?? 0, logs: l.rowsAffected ?? 0 };
  },

  async getStats(): Promise<{ totalEnrolled: number; pendingSync: number; totalLogs: number; stuckRecords: number }> {
    if (!db) return { totalEnrolled: 0, pendingSync: 0, totalLogs: 0, stuckRecords: 0 };
    const [e, p, l, stuck] = await Promise.all([
      db.executeAsync(`SELECT COUNT(*) as cnt FROM enrollments`),
      db.executeAsync(`SELECT COUNT(*) as cnt FROM enrollments WHERE synced=0`),
      db.executeAsync(`SELECT COUNT(*) as cnt FROM auth_logs`),
      db.executeAsync(`SELECT COUNT(*) as cnt FROM enrollments WHERE sync_attempts>=? AND synced=0`, [MAX_SYNC_ATTEMPTS]),
    ]);
    return {
      totalEnrolled: e.rows?._array[0]?.cnt ?? 0,
      pendingSync:   p.rows?._array[0]?.cnt ?? 0,
      totalLogs:     l.rows?._array[0]?.cnt ?? 0,
      stuckRecords:  stuck.rows?._array[0]?.cnt ?? 0,
    };
  },

  async setSetting(key: string, value: string): Promise<void> {
    if (!db) return;
    await db.executeAsync(
      `INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`, [key, value]
    );
  },

  async getSetting(key: string): Promise<string | null> {
    if (!db) return null;
    const r = await db.executeAsync(`SELECT value FROM settings WHERE key=?`, [key]);
    return r.rows?._array[0]?.value ?? null;
  },
};
