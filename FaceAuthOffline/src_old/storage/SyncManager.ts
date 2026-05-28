/**
 * SyncManager
 * Monitors network connectivity and syncs local records to AWS when online.
 *
 * Sync pipeline:
 *  1. NetInfo detects connectivity restored
 *  2. Pull unsynced enrollments + auth logs from SQLite
 *  3. Upload enrollments → AWS S3 (embeddings) + DynamoDB (metadata)
 *  4. Upload auth logs → DynamoDB
 *  5. Mark records as synced in SQLite
 *  6. Purge synced records older than retention window (default 7 days)
 *
 * AWS config is loaded from EncryptedStorage (set during initial device setup).
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import EncryptedStorage from 'react-native-encrypted-storage';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand, BatchWriteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import crypto from 'crypto';
import { FaceDB, secureZeroMemory } from './FaceDB';
import { embeddingToBase64 } from '../ml/FaceRecognizer';
import { LedgerVerifier } from './LedgerVerifier';
import BackgroundJob from 'react-native-background-actions';

interface AWSConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  s3Bucket: string;
  dynamoEnrollmentsTable: string;
  dynamoLogsTable: string;
}

const SYNC_COOLDOWN_MS = 30_000; // Don't sync more often than every 30 seconds
let lastSyncAt = 0;
let unsubscribe: (() => void) | null = null;
let isSyncing = false;

const syncStatus = {
  lastAttempt: 0,
  lastSuccess: 0,
  lastError: '',
  pendingCount: 0,
};

async function loadAWSConfig(): Promise<AWSConfig | null> {
  try {
    const raw = await EncryptedStorage.getItem('aws_config');
    return raw ? (JSON.parse(raw) as AWSConfig) : null;
  } catch {
    return null;
  }
}

/** Store AWS config securely on device */
export async function saveAWSConfig(config: AWSConfig): Promise<void> {
  await EncryptedStorage.setItem('aws_config', JSON.stringify(config));
}

let retryAttempt = 0;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;
let syncTimeoutId: NodeJS.Timeout | null = null;

async function forceSync(): Promise<void> {
  lastSyncAt = 0; // bypass cooldown check
  await doSync(true);
}

