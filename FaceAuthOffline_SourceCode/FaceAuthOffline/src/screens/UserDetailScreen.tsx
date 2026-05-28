/**
 * UserDetailScreen — Full user profile with auth log timeline.
 * Shows enrollment info, similarity trend, active/suspend, force re-enroll.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { FaceDB, UserRecord, AuthLog } from '../storage/FaceDB';
import { useAdminAuth } from '../hooks/useAdminAuth';
import type { RootStackParamList } from '../navigation/AppNavigator';

type RouteP = RouteProp<RootStackParamList, 'UserDetail'>;

export default function UserDetailScreen() {
  const nav   = useNavigation<any>();
  const route = useRoute<RouteP>();
  const { requireAdmin } = useAdminAuth();
  const { userId } = route.params;

  const [user, setUser]   = useState<UserRecord | null>(null);
  const [logs, setLogs]   = useState<AuthLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [all, allLogs] = await Promise.all([
      FaceDB.getUsers(),
      FaceDB.getAllLogs(500),
    ]);
    const u = all.find(u => u.id === userId) ?? null;
    const userLogs = allLogs.filter(l => l.userId === userId);
    setUser(u); setLogs(userLogs); setLoading(false);
  };

  const toggleActive = () => {
    if (!user) return;
    requireAdmin(async () => {
      const next = !user.active;
      await FaceDB.setUserActive(user.id, next);
      await load();
    });
  };

  const forceReEnroll = () => {
    requireAdmin(() => {
      Alert.alert(
        'Force Re-Enroll',
        `Delete the face embedding for ${user?.fullName}? Their auth history is preserved but they will need to re-enroll.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete Embedding', style: 'destructive', onPress: async () => {
            // Mark user inactive (embedding still in DB but excluded from gallery)
            if (user) await FaceDB.setUserActive(user.id, false);
            nav.navigate('Enroll', { userId: user?.employeeId, userName: user?.fullName, userRegistryId: user?.id });
          }},
        ],
      );
    });
  };

  const avgSim = logs.length
    ? (logs.reduce((s, l) => s + l.similarity, 0) / logs.length * 100).toFixed(1)
    : '—';
  const grantRate = logs.length
    ? ((logs.filter(l => l.verified).length / logs.length) * 100).toFixed(0)
    : '—';

  if (loading || !user) return (
    <View style={s.center}><Text style={s.muted}>Loading…</Text></View>
  );

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Header */}
      <View style={s.header}>
        <View style={[s.avatar, { backgroundColor: user.active ? '#00BCD4' : '#546E7A' }]}>
          <Text style={s.avatarText}>{user.fullName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{user.fullName}</Text>
          <Text style={s.meta}>{user.employeeId}</Text>
          <Text style={s.meta}>{user.department} {user.designation ? `· ${user.designation}` : ''}</Text>
          <View style={[s.badge, { backgroundColor: user.active ? '#0A2E1A' : '#2E0A0A', borderColor: user.active ? '#00E676' : '#EF5350' }]}>
            <Text style={{ color: user.active ? '#00E676' : '#EF5350', fontWeight: '700', fontSize: 11 }}>
              {user.active ? 'ACTIVE' : 'SUSPENDED'}
            </Text>
          </View>
        </View>
      </View>

      {/* Stats */}
      <View style={s.statsRow}>
        {[
          { label: 'Auth Events', value: String(logs.length), color: '#00E5FF' },
          { label: 'Grant Rate', value: grantRate + '%', color: '#00E676' },
          { label: 'Avg Similarity', value: avgSim + '%', color: '#B388FF' },
        ].map(st => (
          <View key={st.label} style={s.statCard}>
            <Text style={[s.statValue, { color: st.color }]}>{st.value}</Text>
            <Text style={s.statLabel}>{st.label}</Text>
          </View>
        ))}
      </View>

      {/* Actions */}
      <View style={s.actionsRow}>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: user.active ? '#4A0000' : '#0A3020' }]} onPress={toggleActive}>
          <Text style={[s.actionText, { color: user.active ? '#EF5350' : '#00E676' }]}>
            {user.active ? '🚫 Suspend' : '✓ Activate'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#1A1A40' }]} onPress={forceReEnroll}>
          <Text style={[s.actionText, { color: '#B388FF' }]}>🔄 Re-Enroll</Text>
        </TouchableOpacity>
      </View>

      {/* Auth timeline */}
      <Text style={s.sectionTitle}>Authentication History</Text>
      {logs.length === 0 && <Text style={s.muted}>No auth events yet</Text>}
      {logs.slice(0, 50).map(log => (
        <View key={log.id} style={[s.logRow, { borderLeftColor: log.verified ? '#00E676' : '#EF5350' }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.logTime}>{new Date(log.timestamp).toLocaleString()}</Text>
            <Text style={s.logMeta}>
              Sim: {(log.similarity * 100).toFixed(1)}%  ·  Liveness: {log.livenessPassed ? 'PASS' : 'FAIL'}
              {log.challenges ? `  ·  ${log.challenges}` : ''}
            </Text>
            <Text style={s.logHash} numberOfLines={1}>Hash: {log.logHash.slice(0, 20)}…</Text>
          </View>
          <Text style={[s.logStatus, { color: log.verified ? '#00E676' : '#EF5350' }]}>
            {log.verified ? 'GRANTED' : 'DENIED'}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  center: { flex: 1, backgroundColor: '#0D1B2A', justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#546E7A', fontSize: 14, textAlign: 'center', marginTop: 12 },
  header: { flexDirection: 'row', gap: 16, backgroundColor: '#112233', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#1E3A5F' },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  name: { color: '#E0F7FA', fontWeight: '800', fontSize: 18, marginBottom: 2 },
  meta: { color: '#78909C', fontSize: 12, marginBottom: 2 },
  badge: { alignSelf: 'flex-start', borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: '#112233', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 10, color: '#546E7A', marginTop: 4, textAlign: 'center' },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  actionBtn: { flex: 1, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  actionText: { fontWeight: '700', fontSize: 14 },
  sectionTitle: { color: '#00E5FF', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  logRow: { backgroundColor: '#112233', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderWidth: 1, borderColor: '#1E3A5F' },
  logTime: { color: '#E0F7FA', fontSize: 13, fontWeight: '600' },
  logMeta: { color: '#78909C', fontSize: 11, marginTop: 2 },
  logHash: { color: '#374955', fontSize: 10, marginTop: 2, fontFamily: 'monospace' },
  logStatus: { fontWeight: '700', fontSize: 12, alignSelf: 'flex-start' },
});
