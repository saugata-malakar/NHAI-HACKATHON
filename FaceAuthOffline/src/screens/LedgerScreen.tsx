/**
 * LedgerScreen — Full cryptographic audit ledger viewer.
 * Shows all auth logs with per-row chain verification status,
 * search by UID/name, CSV export, and chain tail hash.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Share, Alert,
} from 'react-native';
import { FaceDB, AuthLog } from '../storage/FaceDB';
import { verifyChain, ChainVerifyResult } from '../storage/LedgerVerifier';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { SecurityService } from '../services/SecurityService';

export default function LedgerScreen() {
  const { requireAdmin } = useAdminAuth();
  const [logs, setLogs]         = useState<AuthLog[]>([]);
  const [filtered, setFiltered] = useState<AuthLog[]>([]);
  const [query, setQuery]       = useState('');
  const [verify, setVerify]     = useState<ChainVerifyResult | null>(null);
  const [anchor, setAnchor]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => { requireAdmin(load); }, []);

  useEffect(() => {
    if (!query.trim()) { setFiltered(logs); return; }
    const q = query.toLowerCase();
    setFiltered(logs.filter(l => l.userId.toLowerCase().includes(q)));
  }, [query, logs]);

  const load = async () => {
    setLoading(true);
    SecurityService.enableScreenshotPrevention();
    try {
      const all = await FaceDB.getAllLogs(1000);
      const sorted = [...all].sort((a, b) => a.timestamp - b.timestamp);
      setLogs(all);
      setFiltered(all);
      setVerify(verifyChain(sorted));
      setAnchor(await FaceDB.getChainAnchor());
    } finally { setLoading(false); }
  };

  useEffect(() => () => { SecurityService.disableScreenshotPrevention(); }, []);

  const exportCSV = async () => {
    const header = 'Time,UserID,Verified,Similarity,Liveness,LogHash,PrevHash\n';
    const rows = filtered.map(l =>
      [new Date(l.timestamp).toISOString(), l.userId,
       l.verified ? 'GRANTED' : 'DENIED',
       (l.similarity * 100).toFixed(2) + '%',
       l.livenessPassed ? 'PASS' : 'FAIL',
       l.logHash, l.prevHash].join(',')
    ).join('\n');
    await Share.share({ message: header + rows, title: 'FaceAuth Audit Ledger' });
  };

  const isBroken = (log: AuthLog, idx: number): boolean => {
    if (!verify || verify.valid) return false;
    return verify.firstBreakIndex !== null && idx === verify.firstBreakIndex;
  };

  const renderItem = ({ item, index }: { item: AuthLog; index: number }) => {
    const broken = isBroken(item, logs.length - 1 - index); // logs shown newest first
    return (
      <View style={[s.row, broken && s.rowBroken]}>
        <View style={[s.statusDot, { backgroundColor: item.verified ? '#00E676' : '#EF5350' }]} />
        <View style={{ flex: 1 }}>
          <View style={s.rowTop}>
            <Text style={s.rowTime}>{new Date(item.timestamp).toLocaleString()}</Text>
            <Text style={[s.rowVerified, { color: item.verified ? '#00E676' : '#EF5350' }]}>
              {item.verified ? 'GRANTED' : 'DENIED'}
            </Text>
          </View>
          <Text style={s.rowUid}>{item.userId}</Text>
          <Text style={s.rowSim}>
            Similarity: {(item.similarity * 100).toFixed(1)}%  ·  Liveness: {item.livenessPassed ? 'PASS' : 'FAIL'}
          </Text>
          <Text style={s.rowHash} numberOfLines={1}>
            H: {item.logHash.slice(0, 24)}…  P: {item.prevHash ? item.prevHash.slice(0, 12) + '…' : '—'}
          </Text>
          {broken && <Text style={s.brokenLabel}>⚠ CHAIN BREAK DETECTED</Text>}
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      {/* Chain status banner */}
      <View style={[s.chainBanner, { backgroundColor: verify?.valid ? '#0A2E1A' : '#2E0A0A', borderColor: verify?.valid ? '#00E676' : '#EF5350' }]}>
        <Text style={[s.chainStatus, { color: verify?.valid ? '#00E676' : '#EF5350' }]}>
          {verify === null ? '🔄 Verifying…'
           : verify.valid
             ? `✓  Chain intact — ${verify.totalRows} entries`
             : `⚠  Chain BROKEN at entry ${verify.firstBreakIndex} of ${verify.totalRows}`}
        </Text>
        {anchor && <Text style={s.anchorText} numberOfLines={1}>Anchor: {anchor.slice(0, 20)}…</Text>}
      </View>

      {/* Search + Export */}
      <View style={s.toolsRow}>
        <TextInput
          style={s.search} placeholder="Search by User ID…"
          placeholderTextColor="#546E7A" value={query}
          onChangeText={setQuery}
        />
        <TouchableOpacity style={s.exportBtn} onPress={exportCSV}>
          <Text style={s.exportText}>⬇ CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.refreshBtn} onPress={() => requireAdmin(load)}>
          <Text style={s.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshing={loading}
        onRefresh={() => requireAdmin(load)}
        ListEmptyComponent={<Text style={s.empty}>{loading ? 'Loading…' : 'No entries'}</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  chainBanner: { margin: 12, borderRadius: 10, padding: 12, borderWidth: 1 },
  chainStatus: { fontWeight: '700', fontSize: 14 },
  anchorText: { color: '#546E7A', fontSize: 10, marginTop: 4, fontFamily: 'monospace' },
  toolsRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 4 },
  search: { flex: 1, backgroundColor: '#112233', borderRadius: 8, padding: 10, color: '#E0F7FA', borderWidth: 1, borderColor: '#1E3A5F', fontSize: 13 },
  exportBtn: { backgroundColor: '#1565C0', borderRadius: 8, padding: 10, justifyContent: 'center' },
  exportText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  refreshBtn: { backgroundColor: '#112233', borderRadius: 8, padding: 10, justifyContent: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  refreshText: { color: '#00E5FF', fontWeight: '700', fontSize: 18 },
  row: { backgroundColor: '#112233', borderRadius: 10, padding: 12, marginBottom: 6, flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: '#1E3A5F' },
  rowBroken: { borderColor: '#EF5350', backgroundColor: '#1A0000' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTime: { color: '#78909C', fontSize: 12 },
  rowVerified: { fontSize: 11, fontWeight: '700' },
  rowUid: { color: '#E0F7FA', fontWeight: '600', fontSize: 13, marginTop: 2 },
  rowSim: { color: '#78909C', fontSize: 11, marginTop: 2 },
  rowHash: { color: '#374955', fontSize: 10, marginTop: 2, fontFamily: 'monospace' },
  brokenLabel: { color: '#EF5350', fontWeight: '700', fontSize: 11, marginTop: 4 },
  empty: { textAlign: 'center', color: '#546E7A', marginTop: 60, fontSize: 14 },
});
