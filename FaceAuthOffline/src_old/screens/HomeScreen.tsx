import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { Platform } from 'react-native';
import { ModelLoader } from '../ml/ModelLoader';
import { FaceDB } from '../storage/FaceDB';
import { useDBStats } from '../utils/useDBStats';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  const [modelsReady, setModelsReady] = useState(false);
  const stats = useDBStats();

  useEffect(() => {
    const interval = setInterval(() => {
      setModelsReady(ModelLoader.isReady());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const requestCameraPermission = async () => {
    const perm = Platform.OS === 'android'
      ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA;
    const status = await check(perm);
    if (status !== RESULTS.GRANTED) {
      await request(perm);
    }
  };

  const goToEnroll = async () => {
    await requestCameraPermission();
    nav.navigate('Enroll', {});
  };

  const goToAuth = async () => {
    if (stats.totalEnrolled === 0) {
      Alert.alert('No Faces Enrolled', 'Please enroll at least one face before authenticating.');
      return;
    }
    await requestCameraPermission();
    nav.navigate('Auth');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>🔐</Text>
        <Text style={styles.heroTitle}>FaceAuth Offline</Text>
        <Text style={styles.heroSub}>Secure · Lightweight · 100% Offline</Text>
      </View>

      {/* Model status */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: modelsReady ? '#00E676' : '#FF6D00' }]} />
          <Text style={styles.statusText}>
            {modelsReady ? 'AI Models Ready (≈7.1 MB)' : 'Loading AI Models…'}
          </Text>
          {!modelsReady && <ActivityIndicator color="#00E5FF" size="small" style={{ marginLeft: 8 }} />}
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Enrolled', value: stats.totalEnrolled, color: '#00E5FF' },
          { label: 'Pending Sync', value: stats.pendingSync, color: '#FF6D00' },
          { label: 'Auth Logs', value: stats.totalLogs, color: '#B388FF' },
        ].map(s => (
          <View key={s.label} style={styles.statCard}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Action buttons */}
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, !modelsReady && styles.btnDisabled]}
        onPress={goToAuth}
        disabled={!modelsReady}>
        <Text style={styles.btnText}>🎯  Authenticate</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnSecondary, !modelsReady && styles.btnDisabled]}
        onPress={goToEnroll}
        disabled={!modelsReady}>
        <Text style={styles.btnText}>➕  Enroll New Face</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnRegistry]}
        onPress={() => nav.navigate('UserList')}>
        <Text style={styles.btnText}>👥  Manage Registry</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnTertiary]}
        onPress={() => nav.navigate('Sync')}>
        <Text style={styles.btnText}>☁️  Sync Status</Text>
      </TouchableOpacity>

      {/* Info strip */}
      <View style={styles.infoStrip}>
        <Text style={styles.infoText}>
          All biometric data is processed and stored locally on this device.
          No internet connection required for face recognition.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  content: { padding: 20, paddingBottom: 40 },
  hero: { alignItems: 'center', marginVertical: 28 },
  heroIcon: { fontSize: 60 },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#00E5FF', marginTop: 8 },
  heroSub: { fontSize: 14, color: '#78909C', marginTop: 4 },
  statusCard: {
    backgroundColor: '#112233', borderRadius: 12, padding: 14,
    marginBottom: 16, borderWidth: 1, borderColor: '#1E3A5F',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  statusText: { color: '#B0BEC5', fontSize: 14, flex: 1 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1, backgroundColor: '#112233', borderRadius: 12,
    padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F',
  },
  statValue: { fontSize: 28, fontWeight: '800' },
  statLabel: { fontSize: 11, color: '#78909C', marginTop: 4 },
  btn: {
    padding: 16, borderRadius: 14, alignItems: 'center',
    marginBottom: 12, flexDirection: 'row', justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#00BCD4' },
  btnSecondary: { backgroundColor: '#1565C0' },
  btnRegistry: { backgroundColor: '#4527A0' },
  btnTertiary: { backgroundColor: '#263238' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  infoStrip: {
    backgroundColor: '#112233', borderRadius: 10, padding: 14,
    marginTop: 8, borderWidth: 1, borderColor: '#1E3A5F',
  },
  infoText: { color: '#546E7A', fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
