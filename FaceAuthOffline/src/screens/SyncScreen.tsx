import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Switch, Alert, ActivityIndicator,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SyncManager } from '../storage/SyncManager';
import { FaceDB } from '../storage/FaceDB';

export default function SyncScreen() {
  const [isOnline, setIsOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState({ totalEnrolled: 0, pendingSync: 0, totalLogs: 0 });
  const [syncStatus, setSyncStatus] = useState(SyncManager.getStatus());
  const [showConfig, setShowConfig] = useState(false);

  // AWS config form
  const [region, setRegion] = useState('ap-south-1');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [enrollTable, setEnrollTable] = useState('face_enrollments');
  const [logsTable, setLogsTable] = useState('auth_logs');

  useEffect(() => {
    const unsub = NetInfo.addEventListener(s => {
      setIsOnline(!!(s.isConnected && s.isInternetReachable));
    });
    const interval = setInterval(async () => {
      setStats(await FaceDB.getStats());
      setSyncStatus(SyncManager.getStatus());
    }, 2000);
    return () => { unsub(); clearInterval(interval); };
  }, []);

  const handleManualSync = async () => {
    if (!isOnline) { Alert.alert('Offline', 'No internet connection available.'); return; }
    setSyncing(true);
    try {
      await SyncManager.syncNow();
      setStats(await FaceDB.getStats());
      setSyncStatus(SyncManager.getStatus());
      Alert.alert('Sync Complete', 'All records uploaded and old data purged.');
    } catch {
      Alert.alert('Sync Failed', 'Check your AWS configuration.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!accessKey || !secretKey || !s3Bucket) {
      Alert.alert('Missing Fields', 'Fill in Access Key, Secret Key and S3 Bucket.');
      return;
    }
    await SyncManager.saveConfig({
      region, accessKeyId: accessKey, secretAccessKey: secretKey,
      s3Bucket, dynamoEnrollmentsTable: enrollTable, dynamoLogsTable: logsTable,
    });
    Alert.alert('Saved', 'AWS configuration saved securely on device.');
    setShowConfig(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Network status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Network Status</Text>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: isOnline ? '#00E676' : '#EF5350' }]} />
          <Text style={styles.cardText}>{isOnline ? 'Online — Sync available' : 'Offline — Operating locally'}</Text>
        </View>
      </View>

      {/* Local data stats */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Local Data</Text>
        <StatRow label="Enrolled faces" value={stats.totalEnrolled} color="#00E5FF" />
        <StatRow label="Pending upload" value={stats.pendingSync} color="#FF6D00" />
        <StatRow label="Auth log entries" value={stats.totalLogs} color="#B388FF" />
      </View>

      {/* Last sync info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Last Sync</Text>
        <Text style={styles.cardText}>
          {syncStatus.lastSuccess
            ? `✅ ${new Date(syncStatus.lastSuccess).toLocaleString()}`
            : '—  Never synced'}
        </Text>
        {syncStatus.lastError ? (
          <Text style={[styles.cardText, { color: '#EF5350', marginTop: 4 }]}>
            ⚠️ {syncStatus.lastError}
          </Text>
        ) : null}
      </View>

      {/* Sync button */}
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, (!isOnline || syncing) && styles.btnDisabled]}
        onPress={handleManualSync}
        disabled={!isOnline || syncing}>
        {syncing
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>☁️  Sync Now & Purge Local</Text>}
      </TouchableOpacity>

      {/* Purge explanation */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          After a successful sync, records older than 7 days that have been
          uploaded to AWS S3 + DynamoDB are automatically removed from this
          device to free storage and comply with data minimisation principles.
        </Text>
      </View>

      {/* AWS Config toggle */}
      <TouchableOpacity
        style={[styles.btn, styles.btnSecondary]}
        onPress={() => setShowConfig(!showConfig)}>
        <Text style={styles.btnText}>⚙️  {showConfig ? 'Hide' : 'Configure'} AWS</Text>
      </TouchableOpacity>

      {showConfig && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>AWS Configuration</Text>
          <Text style={styles.fieldLabel}>Region</Text>
          <TextInput style={styles.input} value={region} onChangeText={setRegion} placeholder="ap-south-1" placeholderTextColor="#546E7A" />
          <Text style={styles.fieldLabel}>Access Key ID</Text>
          <TextInput style={styles.input} value={accessKey} onChangeText={setAccessKey} placeholder="AKIA..." placeholderTextColor="#546E7A" secureTextEntry />
          <Text style={styles.fieldLabel}>Secret Access Key</Text>
          <TextInput style={styles.input} value={secretKey} onChangeText={setSecretKey} placeholder="Secret key..." placeholderTextColor="#546E7A" secureTextEntry />
          <Text style={styles.fieldLabel}>S3 Bucket</Text>
          <TextInput style={styles.input} value={s3Bucket} onChangeText={setS3Bucket} placeholder="my-faceauth-bucket" placeholderTextColor="#546E7A" />
          <Text style={styles.fieldLabel}>Enrollments DynamoDB Table</Text>
          <TextInput style={styles.input} value={enrollTable} onChangeText={setEnrollTable} placeholderTextColor="#546E7A" />
          <Text style={styles.fieldLabel}>Auth Logs DynamoDB Table</Text>
          <TextInput style={styles.input} value={logsTable} onChangeText={setLogsTable} placeholderTextColor="#546E7A" />
          <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: 8 }]} onPress={handleSaveConfig}>
            <Text style={styles.btnText}>Save Configuration</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 }}>
      <Text style={{ color: '#78909C', fontSize: 14 }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#112233', borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: '#1E3A5F',
  },
  cardTitle: { color: '#00E5FF', fontWeight: '700', fontSize: 15, marginBottom: 10 },
  cardText: { color: '#B0BEC5', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  btn: {
    padding: 15, borderRadius: 12, alignItems: 'center',
    marginBottom: 12, flexDirection: 'row', justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#00BCD4' },
  btnSecondary: { backgroundColor: '#1565C0' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  infoBox: {
    backgroundColor: '#0A1929', borderRadius: 10, padding: 12,
    marginBottom: 14, borderWidth: 1, borderColor: '#1E3A5F',
  },
  infoText: { color: '#546E7A', fontSize: 12, lineHeight: 18 },
  input: {
    backgroundColor: '#0D1B2A', borderRadius: 8, padding: 12,
    color: '#E0F7FA', marginBottom: 10, borderWidth: 1, borderColor: '#1E3A5F', fontSize: 13,
  },
  fieldLabel: { color: '#78909C', fontSize: 12, marginBottom: 4, marginTop: 4 },
});