async function doSync(bypassCooldown = false): Promise<void> {
  if (isSyncing) return;
  const now = Date.now();
  if (!bypassCooldown && (now - lastSyncAt < SYNC_COOLDOWN_MS)) return;

  const config = await loadAWSConfig();
  if (!config) {
    syncStatus.lastError = 'AWS config not configured';
    return;
  }

  isSyncing = true;
  lastSyncAt = now;
  syncStatus.lastAttempt = now;

  try {
    // 1. Enforce Cryptographic Ledger Verification Check (Phase 3.2)
    const verification = await LedgerVerifier.verifyChain();
    if (!verification.valid) {
      throw new Error(`Sync aborted: local cryptographic ledger is compromised at record ${verification.firstBreak}!`);
    }

    const deviceId = await FaceDB.getDeviceId();

    const s3 = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    const dynamo = new DynamoDBClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    // ─── Sync enrollments batch-by-batch (Cursor Loop) ──────────────────────
    let totalEnrollmentsSynced = 0;
    let enrollmentsBatch = await FaceDB.getUnsyncedEnrollmentsBatch(50);

    while (enrollmentsBatch.length > 0) {
      console.log(`[SyncManager] Syncing batch of ${enrollmentsBatch.length} enrollments...`);
      const syncedIds: string[] = [];

      for (const enroll of enrollmentsBatch) {
        try {
          // Upload embedding binary to S3
          const s3Key = `embeddings/${enroll.userId}/${enroll.id}.bin`;
          const embeddingBytes = Buffer.from(enroll.embedding.buffer);

          await s3.send(new PutObjectCommand({
            Bucket: config.s3Bucket,
            Key: s3Key,
            Body: embeddingBytes,
            ContentType: 'application/octet-stream',
            ServerSideEncryption: 'aws:kms',
            Metadata: {
              'device-id': deviceId
            }
          }));

          // Secure memory scrubbing: clear Float32Array embedding immediately after S3 upload
          secureZeroMemory(enroll.embedding);

          // Write metadata to DynamoDB
          await dynamo.send(new PutItemCommand({
            TableName: config.dynamoEnrollmentsTable,
            Item: {
              id:           { S: enroll.id },
              user_id:      { S: enroll.userId },
              user_name:    { S: enroll.userName },
              department:   { S: enroll.department },
              s3_key:       { S: s3Key },
              enrolled_at:  { N: String(enroll.enrolledAt) },
              synced_at:    { N: String(Date.now()) },
              device_id:    { S: deviceId }
            },
          }));

          syncedIds.push(enroll.id);

          // Reset sync attempts on success
          await FaceDB.resetSyncAttempts(enroll.id);
        } catch (err: any) {
          console.error(`[SyncManager] Failed to upload enrollment ${enroll.id}:`, err);
          await FaceDB.incrementSyncAttempts(enroll.id, err?.message || 'Upload failed');
        }
      }

      await FaceDB.markSynced('enrollments', syncedIds);
      totalEnrollmentsSynced += syncedIds.length;
      
      // Load next batch cursor page
      enrollmentsBatch = await FaceDB.getUnsyncedEnrollmentsBatch(50);
    }

    // ─── Sync auth logs batch-by-batch (Cursor Loop) ─────────────────────────
    let totalLogsSynced = 0;
    let logsBatch = await FaceDB.getUnsyncedLogsBatch(50);
    let expectedPrevHash = '';
    let isFirstBatch = true;

    while (logsBatch.length > 0) {
      console.log(`[SyncManager] Syncing batch of ${logsBatch.length} auth logs...`);
      
      if (isFirstBatch) {
        expectedPrevHash = logsBatch[0].prevHash;
        isFirstBatch = false;
      }

      // 1. Audit Chain Integrity Verification for current batch page
      for (const log of logsBatch) {
        const verifiedInt = log.verified ? 1 : 0;
        const livenessInt = log.livenessPassesed ? 1 : 0;
        
        // Ledger Chain Formula: SHA-256(id + user_id + timestamp + verified + similarity + liveness_passed + prev_hash)
        const hashInput = `${log.id}${log.userId}${log.timestamp}${verifiedInt}${log.similarity.toFixed(4)}${livenessInt}${log.prevHash}`;
        const recomputedHash = crypto.createHash('sha256').update(hashInput).digest('hex');

        // Check for local tampering (value injection / direct DB manipulation)
        if (log.hash !== recomputedHash) {
          throw new Error(`CRITICAL security breach: Verification signature tampered on auth log ${log.id}!`);
        }

        // Check for chain disruption (entry deletion / direct DB line drop)
        if (log.prevHash !== expectedPrevHash) {
          throw new Error(`CRITICAL security breach: Auth log ledger chain broken at entry ${log.id}!`);
        }

        expectedPrevHash = log.hash;
      }

      // 2. Batch write (up to 25 items per request per DynamoDB limits)
      const BATCH_SIZE = 25;
      const syncedIds: string[] = [];

      for (let i = 0; i < logsBatch.length; i += BATCH_SIZE) {
        const subBatch = logsBatch.slice(i, i + BATCH_SIZE);
        const requestItems = subBatch.map(log => ({
          PutRequest: {
            Item: {
              id:               { S: log.id },
              user_id:          { S: log.userId },
              timestamp:        { N: String(log.timestamp) },
              verified:         { BOOL: log.verified },
              similarity:       { N: String(log.similarity.toFixed(4)) },
              liveness_passed:  { BOOL: log.livenessPassesed },
              hash:             { S: log.hash },
              prev_hash:        { S: log.prevHash },
            },
          },
        }));

        await dynamo.send(new BatchWriteItemCommand({
          RequestItems: { [config.dynamoLogsTable]: requestItems },
        }));

        subBatch.forEach(l => syncedIds.push(l.id));
      }

      await FaceDB.markSynced('auth_logs', syncedIds);
      totalLogsSynced += syncedIds.length;
      
      // Load next batch cursor page
      logsBatch = await FaceDB.getUnsyncedLogsBatch(50);
    }

    // ─── Sync-Down enrollments from other devices (Phase 4.3) ───────────────
    console.log(`[SyncManager] Syncing down new enrollments from other devices...`);
    try {
      const rawLastDownload = await EncryptedStorage.getItem('last_download_at');
      const lastDownloadAt = rawLastDownload ? parseInt(rawLastDownload, 10) : 0;
      
      const scanRes = await dynamo.send(new ScanCommand({
        TableName: config.dynamoEnrollmentsTable,
        FilterExpression: 'enrolled_at > :lastDownload AND device_id <> :ourDevice',
        ExpressionAttributeValues: {
          ':lastDownload': { N: String(lastDownloadAt) },
          ':ourDevice': { S: deviceId }
        }
      }));

      const items = scanRes.Items ?? [];
      console.log(`[SyncManager] Found ${items.length} new enrollments for sync-down`);

      for (const item of items) {
        const remoteId = item.id?.S || '';
        const remoteUserId = item.user_id?.S || '';
        const remoteUserName = item.user_name?.S || '';
        const remoteDept = item.department?.S || '';
        const remoteS3Key = item.s3_key?.S || '';
        const remoteEnrolledAt = parseInt(item.enrolled_at?.N || '0', 10);
        const remoteDeviceId = item.device_id?.S || 'unknown';

        // Download binary face embedding template from S3
        console.log(`[SyncManager] Downloading embedding for user ${remoteUserId} (${remoteId})...`);
        const s3Res = await s3.send(new GetObjectCommand({
          Bucket: config.s3Bucket,
          Key: remoteS3Key
        }));

        // Read stream into buffer
        if (s3Res.Body) {
          const stream = s3Res.Body as any;
          const chunks: any[] = [];
          
          const buffer = await new Promise<Buffer>((resolve, reject) => {
            stream.on('data', (chunk: any) => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
          });

          const embeddingFloatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

          // Save and dynamically index into LSH
          await FaceDB.enrollFaceSyncDown({
            id: remoteId,
            userId: remoteUserId,
            userName: remoteUserName,
            department: remoteDept,
            embedding: embeddingFloatArray,
            deviceId: remoteDeviceId,
            userRegistryId: remoteId,
            enrolledAt: remoteEnrolledAt
          });
        }
      }

      await EncryptedStorage.setItem('last_download_at', String(Date.now()));
    } catch (downErr) {
      console.warn('[SyncManager] Sync-down skipped or failed:', downErr);
    }

    // ─── Purge synced old records ────────────────────────────────────────────
    const purged = await FaceDB.purgeSynced(7);
    console.log(`[SyncManager] Purged: ${purged.enrollments} enrollments, ${purged.logs} logs`);

    // Reset exponential backoff attempts on success
    retryAttempt = 0;
    if (syncTimeoutId) {
      clearTimeout(syncTimeoutId);
      syncTimeoutId = null;
    }

    syncStatus.lastSuccess = Date.now();
    syncStatus.lastError = '';

    console.log(`[SyncManager] Sync complete. Enrollments: ${totalEnrollmentsSynced}, Logs: ${totalLogsSynced}`);
  } catch (err: any) {
    syncStatus.lastError = err?.message ?? 'Unknown sync error';
    console.error('[SyncManager] Sync failed:', err);

    // Schedule sync retry with exponential backoff & full jitter
    retryAttempt++;
    const exponentialBackoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, retryAttempt));
    const jitteredDelay = Math.floor(Math.random() * exponentialBackoff);

    console.warn(`[SyncManager] Unstable connection. Retrying sync in ${jitteredDelay}ms (attempt #${retryAttempt})...`);

    if (syncTimeoutId) clearTimeout(syncTimeoutId);
    
    // Only schedule if network is still online
    NetInfo.fetch().then(state => {
      if (state.isConnected && state.isInternetReachable) {
        syncTimeoutId = setTimeout(async () => {
          await forceSync();
        }, jitteredDelay);
      }
    });
  } finally {
    isSyncing = false;
  }
}

