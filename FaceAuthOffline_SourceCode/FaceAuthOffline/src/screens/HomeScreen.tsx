/**
 * HomeScreen — Production dashboard.
 * Every button is functional. Telemetry from DB. All icons navigate correctly.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { ModelLoader } from '../ml/ModelLoader';
import { FaceDB } from '../storage/FaceDB';
import { SyncManager } from '../storage/SyncManager';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { useDBStats } from '../hooks/useDBStats';
import { SecurityService } from '../services/SecurityService';

export default function HomeScreen() {
  const nav = useNavigation<any>();
  const stats = useDBStats(3000);
  const { requireAdmin } = useAdminAuth();
  const [modelsReady, setModelsReady] = useState(false);
  const [isOnline, setIsOnline]       = useState(false);
  const [lastSync, setLastSync]       = useState(0);
  const [telemetry, setTelemetry]     = useState({ avgBlazefaceMs: 0, avgFacemeshMs: 0, avgEmbeddingMs: 0, avgTotalMs: 0 });

  useEffect(() => {
    const iv = setInterval(() => setModelsReady(ModelLoader.isReady()), 1000);
    const unsub = NetInfo.addEventListener(s => setIsOnline(!!(s.isConnected && s.isInternetReachable)));
    // Telemetry refresh
    const tv = setInterval(async () => {
      const t = await FaceDB.getTelemetryAverages();
      setTelemetry(t);
      setLastSync(SyncManager.getStatus().lastSuccess);
    }, 4000);
    return () => { clearInterval(iv); clearInterval(tv); unsub(); };
  }, []);

  const goToAuth = async () => {
    if (stats.totalEnrolled === 0) {
      nav.navigate('AdminPin', { title: 'Enroll first', onSuccess: () => nav.navigate('Enroll', {}) });
      return;
    }
    const perm = Platform.OS === 'android' ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA;
    const s = await check(perm);
    if (s !== RESULTS.GRANTED) await request(perm);
    SecurityService.recordActivity();
    nav.navigate('Auth');
  };

  const goToEnroll = () => requireAdmin(async () => {
    const perm = Platform.OS === 'android' ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA;
    const s = await check(perm);
    if (s !== RESULTS.GRANTED) await request(perm);
    nav.navigate('Enroll', {});
  });

  const ms = (v: number) => v > 0 ? `${v.toFixed(1)}ms` : '—';

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Network badge */}
      <View style={s.networkBadge}>
        <View style={[s.dot, { backgroundColor: isOnline ? '#00E676' : '#EF5350' }]} />
        <Text style={s.networkText}>
          Network: {isOnline ? 'ONLINE' : 'OFFLINE'}
          {lastSync > 0 ? ` · Synced ${Math.round((Date.now() - lastSync) / 60000)}m ago` : ''}
        </Text>
      </View>

      {/* Model status */}
      <View style={s.statusCard}>
        <View style={s.statusRow}>
          <View style={[s.dot, { backgroundColor: modelsReady ? '#00E676' : '#FF6D00' }]} />
          <Text style={s.statusText}>{modelsReady ? 'Edge AI Ready — 7.1 MB Models Loaded' : 'Loading AI Models…'}</Text>
          {!modelsReady && <ActivityIndicator color="#00E5FF" size="small" style={{ marginLeft: 8 }} />}
        </View>
      </View>

      {/* Stats row */}
      <View style={s.statsRow}>
        {[
          { label: 'Enrolled', value: stats.totalEnrolled, color: '#00E5FF', onPress: () => requireAdmin(() => nav.navigate('UserList')) },
          { label: 'Pending Sync', value: stats.pendingSync, color: '#FF6D00', onPress: () => requireAdmin(() => nav.navigate('Sync')) },
          { label: 'Auth Logs', value: stats.totalLogs, color: '#B388FF', onPress: () => requireAdmin(() => nav.navigate('Ledger')) },
        ].map(st => (
          <TouchableOpacity key={st.label} style={s.statCard} onPress={st.onPress} activeOpacity={0.75}>
            <Text style={[s.statValue, { color: st.color }]}>{st.value}</Text>
            <Text style={s.statLabel}>{st.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Edge ML Telemetry */}
      <View style={s.telCard}>
        <Text style={s.telTitle}>⚡ Edge ML Telemetry (50-frame avg)</Text>
        <View style={s.telGrid}>
          {[
            { label: 'BlazeFace', value: ms(telemetry.avgBlazefaceMs) },
            { label: 'FaceMesh', value: ms(telemetry.avgFacemeshMs) },
            { label: 'Embedding', value: ms(telemetry.avgEmbeddingMs) },
            { label: 'Total', value: ms(telemetry.avgTotalMs), big: true },
          ].map(t => (
            <View key={t.label} style={[s.telItem, t.big && s.telItemBig]}>
              <Text style={[s.telValue, t.big && { color: '#00E5FF', fontSize: 22 }]}>{t.value}</Text>
              <Text style={s.telLabel}>{t.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Primary actions */}
      <TouchableOpacity
        style={[s.btn, s.btnPrimary, !modelsReady && s.btnDisabled]}
        onPress={goToAuth} disabled={!modelsReady}>
        <Text style={s.btnText}>🎯  Authenticate</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, s.btnSecondary, !modelsReady && s.btnDisabled]}
        onPress={goToEnroll} disabled={!modelsReady}>
        <Text style={s.btnText}>➕  Enroll New Face</Text>
      </TouchableOpacity>

      {/* Secondary nav */}
      <View style={s.navGrid}>
        {[
          { icon: '👥', label: 'User Registry',  onPress: () => requireAdmin(() => nav.navigate('UserList')) },
          { icon: '⛓️', label: 'Audit Ledger',   onPress: () => requireAdmin(() => nav.navigate('Ledger')) },
          { icon: '🔬', label: 'Tamper Lab',     onPress: () => requireAdmin(() => nav.navigate('TamperLab')) },
          { icon: '☁️', label: 'Sync & AWS',     onPress: () => requireAdmin(() => nav.navigate('Sync')) },
        ].map(item => (
          <TouchableOpacity key={item.label} style={s.navCard} onPress={item.onPress} activeOpacity={0.75}>
            <Text style={s.navIcon}>{item.icon}</Text>
            <Text style={s.navLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Security note */}
      <View style={s.secNote}>
        <Text style={s.secText}>
          🔐  AES-256 encrypted embeddings  ·  Chained audit ledger  ·  Zero network required
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  networkBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  networkText: { color: '#546E7A', fontSize: 12 },
  statusCard: { backgroundColor: '#112233', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1E3A5F' },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusText: { color: '#B0BEC5', fontSize: 13, flex: 1, marginLeft: 8 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: '#112233', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  statValue: { fontSize: 26, fontWeight: '800' },
  statLabel: { fontSize: 10, color: '#546E7A', marginTop: 3, textAlign: 'center' },
  telCard: { backgroundColor: '#112233', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#1E3A5F' },
  telTitle: { color: '#00E5FF', fontWeight: '700', fontSize: 13, marginBottom: 10 },
  telGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  telItem: { width: '22%', alignItems: 'center' },
  telItemBig: { width: '30%' },
  telValue: { color: '#00E676', fontWeight: '700', fontSize: 16 },
  telLabel: { color: '#546E7A', fontSize: 10, marginTop: 2 },
  btn: { padding: 16, borderRadius: 14, alignItems: 'center', marginBottom: 10 },
  btnPrimary: { backgroundColor: '#00BCD4' },
  btnSecondary: { backgroundColor: '#1565C0' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  navCard: { width: '48%', backgroundColor: '#112233', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  navIcon: { fontSize: 28, marginBottom: 6 },
  navLabel: { color: '#B0BEC5', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  secNote: { backgroundColor: '#0A1929', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1E3A5F' },
  secText: { color: '#374955', fontSize: 11, textAlign: 'center' },
});
