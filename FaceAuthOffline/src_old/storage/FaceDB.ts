/**
 * FaceDB
 * Offline-first SQLite database for face enrollment records.
 *
 * Schema:
 *   enrollments(id TEXT PK, user_id TEXT, user_name TEXT, department TEXT,
 *               embedding BLOB, enrolled_at INTEGER, synced INTEGER, device_id TEXT)
 *   auth_logs(id TEXT PK, user_id TEXT, timestamp INTEGER, verified INTEGER,
 *             similarity REAL, liveness_passed INTEGER, synced INTEGER)
 *
 * Embeddings are AES-256-CBC encrypted before storage.
 * Key is derived from device ANDROID_ID / identifierForVendor (stored in EncryptedStorage).
 */

import { open, DB } from '@op-engineering/op-sqlite';
import EncryptedStorage from 'react-native-encrypted-storage';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import { embeddingToBase64, embeddingFromBase64 } from '../ml/FaceRecognizer';
import { MIGRATIONS } from './migrations';

const DB_NAME = 'faceauth.db';

interface EnrollmentRecord {
  id: string;
  userId: string;
  userName: string;
  department: string;
  embedding: Float32Array;
  enrolledAt: number;
  synced: boolean;
}

interface AuthLog {
  id: string;
  userId: string;
  timestamp: number;
  verified: boolean;
  similarity: number;
  livenessPassesed: boolean;
  synced: boolean;
  hash: string;
  prevHash: string;
}

let db: DB | null = null;
let cachedKey: Buffer | null = null;

/**
 * Retrieve or generate the AES-256 key derived from device hardware ID.
 * Persisted in react-native-encrypted-storage for local sandboxed isolation.
 */
async function getEncryptionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  try {
    const storedHex = await EncryptedStorage.getItem('db_encryption_key');
    if (storedHex) {
      cachedKey = Buffer.from(storedHex, 'hex');
      return cachedKey;
    }
  } catch (err) {
    console.warn('[FaceDB] Failed to read key from EncryptedStorage:', err);
  }

  // Derive key from device hardware ID
  let deviceId = 'default-fallback-device-id';
  try {
    const DeviceInfo = require('react-native-device-info');
    deviceId = await DeviceInfo.getUniqueId();
  } catch (e) {
    console.warn('[FaceDB] DeviceInfo unique ID not available, using fallback:', e);
  }

  // Generate 256-bit key from device ID using SHA-256
  const hash = crypto.createHash('sha256');
  hash.update(deviceId);
  const key = hash.digest();

  try {
    await EncryptedStorage.setItem('db_encryption_key', key.toString('hex'));
  } catch (err) {
    console.error('[FaceDB] Failed to save key to EncryptedStorage:', err);
  }

  cachedKey = key;
  return key;
}

/**
 * Encrypt a base64 string using AES-256-CBC
 */