const bgOptions = {
  taskName: 'FaceAuthSync',
  taskTitle: 'FaceAuth Offline Syncing',
  taskDesc: 'Syncing offline biometric logs to cloud datalake...',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#00E5FF',
  linkingURI: 'faceauth://sync',
  parameters: {
    delay: 900000, // 15 minutes (900000 ms)
  },
};

const bgSyncTask = async (taskData: any) => {
  await new Promise(async (resolve) => {
    const delay = taskData.delay || 900000;
    while (BackgroundJob.isRunning()) {
      try {
        console.log('[SyncManager] Background task running sync...');
        const state = await NetInfo.fetch();
        if (state.isConnected && state.isInternetReachable) {
          const stats = await FaceDB.getStats();
          if (stats.pendingSync > 0) {
            await doSync(true);
          }
        }
      } catch (e) {
        console.error('[SyncManager] Background sync failed:', e);
      }
      await new Promise(r => setTimeout(r, delay));
    }
  });
};

export const SyncManager = {
  async startListener(): Promise<void> {
    unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected && state.isInternetReachable) {
        // Trigger initial sync attempt on connection restored
        doSync();
      } else {
        // Clear any pending retry timers on disconnection
        if (syncTimeoutId) {
          clearTimeout(syncTimeoutId);
          syncTimeoutId = null;
        }
      }
    });

    if (!BackgroundJob.isRunning()) {
      try {
        await BackgroundJob.start(bgSyncTask, bgOptions);
        console.log('[SyncManager] Background job started successfully.');
      } catch (e) {
        console.error('[SyncManager] Failed to start background job:', e);
      }
    }
  },

  async stopListener(): Promise<void> {
    unsubscribe?.();
    unsubscribe = null;
    if (syncTimeoutId) {
      clearTimeout(syncTimeoutId);
      syncTimeoutId = null;
    }
    if (BackgroundJob.isRunning()) {
      try {
        await BackgroundJob.stop();
        console.log('[SyncManager] Background job stopped.');
      } catch (e) {
        console.error('[SyncManager] Failed to stop background job:', e);
      }
    }
  },

  /** Manually trigger sync (e.g., from Sync screen) */
  async syncNow(): Promise<void> {
    await forceSync();
  },

  getStatus() {
    return { ...syncStatus };
  },

  async saveConfig(config: AWSConfig): Promise<void> {
    await saveAWSConfig(config);
  },
};
