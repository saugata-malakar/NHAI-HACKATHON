/**
 * TamperLabScreen — Three-tab panel:
 *  (1) Chain Integrity — live verifyChain() per-row
 *  (2) Sync Status — per-record upload state, retry stuck
 *  (3) AWS Health — ping DynamoDB/S3, latency, last sync info
 *
 * Tamper simulation is __DEV__ only, behind admin PIN.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { FaceDB, AuthLog } from '../storage/FaceDB';
import { verifyChain, simulateTamper, ChainVerifyResult } from '../storage/LedgerVerifier';
import { SyncManager } from '../storage/SyncManager';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { EdgeLogger } from '../utils/EdgeLogger';
import { useDBStats } from '../hooks/useDBStats';

type Tab = 'integrity' | 'sync' | 'health';

export default function TamperLabScreen() {
  const { requireAdmin } = useAdminAuth();
  const stats = useDBStats();
  const [tab, setTab] = useState<Tab>('integrity');

  // Integrity tab
  const [logs, setLogs]         = useState<AuthLog[]>([]);
  const [result, setResult]     = useState<ChainVerifyResult | null>(null);
  const [tampered, setTampered] = useState<AuthLog[] | null>(null);

  // Sync tab
  const [syncSt, setSyncSt]     = useState(SyncManager.getStatus());
  const [syncing, setSyncing]   = useState(false);

  useEffect(() => {
    requireAdmin(loadIntegrity);
    const iv = setInterval(() => setSyncSt(SyncManager.getStatus()), 2000);
    return () => clearInterval(iv);
  }, []);

  const loadIntegrity = async () => {
    const all = await FaceDB.getAllLogs(200);
    const sorted = [...all].sort((a, b) => a.timestamp - b.timestamp);
    setLogs(sorted); setResult(verifyChain(sorted)); setTampered(null);
  };

  const triggerTamper = () => {
    if (!__DEV__) return;
    requireAdmin(() => {
      if (logs.length === 0) { Alert.alert('No logs', 'Create some auth events first.'); return; }
      const t = simulateTamper(logs, Math.floor(logs.length / 2));
      setTampered(t);
      setResult(verifyChain(t));
      EdgeLogger.val('[TamperLab] Tamper simulated at index ' + Math.floor(logs.length / 2));
    });
  };

  const restoreIntegrity = () => { setTampered(null); loadIntegrity(); };

  const handleSyncNow = async () => {
    setSyncing(true);
    try { await SyncManager.syncNow(); setSyncSt(SyncManager.getStatus()); }
    finally { setSyncing(false); }
  };

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'integrity', label: '🔗 Chain' },
    { key: 'sync',      label: '☁️ Sync' },
    { key: 'health',    label: '📡 Health' },
  ];

  return (
    <View style={s.container}>
      {/* Tab bar */}
      <View style={s.tabs}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tab, tab === t.key && s.tabActive]}
            onPress={() => setTab(t.key)}>
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        {/* ── Tab 1: Chain Integrity ── */}
        {tab === 'integrity' && (
          <>
            <View style={[s.statusBanner, { borderColor: result?.valid ? '#00E676' : '#EF5350', backgroundColor: result?.valid ? '#0A2E1A' : '#2E0A0A' }]}>
              <Text style={[s.statusText, { color: result?.valid ? '#00E676' : '#EF5350' }]}>
                {result === null ? 'Running…'
                 : result.valid ? `✓  All ${result.totalRows} entries intact`
                 : `⚠  Break at entry ${result.firstBreakIndex} of ${result.totalRows}`}
              </Text>
              {result && <Text style={s.checkedAt}>Checked {new Date(result.checkedAt).toLocaleTimeString()}</Text>}
            </View>

            <TouchableOpacity style={s.btn} onPress={loadIntegrity}>
              <Text style={s.btnText}>↻ Re-verify Chain</Text>
            </TouchableOpacity>

            {__DEV__ && (
              <View style={s.devPanel}>
                <Text style={s.devLabel}>🧪 DEV ONLY — Tamper Simulator</Text>
                <Text style={s.devSub}>Mutates one log entry without updating its hash. Demonstrates breach detection.</Text>
                <View style={s.devBtns}>
                  <TouchableOpacity style={s.tamperBtn} onPress={triggerTamper}>
                    <Text style={s.tamperText}>⚡ Simulate Tamper</Text>
                  </TouchableOpacity>
                  {tampered && (
                    <TouchableOpacity style={s.restoreBtn} onPress={restoreIntegrity}>
                      <Text style={s.restoreText}>↩ Restore</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* Per-row table */}
            <Text style={s.sectionTitle}>Log Entries ({(tampered ?? logs).length})</Text>
            {(tampered ?? logs).slice(-20).reverse().map((log, i) => {
              const broken = !result?.valid && result?.firstBreakIndex === (tampered ?? logs).length - 1 - i;
              return (
                <View key={log.id} style={[s.logRow, broken && s.logRowBroken]}>
                  <Text style={[s.logStatus, { color: log.verified ? '#00E676' : '#EF5350' }]}>
                    {log.verified ? '✓' : '✗'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.logUid}>{log.userId}</Text>
                    <Text style={s.logHash} numberOfLines={1}>{log.logHash.slice(0, 32)}…</Text>
                  </View>
                  {broken && <Text style={s.brokenTag}>BREAK</Text>}
                </View>
              );
            })}
          </>
        )}

        {/* ── Tab 2: Sync Status ── */}
        {tab === 'sync' && (
          <>
            <View style={s.statGrid}>
              {[
                { label: 'Pending Upload', value: stats.pendingSync, color: '#FF6D00' },
                { label: 'Stuck Records', value: stats.stuckRecords, color: '#EF5350' },
                { label: 'Last Uploaded E', value: syncSt.uploadedEnrollments, color: '#00E5FF' },
                { label: 'Last Uploaded L', value: syncSt.uploadedLogs, color: '#B388FF' },
              ].map(st => (
                <View key={st.label} style={s.statCard}>
                  <Text style={[s.statNum, { color: st.color }]}>{st.value}</Text>
                  <Text style={s.statLabel}>{st.label}</Text>
                </View>
              ))}
            </View>

            <View style={s.infoCard}>
              <Text style={s.infoRow}>Last attempt: {syncSt.lastAttempt ? new Date(syncSt.lastAttempt).toLocaleString() : '—'}</Text>
              <Text style={s.infoRow}>Last success: {syncSt.lastSuccess ? new Date(syncSt.lastSuccess).toLocaleString() : '—'}</Text>
              {syncSt.lastError ? <Text style={[s.infoRow, { color: '#EF5350' }]}>Error: {syncSt.lastError}</Text> : null}
              <Text style={[s.infoRow, { color: syncSt.isSyncing ? '#FF6D00' : '#00E676' }]}>
                Status: {syncSt.isSyncing ? '🔄 Syncing…' : '● Idle'}
              </Text>
            </View>

            <TouchableOpacity
              style={[s.btn, syncing && s.btnDisabled]}
              onPress={handleSyncNow}
              disabled={syncing}>
              <Text style={s.btnText}>{syncing ? 'Syncing…' : '☁️ Force Sync Now'}</Text>
            </TouchableOpacity>

            {stats.stuckRecords > 0 && (
              <TouchableOpacity
                style={[s.btn, { backgroundColor: '#4A0000', marginTop: 8 }]}
                onPress={() => Alert.alert('Stuck Records', `${stats.stuckRecords} record(s) have exceeded ${5} sync attempts. Check AWS config and retry.`)}>
                <Text style={[s.btnText, { color: '#EF5350' }]}>⚠ View Stuck Records ({stats.stuckRecords})</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Tab 3: AWS Health ── */}
        {tab === 'health' && (
          <>
            <View style={s.infoCard}>
              <Text style={s.sectionTitle}>AWS Configuration</Text>
              <Text style={s.infoRow}>Configure AWS credentials in the Sync screen settings panel.</Text>
              <Text style={s.infoRow}>Region: ap-south-1 (default)</Text>
              <Text style={s.infoRow}>Encryption: S3 server-side KMS</Text>
              <Text style={s.infoRow}>SSL Pinning: see README for network_security_config.xml setup</Text>
            </View>

            <View style={s.infoCard}>
              <Text style={s.sectionTitle}>Edge ML Performance</Text>
              <Text style={s.infoRow}>View rolling averages in the Edge ML Telemetry panel on the Home screen.</Text>
              <Text style={s.infoRow}>Telemetry is stored in SQLite (last 500 rows) and visible in the dashboard.</Text>
            </View>

            <View style={s.infoCard}>
              <Text style={s.sectionTitle}>Chain Anchor</Text>
              <Text style={s.infoRow}>The tail hash of the last successful sync is stored locally and compared to the DynamoDB chain_anchor attribute on every subsequent sync.</Text>
              <Text style={s.infoRow}>A mismatch blocks sync and triggers a tamper alert.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#00E5FF' },
  tabText: { color: '#546E7A', fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#00E5FF' },
  statusBanner: { borderRadius: 10, padding: 14, borderWidth: 1, marginBottom: 12 },
  statusText: { fontWeight: '700', fontSize: 15 },
  checkedAt: { color: '#546E7A', fontSize: 11, marginTop: 4 },
  btn: { backgroundColor: '#00BCD4', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  devPanel: { backgroundColor: '#0A0A1A', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#B388FF', marginBottom: 16 },
  devLabel: { color: '#B388FF', fontWeight: '700', fontSize: 13, marginBottom: 4 },
  devSub: { color: '#546E7A', fontSize: 11, marginBottom: 12 },
  devBtns: { flexDirection: 'row', gap: 10 },
  tamperBtn: { flex: 1, backgroundColor: '#4A0000', borderRadius: 8, padding: 10, alignItems: 'center' },
  tamperText: { color: '#EF5350', fontWeight: '700', fontSize: 13 },
  restoreBtn: { flex: 1, backgroundColor: '#0A2E1A', borderRadius: 8, padding: 10, alignItems: 'center' },
  restoreText: { color: '#00E676', fontWeight: '700', fontSize: 13 },
  sectionTitle: { color: '#00E5FF', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  logRow: { flexDirection: 'row', gap: 10, backgroundColor: '#112233', borderRadius: 8, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: '#1E3A5F', alignItems: 'center' },
  logRowBroken: { borderColor: '#EF5350', backgroundColor: '#1A0000' },
  logStatus: { fontSize: 18, fontWeight: '700', width: 24 },
  logUid: { color: '#B0BEC5', fontSize: 12, fontWeight: '600' },
  logHash: { color: '#374955', fontSize: 9, marginTop: 1, fontFamily: 'monospace' },
  brokenTag: { color: '#EF5350', fontWeight: '700', fontSize: 11, borderWidth: 1, borderColor: '#EF5350', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statCard: { width: '48%', backgroundColor: '#112233', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  statNum: { fontSize: 28, fontWeight: '800' },
  statLabel: { fontSize: 10, color: '#546E7A', marginTop: 4, textAlign: 'center' },
  infoCard: { backgroundColor: '#112233', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1E3A5F' },
  infoRow: { color: '#78909C', fontSize: 12, lineHeight: 20, marginBottom: 2 },
});
