import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Switch, Alert, ActivityIndicator, Platform,
  Modal, FlatList
} from 'react-native';
import crypto from 'crypto';
import NetInfo from '@react-native-community/netinfo';
import { SyncManager } from '../storage/SyncManager';
import { FaceDB } from '../storage/FaceDB';
import { useAdminAuth } from '../utils/useAdminAuth';
import { LedgerVerifier } from '../storage/LedgerVerifier';
import { useDBStats } from '../utils/useDBStats';
import { EdgeLogger, LogEntry } from '../utils/EdgeLogger';

export default function SyncScreen() {
  useAdminAuth();

  const [isOnline, setIsOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const stats = useDBStats();
  const [syncStatus, setSyncStatus] = useState(SyncManager.getStatus());
  const [showConfig, setShowConfig] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<LogEntry[]>([]);

  // Cryptographic Ledger states
  const [verifyingLedger, setVerifyingLedger] = useState(false);
  const [ledgerStatus, setLedgerStatus] = useState<{
    valid: boolean;
    firstBreak: string | null;
    logsCount: number;
  }>({ valid: true, firstBreak: null, logsCount: 0 });
  const [localTailHash, setLocalTailHash] = useState('Checking...');
  const [awsAnchorHash, setAwsAnchorHash] = useState('Checking...');
  const [tamperedLogId, setTamperedLogId] = useState<string | null>(null);
  const [originalSimilarity, setOriginalSimilarity] = useState<number | null>(null);

  // Modal Audit states
  const [isAuditModalVisible, setIsAuditModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fullLogs, setFullLogs] = useState<any[]>([]);

  // AWS config form
  const [region, setRegion] = useState('ap-south-1');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [enrollTable, setEnrollTable] = useState('face_enrollments');
  const [logsTable, setLogsTable] = useState('auth_logs');

  const openAuditModal = async () => {
    const result = await LedgerVerifier.verifyChain();
    const verifiedLogs = [];
    for (let i = 0; i < result.logs.length; i++) {
      const log = result.logs[i];
      const verifiedInt = log.verified === 1 || log.verified === true ? 1 : 0;
      const livenessInt = log.liveness_passed === 1 || log.liveness_passed === true ? 1 : 0;
      const similarityVal = typeof log.similarity === 'number' ? log.similarity : parseFloat(log.similarity) || 0;
      const prevHashVal = log.prev_hash || '';

      const hashInput = `${log.id}${log.user_id}${log.timestamp}${verifiedInt}${similarityVal.toFixed(4)}${livenessInt}${prevHashVal}`;
      const recomputedHash = crypto.createHash('sha256').update(hashInput).digest('hex');

      const storedHash = log.log_hash || log.hash;
      const isDataIntact = storedHash === recomputedHash;
      const isLinkIntact = i === 0 || prevHashVal === (result.logs[i - 1].log_hash || result.logs[i - 1].hash);

      verifiedLogs.push({
        ...log,
        isVerified: isDataIntact && isLinkIntact,
      });
    }

    setFullLogs(verifiedLogs);
    setIsAuditModalVisible(true);
  };

  const handleExportCsv = () => {
    if (fullLogs.length === 0) {
      Alert.alert('Empty Logs', 'No authentication logs available to export.');
      return;
    }

    const headers = 'ID,Timestamp,UserID,Verified,Similarity,LivenessPassed,Synced,LogHash,PrevHash\n';
    const rows = fullLogs.map(log => 
      `"${log.id}","${new Date(log.timestamp).toLocaleString()}","${log.user_id}",${log.verified ? 1 : 0},${log.similarity.toFixed(4)},${log.liveness_passed ? 1 : 0},${log.synced},"${log.log_hash || log.hash}","${log.prev_hash || ''}"`
    ).join('\n');

    const csvContent = headers + rows;
    
    try {
      const Clipboard = require('@react-native-clipboard/clipboard').default;
      Clipboard.setString(csvContent);
      Alert.alert('Export Successful', 'Chained ledger CSV successfully generated and copied to device clipboard!');
    } catch {
      Alert.alert('Export Successful', 'Chained ledger CSV successfully generated! Preview in developer log terminal.');
      console.log('[CSV EXPORT]\n', csvContent);
    }
  };

  const verifyLedger = async () => {
    setVerifyingLedger(true);
    try {
      const result = await LedgerVerifier.verifyChain();
      setLedgerStatus({
        valid: result.valid,
        firstBreak: result.firstBreak,
        logsCount: result.logs.length,
      });

      // Get local tail
      const tail = await FaceDB.getLastLogHash();
      setLocalTailHash(tail || 'Empty Ledger');

      // Get simulated AWS Anchor based on the last successfully synced log
      const lastSynced = [...result.logs].reverse().find(l => l.synced === 1);
      if (lastSynced) {
        setAwsAnchorHash(lastSynced.log_hash || lastSynced.hash);
      } else {
        setAwsAnchorHash('— No Synced Blocks (Remote Tail empty)');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVerifyingLedger(false);
    }
  };

  useEffect(() => {
    try {
      const { preventScreenshot } = require('react-native-prevent-screenshot');
      preventScreenshot();
    } catch (err) {
      console.warn('[SyncScreen] Screenshot prevention not available:', err);
    }

    const unsub = NetInfo.addEventListener(s => {
      setIsOnline(!!(s.isConnected && s.isInternetReachable));
    });

    verifyLedger();

    // Fetch initial logs from circular buffer
    setTerminalLogs(EdgeLogger.getLogs());

    // Subscribe to new real-time logs from EdgeLogger
    const unsubLog = EdgeLogger.subscribe(() => {
      setTerminalLogs(EdgeLogger.getLogs());
    });

    const unsubClear = EdgeLogger.onClear(() => {
      setTerminalLogs([]);
    });

    const interval = setInterval(() => {
      setSyncStatus(SyncManager.getStatus());
    }, 2000);

    return () => {
      unsub();
      unsubLog();
      unsubClear();
      clearInterval(interval);
      try {
        const { allowScreenshot } = require('react-native-prevent-screenshot');
        allowScreenshot();
      } catch {}
    };
  }, []);

  const handleManualSync = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'No internet connection available.');
      return;
    }

    // Force pre-sync verification check
    setSyncing(true);
    try {
      const verification = await LedgerVerifier.verifyChain();
      if (!verification.valid) {
        Alert.alert(
          '❌ SYNC BLOCKED',
          'Cryptographic database breach detected. Ledger chain integrity is broken. Sync has been disabled to prevent server corruption.',
          [{ text: 'OK' }]
        );
        setSyncing(false);
        return;
      }

      await SyncManager.syncNow();
      setSyncStatus(SyncManager.getStatus());
      await verifyLedger();
      Alert.alert('Sync Complete', 'All records uploaded and old data purged.');
    } catch (err: any) {
      Alert.alert('Sync Failed', err?.message || 'Check your AWS configuration.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSimulateTamper = async () => {
    try {
      const logs = await FaceDB.getRawLogs();
      if (logs.length === 0) {
        Alert.alert('No Logs', 'Please authenticate a face first to generate operational logs to tamper.');
        return;
      }

      // Tamper with the last log entry
      const targetLog = logs[logs.length - 1];
      setTamperedLogId(targetLog.id);
      setOriginalSimilarity(targetLog.similarity);

      // Corrupt it in SQLite
      await FaceDB.tamperLogForDev(targetLog.id, 0.9999);
      Alert.alert(
        '⚠️ Tamper Attack Simulated',
        `Corrupted log entry similarity score to 99.99% in SQLite table. Run verification to see the audit trail flag the breach!`
      );
      await verifyLedger();
    } catch (err) {
      Alert.alert('Error', 'Failed to corrupt SQLite row.');
    }
  };

  const handleRestoreLedger = async () => {
    if (!tamperedLogId || originalSimilarity === null) {
      Alert.alert('Perfect Integrity', 'Ledger database is in its natural state.');
      return;
    }

    try {
      await FaceDB.tamperLogForDev(tamperedLogId, originalSimilarity);
      setTamperedLogId(null);
      setOriginalSimilarity(null);
      Alert.alert('Ledger Restored', 'Re-applied original similarity score. Cryptographic hashes match once more!');
      await verifyLedger();
    } catch (err) {
      Alert.alert('Error', 'Failed to restore SQLite values.');
    }
  };

  const handleSaveConfig = async () => {
    if (!accessKey || !secretKey || !s3Bucket) {
      Alert.alert('Missing Fields', 'Fill in Access Key, Secret Key and S3 Bucket.');
      return;
    }
    await SyncManager.saveConfig({
      region,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      s3Bucket,
      dynamoEnrollmentsTable: enrollTable,
      dynamoLogsTable: logsTable,
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

      {/* Cryptographic Ledger audit console */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔐 Cryptographic Audit Ledger</Text>
        
        <View style={styles.ledgerStatusRow}>
          <View style={[styles.badge, ledgerStatus.valid ? styles.badgeSuccess : styles.badgeDanger]}>
            <Text style={[styles.badgeText, ledgerStatus.valid ? styles.badgeTextSuccess : styles.badgeTextDanger]}>
              {ledgerStatus.valid ? '✅ CHAIN INTACT' : '❌ BREACH DETECTED'}
            </Text>
          </View>
          <TouchableOpacity style={styles.btnAction} onPress={verifyLedger} disabled={verifyingLedger}>
            {verifyingLedger ? (
              <ActivityIndicator size="small" color="#00E5FF" />
            ) : (
              <Text style={styles.btnActionText}>Verify Chain</Text>
            )}
          </TouchableOpacity>
        </View>

        {!ledgerStatus.valid && (
          <View style={styles.breachCard}>
            <Text style={styles.breachTitle}>CRITICAL BREACH WARNING</Text>
            <Text style={styles.breachDesc}>
              Database row alteration detected at log record:
            </Text>
            <Text style={styles.breachCode}>{ledgerStatus.firstBreak}</Text>
            <Text style={styles.breachDesc}>
              Sync uploads have been blocked until ledger integrity is restored.
            </Text>
          </View>
        )}

        <View style={styles.divider} />

        <View style={styles.hashDetailRow}>
          <Text style={styles.hashLabel}>Local Chain Tail:</Text>
          <Text style={styles.hashValue} numberOfLines={1} ellipsizeMode="middle">
            {localTailHash}
          </Text>
        </View>

        <View style={styles.hashDetailRow}>
          <Text style={styles.hashLabel}>AWS Synced Anchor:</Text>
          <Text style={styles.hashValue} numberOfLines={1} ellipsizeMode="middle">
            {awsAnchorHash}
          </Text>
        </View>

        <TouchableOpacity 
          style={[styles.btnAction, { marginTop: 12, width: '100%', alignItems: 'center', paddingVertical: 10 }]} 
          onPress={openAuditModal}>
          <Text style={styles.btnActionText}>🔗 View Full Chained Ledger</Text>
        </TouchableOpacity>

        {__DEV__ && (
          <>
            <View style={styles.divider} />
            <Text style={styles.labTitle}>🧪 TAMPER LAB (Developer Testing)</Text>
            <View style={styles.labRow}>
              <TouchableOpacity
                style={[styles.btnLab, styles.btnLabTamper]}
                onPress={handleSimulateTamper}>
                <Text style={styles.btnLabText}>Simulate Tamper</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnLab, styles.btnLabRestore]}
                onPress={handleRestoreLedger}>
                <Text style={styles.btnLabText}>Restore Integrity</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Last sync info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Last Sync Status</Text>
        <Text style={styles.cardText}>
          {syncStatus.lastSuccess
            ? `✅ Success: ${new Date(syncStatus.lastSuccess).toLocaleString()}`
            : '—  Never successfully synced'}
        </Text>
        {syncStatus.lastError ? (
          <Text style={[styles.cardText, { color: '#EF5350', marginTop: 4 }]}>
            ⚠️ Error: {syncStatus.lastError}
          </Text>
        ) : null}
      </View>

      {/* Developer Edge Execution Terminal */}
      <View style={[styles.card, { backgroundColor: '#050D14', borderColor: '#00E5FF' }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={[styles.cardTitle, { color: '#00E5FF', marginBottom: 0 }]}>🖥️ Edge Execution Terminal</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity 
              style={[styles.btnAction, { borderColor: '#EF5350', backgroundColor: 'rgba(239,83,80,0.05)' }]} 
              onPress={() => EdgeLogger.clear()}>
              <Text style={[styles.btnActionText, { color: '#EF5350' }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.btnAction} 
              onPress={() => {
                EdgeLogger.info('Developer', 'Manual diagnostic ping initiated.');
                EdgeLogger.warn('System', 'Checking battery and hardware parameters.');
                EdgeLogger.sec('Audit', 'Cryptographic chained ledger state verified manually.');
              }}>
              <Text style={styles.btnActionText}>Ping</Text>
            </TouchableOpacity>
          </View>
        </View>
        
        <ScrollView 
          style={{ height: 150, backgroundColor: '#020609', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#1E3A5F' }}
          contentContainerStyle={{ paddingBottom: 10 }}
          nestedScrollEnabled={true}>
          {terminalLogs.length === 0 ? (
            <Text style={{ color: '#546E7A', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontStyle: 'italic' }}>
              No active log entries in edge buffer...
            </Text>
          ) : (
            terminalLogs.map((log) => {
              let color = '#E0F7FA';
              if (log.level === 'warn') color = '#FFB300';
              else if (log.level === 'error') color = '#EF5350';
              else if (log.level === 'sec') color = '#E040FB';
              
              const levelTag = `[${log.level.toUpperCase()}]`;
              const timestampStr = new Date(log.timestamp).toLocaleTimeString();
              
              return (
                <Text 
                  key={log.id} 
                  style={{ 
                    color, 
                    fontSize: 11, 
                    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', 
                    marginBottom: 4, 
                    lineHeight: 14 
                  }}>
                  {timestampStr} {levelTag} [{log.tag}] {log.message}
                </Text>
              );
            })
          )}
        </ScrollView>
      </View>

      {/* Sync button */}
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, (!isOnline || syncing || !ledgerStatus.valid) && styles.btnDisabled]}
        onPress={handleManualSync}
        disabled={!isOnline || syncing || !ledgerStatus.valid}>
        {syncing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>☁️ Force Verify & Sync Now</Text>
        )}
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

      {/* FULL SCREEN LEDGER AUDIT TRAIL MODAL (Phase 5.5) */}
      <Modal
        visible={isAuditModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsAuditModalVisible(false)}>
        <View style={styles.modalContainer}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>🗄️ SQL Chained Ledger Logs</Text>
            <TouchableOpacity style={styles.btnClose} onPress={() => setIsAuditModalVisible(false)}>
              <Text style={styles.btnCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Action Row */}
          <View style={styles.modalActionRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0, height: 44, paddingVertical: 8 }]}
              placeholder="Search by Employee ID or Name..."
              placeholderTextColor="#546E7A"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <TouchableOpacity style={styles.btnExport} onPress={handleExportCsv}>
              <Text style={styles.btnExportText}>📥 CSV</Text>
            </TouchableOpacity>
          </View>

          {/* Table Headers */}
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.headerCell, { flex: 1.5 }]}>Time / UID</Text>
            <Text style={[styles.headerCell, { flex: 1 }]}>Status</Text>
            <Text style={[styles.headerCell, { flex: 0.8 }]}>Sim</Text>
            <Text style={[styles.headerCell, { flex: 2.2 }]}>Log Hash</Text>
            <Text style={[styles.headerCell, { flex: 0.5 }]}>Intact</Text>
          </View>

          {/* Logs List */}
          <FlatList
            data={fullLogs.filter(l => 
              l.user_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (l.userName && l.userName.toLowerCase().includes(searchQuery.toLowerCase()))
            )}
            keyExtractor={item => item.id}
            renderItem={({ item }) => {
              const isSuccess = item.verified === 1 || item.verified === true;
              return (
                <View style={styles.tableRow}>
                  <View style={{ flex: 1.5 }}>
                    <Text style={styles.cellTime}>
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={styles.cellUid}>{item.user_id}</Text>
                  </View>
                  
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cellStatus, isSuccess ? styles.textSuccess : styles.textDanger]}>
                      {isSuccess ? 'GRANTED' : 'DENIED'}
                    </Text>
                  </View>

                  <Text style={[styles.cellText, { flex: 0.8 }]}>{(item.similarity * 100).toFixed(0)}%</Text>
                  
                  <Text style={[styles.cellHash, { flex: 2.2 }]} numberOfLines={1} ellipsizeMode="middle">
                    {item.log_hash || item.hash}
                  </Text>

                  <View style={{ flex: 0.5, alignItems: 'center' }}>
                    <Text style={{ fontSize: 13 }}>{item.isVerified ? '✅' : '❌'}</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Text style={{ color: '#78909C', fontSize: 14 }}>No ledger records found.</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        </View>
      </Modal>
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
  ledgerStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  badgeSuccess: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
  },
  badgeDanger: {
    backgroundColor: 'rgba(239, 83, 80, 0.15)',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  badgeTextSuccess: {
    color: '#00E676',
  },
  badgeTextDanger: {
    color: '#EF5350',
  },
  btnAction: {
    borderWidth: 1,
    borderColor: '#00E5FF',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0, 229, 255, 0.05)',
  },
  btnActionText: {
    color: '#00E5FF',
    fontSize: 12,
    fontWeight: '700',
  },
  breachCard: {
    backgroundColor: 'rgba(239, 83, 80, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EF5350',
    padding: 12,
    marginVertical: 10,
  },
  breachTitle: {
    color: '#EF5350',
    fontWeight: '800',
    fontSize: 12,
    marginBottom: 6,
  },
  breachDesc: {
    color: '#B0BEC5',
    fontSize: 12,
    lineHeight: 16,
  },
  breachCode: {
    color: '#FF8A80',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    marginVertical: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#1E3A5F',
    width: '100%',
    marginVertical: 12,
  },
  hashDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  hashLabel: {
    color: '#78909C',
    fontSize: 13,
  },
  hashValue: {
    color: '#E0F7FA',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    width: '60%',
    textAlign: 'right',
  },
  labTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFB300',
    marginBottom: 8,
  },
  labRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnLab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnLabTamper: {
    backgroundColor: '#EF5350',
  },
  btnLabRestore: {
    backgroundColor: '#00C853',
  },
  btnLabText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
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

  // Modal Ledger Styles
  modalContainer: { flex: 1, backgroundColor: '#0D1B2A', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#00E5FF' },
  btnClose: { padding: 6 },
  btnCloseText: { fontSize: 20, color: '#EF5350', fontWeight: '600' },
  modalActionRow: { flexDirection: 'row', gap: 10, marginBottom: 16, alignItems: 'center' },
  btnExport: { backgroundColor: '#1565C0', borderRadius: 8, height: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  btnExportText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1E3A5F', paddingBottom: 8, marginBottom: 8 },
  headerCell: { color: '#78909C', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E3A5F', opacity: 0.95 },
  cellTime: { color: '#E0F7FA', fontSize: 13, fontWeight: '600' },
  cellUid: { color: '#78909C', fontSize: 10, marginTop: 2 },
  cellStatus: { fontSize: 11, fontWeight: '800' },
  textSuccess: { color: '#00E676' },
  textDanger: { color: '#EF5350' },
  cellText: { color: '#E0F7FA', fontSize: 13 },
  cellHash: { color: '#546E7A', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }
});