async function encryptEmbedding(embeddingB64: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  let encrypted = cipher.update(embeddingB64, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  return iv.toString('base64') + ':' + encrypted;
}

/**
 * Decrypt an AES-256-CBC encrypted string
 */
async function decryptEmbedding(encryptedStr: string): Promise<string> {
  const key = await getEncryptionKey();
  const parts = encryptedStr.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted embedding format');
  }
  
  const iv = Buffer.from(parts[0], 'base64');
  const ciphertext = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Zeroes out a sensitive Float32Array in memory to prevent RAM dump leaks.
 */
export function secureZeroMemory(array: Float32Array | null | undefined): void {
  if (array) {
    array.fill(0);
  }
}

export const FaceDB = {
  async init(): Promise<void> {
    db = open({ name: DB_NAME });

    // 1. Create migration schema tracking table
    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    // 2. Fetch last applied migration version
    let currentVersion = 0;
    try {
      const res = await db.executeAsync(`SELECT MAX(version) as max_ver FROM schema_version`);
      currentVersion = res.rows?._array[0]?.max_ver ?? 0;
    } catch {
      currentVersion = 0;
    }

    // 3. Run unapplied migrations sequentially in transaction
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        console.log(`[FaceDB] Applying database migration version ${migration.version}: ${migration.name}`);
        await db.transaction(async (tx) => {
          await migration.run(tx as unknown as DB);
          await tx.executeAsync(`
            INSERT INTO schema_version (version, applied_at)
            VALUES (?, ?)
          `, [migration.version, Date.now()]);
        });
        console.log(`[FaceDB] Migration version ${migration.version} successfully applied.`);
      }
    }
  },

  async enrollFace(params: {
    userId: string;
    userName: string;
    department: string;
    embedding: Float32Array;
    deviceId: string;
    userRegistryId?: string;
  }): Promise<string> {
    if (!db) throw new Error('DB not initialized');

    let registryId = params.userRegistryId;
    if (!registryId) {
      const userRes = await db.executeAsync(`SELECT id FROM users WHERE employee_id = ?`, [params.userId]);
      if (userRes.rows?._array && userRes.rows._array.length > 0) {
        registryId = userRes.rows._array[0].id;
        await db.executeAsync(`UPDATE users SET active = 1 WHERE id = ?`, [registryId]);
      } else {
        registryId = uuidv4();
        await db.executeAsync(
          `INSERT INTO users (id, full_name, employee_id, department, designation, photo_uri, enrolled_at, active)
           VALUES (?, ?, ?, ?, '', '', ?, 1)`,
          [registryId, params.userName, params.userId, params.department, Date.now()]
        );
      }
    }

    const id = uuidv4();
    const embeddingB64 = embeddingToBase64(params.embedding);
    const encryptedB64 = await encryptEmbedding(embeddingB64);

    await db.executeAsync(
      `INSERT OR REPLACE INTO enrollments
         (id, user_id, user_name, department, embedding_b64, enrolled_at, synced, device_id, user_registry_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, params.userId, params.userName, params.department,
       encryptedB64, Date.now(), params.deviceId, registryId],
    );

    // Secure memory scrubbing: clear original embedding
    secureZeroMemory(params.embedding);

    return id;
  },

  async enrollFaceSyncDown(params: {
    id: string;
    userId: string;
    userName: string;
    department: string;
    embedding: Float32Array;
    deviceId: string;
    userRegistryId: string;
    enrolledAt: number;
  }): Promise<void> {
    if (!db) throw new Error('DB not initialized');

    // Create user in registry if not exists
    const userRes = await db.executeAsync(`SELECT id FROM users WHERE id = ?`, [params.userRegistryId]);
    if (!userRes.rows?._array || userRes.rows._array.length === 0) {
      await db.executeAsync(
        `INSERT INTO users (id, full_name, employee_id, department, designation, photo_uri, enrolled_at, active)
         VALUES (?, ?, ?, ?, '', '', ?, 1)`,
        [params.userRegistryId, params.userName, params.userId, params.department, params.enrolledAt]
      );
    }

    const embeddingB64 = embeddingToBase64(params.embedding);
    const encryptedB64 = await encryptEmbedding(embeddingB64);

    await db.executeAsync(
      `INSERT OR REPLACE INTO enrollments
         (id, user_id, user_name, department, embedding_b64, enrolled_at, synced, device_id, user_registry_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [params.id, params.userId, params.userName, params.department,
       encryptedB64, params.enrolledAt, params.deviceId, params.userRegistryId],
    );

    // Dynamic addition to in-memory LSH Index
    const { LSHIndex } = require('../ml/LSHIndex');
    LSHIndex.addEntry(params.userId, params.embedding);

    // Secure memory scrubbing: clear original embedding
    secureZeroMemory(params.embedding);
  },

  async getAllEmbeddings(): Promise<Array<{
    userId: string;
    userName: string;
    embedding: Float32Array;
  }>> {
    if (!db) throw new Error('DB not initialized');

    const result = await db.executeAsync(
      `SELECT e.user_id, e.user_name, e.embedding_b64 
       FROM enrollments e
       LEFT JOIN users u ON e.user_registry_id = u.id
       WHERE u.active IS NULL OR u.active = 1`,
    );

    const rows = result.rows?._array ?? [];
    return Promise.all(
      rows.map(async (row: any) => {
        try {
          const decryptedB64 = await decryptEmbedding(row.embedding_b64);
          return {
            userId: row.user_id,
            userName: row.user_name,
            embedding: embeddingFromBase64(decryptedB64),
          };
        } catch (err) {
          console.error(`[FaceDB] Failed to decrypt embedding for user ${row.user_id}:`, err);
          return {
            userId: row.user_id,
            userName: row.user_name,
            embedding: new Float32Array(512),
          };
        }
      })
    );
  },

  async getLastLogHash(): Promise<string> {
    if (!db) return '';
    try {
      const result = await db.executeAsync(
        `SELECT log_hash FROM auth_logs ORDER BY timestamp DESC LIMIT 1`
      );
      return result.rows?._array[0]?.log_hash ?? '';
    } catch {
      return '';
    }
  },

  async logAuth(params: {
    userId: string;
    verified: boolean;
    similarity: number;
    livenessPassed: boolean;
  }): Promise<void> {
    if (!db) throw new Error('DB not initialized');

    const id = uuidv4();
    const timestamp = Date.now();
    const verifiedInt = params.verified ? 1 : 0;
    const similarityVal = params.similarity;
    const livenessInt = params.livenessPassed ? 1 : 0;

    const prevHash = await this.getLastLogHash();
    
    // Cryptographic Chain Link Formula: SHA-256(id + userId + timestamp + verified + similarity + livenessPassed + prevHash)
    const hashInput = `${id}${params.userId}${timestamp}${verifiedInt}${similarityVal.toFixed(4)}${livenessInt}${prevHash}`;
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    await db.executeAsync(
      `INSERT INTO auth_logs (id, user_id, timestamp, verified, similarity, liveness_passed, synced, hash, prev_hash, log_hash)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [id, params.userId, timestamp, verifiedInt, similarityVal, livenessInt, hash, prevHash, hash],
    );
  },

  async getUnsyncedEnrollments(): Promise<EnrollmentRecord[]> {
    return this.getUnsyncedEnrollmentsBatch(10000); // Backwards compatibility fallback
  },

  async getUnsyncedEnrollmentsBatch(limit: number = 50): Promise<EnrollmentRecord[]> {
    if (!db) throw new Error('DB not initialized');

    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const result = await db.executeAsync(
      `SELECT * FROM enrollments 
       WHERE synced = 0 AND (sync_attempts < 5 OR last_sync_attempt < ?)
       LIMIT ?`,
      [cutoff24h, limit]
    );

    const rows = result.rows?._array ?? [];
    return Promise.all(
      rows.map(async (row: any) => {
        try {
          const decryptedB64 = await decryptEmbedding(row.embedding_b64);
          return {
            id: row.id,
            userId: row.user_id,
            userName: row.user_name,
            department: row.department,
            embedding: embeddingFromBase64(decryptedB64),
            enrolledAt: row.enrolled_at,
            synced: row.synced === 1,
          };
        } catch (err) {
          console.error(`[FaceDB] Failed to decrypt unsynced embedding:`, err);
          return {
            id: row.id,
            userId: row.user_id,
            userName: row.user_name,
            department: row.department,
            embedding: new Float32Array(512),
            enrolledAt: row.enrolled_at,
            synced: row.synced === 1,
          };
        }
      })
    );
  },

  async getUnsyncedLogs(): Promise<AuthLog[]> {
    return this.getUnsyncedLogsBatch(10000); // Backwards compatibility fallback
  },

  async getUnsyncedLogsBatch(limit: number = 50): Promise<AuthLog[]> {
    if (!db) throw new Error('DB not initialized');

    const result = await db.executeAsync(
      `SELECT * FROM auth_logs WHERE synced = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );

    return (result.rows?._array ?? []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      timestamp: row.timestamp,
      verified: row.verified === 1,
      similarity: row.similarity,
      livenessPassesed: row.liveness_passed === 1,
      synced: row.synced === 1,
      hash: row.hash,
      prevHash: row.prev_hash ?? '',
    }));
  },

  async markSynced(table: 'enrollments' | 'auth_logs', ids: string[]): Promise<void> {
    if (!db || !ids.length) return;

    const placeholders = ids.map(() => '?').join(',');
    await db.executeAsync(
      `UPDATE ${table} SET synced = 1 WHERE id IN (${placeholders})`,
      ids,
    );
  },

  /** Purge synced records older than retentionDays (default 7) */
  async purgeSynced(retentionDays: number = 7): Promise<{ enrollments: number; logs: number }> {
    if (!db) throw new Error('DB not initialized');

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const e = await db.executeAsync(
      `DELETE FROM enrollments WHERE synced = 1 AND enrolled_at < ?`, [cutoff],
    );
    const l = await db.executeAsync(
      `DELETE FROM auth_logs WHERE synced = 1 AND timestamp < ?`, [cutoff],
    );

    return {
      enrollments: e.rowsAffected ?? 0,
      logs: l.rowsAffected ?? 0,
    };
  },

  async getStats(): Promise<{ totalEnrolled: number; pendingSync: number; totalLogs: number }> {
    if (!db) return { totalEnrolled: 0, pendingSync: 0, totalLogs: 0 };

    const [e, p, l] = await Promise.all([
      db.executeAsync(`SELECT COUNT(*) as cnt FROM enrollments`),
      db.executeAsync(`SELECT COUNT(*) as cnt FROM enrollments WHERE synced = 0`),
      db.executeAsync(`SELECT COUNT(*) as cnt FROM auth_logs`),
    ]);

    return {
      totalEnrolled: e.rows?._array[0]?.cnt ?? 0,
      pendingSync: p.rows?._array[0]?.cnt ?? 0,
      totalLogs: l.rows?._array[0]?.cnt ?? 0,
    };
  },

  async getAdminPinHash(): Promise<string | null> {
    if (!db) return null;
    const res = await db.executeAsync(`SELECT admin_pin_hash FROM settings LIMIT 1`);
    return res.rows?._array[0]?.admin_pin_hash ?? null;
  },

  async setAdminPinHash(hash: string): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    await db.executeAsync(`DELETE FROM settings`);
    await db.executeAsync(`INSERT INTO settings (admin_pin_hash, admin_set_at) VALUES (?, ?)`, [hash, Date.now()]);
  },

  async createUser(params: {
    id: string;
    fullName: string;
    employeeId: string;
    department?: string;
    designation?: string;
    photoUri?: string;
  }): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    await db.executeAsync(
      `INSERT OR REPLACE INTO users (id, full_name, employee_id, department, designation, photo_uri, enrolled_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        params.id,
        params.fullName,
        params.employeeId,
        params.department ?? '',
        params.designation ?? '',
        params.photoUri ?? '',
        Date.now(),
      ]
    );
  },

  async updateUserStatus(id: string, active: boolean): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    await db.executeAsync(
      `UPDATE users SET active = ? WHERE id = ?`,
      [active ? 1 : 0, id]
    );
  },

  async searchUsers(query: string): Promise<any[]> {
    if (!db) return [];
    const sql = query.trim()
      ? `SELECT * FROM users WHERE full_name LIKE ? OR employee_id LIKE ? ORDER BY enrolled_at DESC`
      : `SELECT * FROM users ORDER BY enrolled_at DESC`;
    const params = query.trim() ? [`%${query}%`, `%${query}%`] : [];
    const res = await db.executeAsync(sql, params);
    return res.rows?._array ?? [];
  },

  async getUserDetail(id: string): Promise<any> {
    if (!db) return null;
    const userRes = await db.executeAsync(`SELECT * FROM users WHERE id = ?`, [id]);
    const user = userRes.rows?._array[0] ?? null;
    if (!user) return null;

    // Fetch historical auth logs
    const logsRes = await db.executeAsync(`SELECT * FROM auth_logs WHERE user_id = ? ORDER BY timestamp DESC`, [user.employee_id]);
    const logs = logsRes.rows?._array ?? [];

    return {
      ...user,
      active: user.active === 1,
      logs: logs.map((l: any) => ({
        ...l,
        verified: l.verified === 1,
      })),
    };
  },

  async deleteUserBiometrics(id: string): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    // Deletes face embedding templates from SQLite but preserves registry entries and logs
    await db.executeAsync(`DELETE FROM enrollments WHERE user_registry_id = ? OR user_id = (SELECT employee_id FROM users WHERE id = ?)`, [id, id]);
    await db.executeAsync(`UPDATE users SET active = 0 WHERE id = ?`, [id]);
  },

  async getRawLogs(): Promise<any[]> {
    if (!db) throw new Error('DB not initialized');
    const res = await db.executeAsync(`SELECT * FROM auth_logs ORDER BY timestamp ASC`);
    return res.rows?._array ?? [];
  },

  async tamperLogForDev(id: string, corruptedSimilarity: number): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    await db.executeAsync(`UPDATE auth_logs SET similarity = ? WHERE id = ?`, [corruptedSimilarity, id]);
  },

  async getDeviceId(): Promise<string> {
    let deviceId = await EncryptedStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = uuidv4();
      await EncryptedStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  },

  async incrementSyncAttempts(id: string, errorMessage: string): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    await db.executeAsync(
      `UPDATE enrollments 
       SET sync_attempts = sync_attempts + 1, 
           last_sync_attempt = ?, 
           sync_error = ? 
       WHERE id = ?`,
      [Date.now(), errorMessage, id]
    );
  },

  async resetSyncAttempts(id: string): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    await db.executeAsync(
      `UPDATE enrollments SET sync_attempts = 0, last_sync_attempt = 0, sync_error = '' WHERE id = ?`,
      [id]
    );
  },

  async getStuckEnrollments(): Promise<any[]> {
    if (!db) return [];
    const res = await db.executeAsync(
      `SELECT * FROM enrollments WHERE synced = 0 AND sync_attempts >= 5`
    );
    return res.rows?._array ?? [];
  },

  async logTelemetry(params: {
    event: string;
    blazeface_ms: number;
    facemesh_ms: number;
    embedding_ms: number;
    antispoof_ms: number;
    total_ms: number;
    result: string;
    similarity: number;
    liveness_challenges: string[];
  }): Promise<void> {
    if (!db) throw new Error('DB not initialized');
    const id = uuidv4();
    await db.executeAsync(
      `INSERT INTO inference_telemetry 
         (id, event, blazeface_ms, facemesh_ms, embedding_ms, antispoof_ms, total_ms, result, similarity, liveness_challenges, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.event,
        params.blazeface_ms,
        params.facemesh_ms,
        params.embedding_ms,
        params.antispoof_ms,
        params.total_ms,
        params.result,
        params.similarity,
        JSON.stringify(params.liveness_challenges),
        Date.now()
      ]
    );
  },

  async getRollingTelemetry(limit: number = 50): Promise<any[]> {
    if (!db) return [];
    const res = await db.executeAsync(
      `SELECT * FROM inference_telemetry ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    return res.rows?._array ?? [];
  },
};
