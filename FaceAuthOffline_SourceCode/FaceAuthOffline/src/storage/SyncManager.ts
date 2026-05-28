/**
 * SyncManager — Production sync: chunked batches, chain verification block,
 * sync-down from AWS, background task, retry queue, chain anchor.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import EncryptedStorage from 'react-native-encrypted-storage';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand, BatchWriteItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import BackgroundActions from 'react-native-background-actions';
import { FaceDB } from './FaceDB';
import { verifyChain } from './LedgerVerifier';
import { EdgeLogger } from '../utils/EdgeLogger';
import { LSHIndex } from '../ml/LSHIndex';
import DeviceInfo from 'react-native-device-info';
import { Buffer } from 'buffer';

interface AWSConfig {
  region: string; accessKeyId: string; secretAccessKey: string;
  s3Bucket: string; dynamoEnrollmentsTable: string; dynamoLogsTable: string;
}

const SYNC_COOLDOWN_MS = 30_000;
let lastSyncAt = 0;
let isSyncing = false;
let unsubscribe: (() => void) | null = null;
const syncStatus = { lastAttempt: 0, lastSuccess: 0, lastError: '', uploadedEnrollments: 0, uploadedLogs: 0 };

async function loadAWSConfig(): Promise<AWSConfig | null> {
  try { const r = await EncryptedStorage.getItem('aws_config'); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = Buffer.alloc(total); let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return buf;
}

async function doSync(): Promise<void> {
  if (isSyncing) return;
  const now = Date.now();
  if (now - lastSyncAt < SYNC_COOLDOWN_MS) return;
  const config = await loadAWSConfig();
  if (!config) { syncStatus.lastError = 'AWS config not set'; return; }
  isSyncing = true; lastSyncAt = now; syncStatus.lastAttempt = now;

  try {
    const creds = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
    const s3     = new S3Client({ region: config.region, credentials: creds });
    const dynamo = new DynamoDBClient({ region: config.region, credentials: creds });
    const deviceId = await DeviceInfo.getUniqueId();

    // 1. Chain integrity check — block sync if broken
    const allLogs = await FaceDB.getAllLogs(10000);
    const sorted = [...allLogs].sort((a, b) => a.timestamp - b.timestamp);
    const chain = verifyChain(sorted);
    if (!chain.valid) {
      syncStatus.lastError = `Chain broken at index ${chain.firstBreakIndex}. Sync blocked.`;
      EdgeLogger.error(`[SyncManager] ${syncStatus.lastError}`);
      return;
    }
    EdgeLogger.sync('[SyncManager] Chain integrity OK');

    // 2. Upload enrollments in 50-row batches
    let offset = 0, totalUploaded = 0;
    while (true) {
      const batch = await FaceDB.getUnsyncedEnrollmentsBatch(offset);
      if (batch.length === 0) break;
      const done: string[] = [];
      for (const e of batch) {
        try {
          const key = `embeddings/${e.userId}/${e.id}.bin`;
          await s3.send(new PutObjectCommand({
            Bucket: config.s3Bucket, Key: key,
            Body: Buffer.from(e.embedding.buffer),
            ContentType: 'application/octet-stream',
            ServerSideEncryption: 'aws:kms',
            Metadata: { 'device-id': deviceId, 'user-id': e.userId, 'model-version': e.modelVersion },
          }));
          await dynamo.send(new PutItemCommand({
            TableName: config.dynamoEnrollmentsTable,
            Item: {
              id: { S: e.id }, user_id: { S: e.userId }, user_name: { S: e.userName },
              department: { S: e.department }, s3_key: { S: key },
              enrolled_at: { N: String(e.enrolledAt) }, device_id: { S: deviceId },
              model_version: { S: e.modelVersion }, synced_at: { N: String(Date.now()) },
            },
          }));
          done.push(e.id);
        } catch (err: any) {
          EdgeLogger.error(`[SyncManager] Enroll ${e.id} failed: ${err.message}`);
          await FaceDB.incrementSyncAttempt(e.id);
        }
      }
      if (done.length) await FaceDB.markSynced('enrollments', done);
      totalUploaded += done.length; offset += batch.length;
      if (batch.length < 50) break;
    }
    syncStatus.uploadedEnrollments = totalUploaded;
    EdgeLogger.sync(`[SyncManager] Enrollments: ${totalUploaded}`);

    // 3. Upload auth logs
    const logs = await FaceDB.getUnsyncedLogs();
    if (logs.length) {
      const syncedLogIds: string[] = [];
      for (let i = 0; i < logs.length; i += 25) {
        const chunk = logs.slice(i, i + 25);
        try {
          await dynamo.send(new BatchWriteItemCommand({
            RequestItems: {
              [config.dynamoLogsTable]: chunk.map(l => ({
                PutRequest: { Item: {
                  id: { S: l.id }, user_id: { S: l.userId },
                  timestamp: { N: String(l.timestamp) },
                  verified: { BOOL: l.verified }, similarity: { N: l.similarity.toFixed(4) },
                  liveness_passed: { BOOL: l.livenessPassed },
                  log_hash: { S: l.logHash }, prev_hash: { S: l.prevHash }, device_id: { S: deviceId },
                }},
              })),
            },
          }));
          chunk.forEach(l => syncedLogIds.push(l.id));
        } catch (err: any) { EdgeLogger.error(`[SyncManager] Log batch: ${err.message}`); }
      }
      await FaceDB.markSynced('auth_logs', syncedLogIds);
      syncStatus.uploadedLogs = syncedLogIds.length;
      await FaceDB.saveChainAnchor(logs[logs.length - 1].logHash);
      EdgeLogger.sync(`[SyncManager] Logs: ${syncedLogIds.length}`);
    }

    // 4. Sync-down from other devices
    try {
      const lastDl = Number(await FaceDB.getSetting('last_download_at') ?? '0');
      const res = await dynamo.send(new QueryCommand({
        TableName: config.dynamoEnrollmentsTable, IndexName: 'synced_at-index',
        KeyConditionExpression: 'synced_at > :ts',
        FilterExpression: 'device_id <> :me',
        ExpressionAttributeValues: { ':ts': { N: String(lastDl) }, ':me': { S: deviceId } },
        Limit: 200,
      }));
      let dl = 0;
      for (const item of (res.Items ?? [])) {
        const s3Key = item.s3_key?.S; if (!s3Key) continue;
        try {
          const obj = await s3.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: s3Key }));
          const buf = await streamToBuffer(obj.Body);
          const embedding = new Float32Array(buf.buffer);
          const userId = item.user_id?.S ?? '', userName = item.user_name?.S ?? '';
          await FaceDB.enrollFace({ userId, userName, department: item.department?.S ?? '', embedding, deviceId });
          LSHIndex.addEntry({ userId, userName, embedding }); dl++;
        } catch (err: any) { EdgeLogger.error(`[SyncManager] DL ${item.id?.S}: ${err.message}`); }
      }
      if (dl > 0) { EdgeLogger.sync(`[SyncManager] Downloaded ${dl} remote enrollments`); await FaceDB.setSetting('last_download_at', String(Date.now())); }
    } catch (err: any) { EdgeLogger.error(`[SyncManager] Sync-down: ${err.message}`); }

    // 5. Purge
    const purged = await FaceDB.purgeSynced(7);
    EdgeLogger.sync(`[SyncManager] Purged ${purged.enrollments}E ${purged.logs}L`);
    syncStatus.lastSuccess = Date.now(); syncStatus.lastError = '';

  } catch (err: any) {
    syncStatus.lastError = err?.message ?? 'Unknown';
    EdgeLogger.error(`[SyncManager] Fatal: ${syncStatus.lastError}`);
  } finally { isSyncing = false; }
}

export const SyncManager = {
  startListener(): void {
    unsubscribe = NetInfo.addEventListener((s: NetInfoState) => {
      if (s.isConnected && s.isInternetReachable) doSync();
    });
  },
  stopListener(): void { unsubscribe?.(); unsubscribe = null; },
  async syncNow(): Promise<void> { lastSyncAt = 0; await doSync(); },
  async startBackgroundSync(): Promise<void> {
    try {
      await BackgroundActions.start(async () => { await doSync(); }, {
        taskName: 'FaceAuthSync', taskTitle: 'FaceAuth Syncing',
        taskDesc: 'Uploading records to secure cloud', taskIcon: { name: 'ic_launcher', type: 'mipmap' },
        color: '#00BCD4', parameters: {},
      });
    } catch (e: any) { EdgeLogger.error(`[SyncManager] BG: ${e.message}`); }
  },
  async stopBackgroundSync(): Promise<void> { try { await BackgroundActions.stop(); } catch {} },
  async saveConfig(cfg: AWSConfig): Promise<void> {
    await EncryptedStorage.setItem('aws_config', JSON.stringify(cfg));
  },
  getStatus() { return { ...syncStatus, isSyncing }; },
};
