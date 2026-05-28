import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Switch, Alert, ActivityIndicator, FlatList, Platform
} from 'react-native';
import { useNavigation, useRoute, useIsFocused } from '@react-navigation/native';
import { FaceDB } from '../storage/FaceDB';
import { useAdminAuth } from '../utils/useAdminAuth';

export default function UserDetailScreen() {
  useAdminAuth();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const { userId } = route.params || {};

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserDetail = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await FaceDB.getUserDetail(userId);
      setUser(data);
    } catch (err) {
      console.error('[UserDetailScreen] Error fetching user:', err);
      Alert.alert('Error', 'Failed to retrieve user details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    try {
      const { preventScreenshot } = require('react-native-prevent-screenshot');
      preventScreenshot();
    } catch (err) {
      console.warn('[UserDetailScreen] Screenshot prevention not available:', err);
    }

    if (isFocused) {
      fetchUserDetail();
    }

    return () => {
      try {
        const { allowScreenshot } = require('react-native-prevent-screenshot');
        allowScreenshot();
      } catch {}
    };
  }, [isFocused, userId]);

  const handleToggleActive = async (newValue: boolean) => {
    if (!user) return;
    try {
      await FaceDB.updateUserStatus(user.id, newValue);
      setUser((prev: any) => prev ? { ...prev, active: newValue } : null);
    } catch (err) {
      Alert.alert('Error', 'Failed to update user status.');
    }
  };

  const handleForceReenroll = () => {
    if (!user) return;
    Alert.alert(
      '⚠️ Purge Biometrics & Re-enroll',
      `Are you sure you want to delete all local biometrics for ${user.full_name}? This action is irreversible. The user's metadata and authentication logs will be preserved, but their face will need to be re-enrolled before they can authenticate again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Purge Biometrics',
          style: 'destructive',
          onPress: async () => {
            try {
              await FaceDB.deleteUserBiometrics(user.id);
              Alert.alert('Purged', 'Local biometrics successfully purged from SQLite. User active status set to suspended.');
              fetchUserDetail();
            } catch (err) {
              Alert.alert('Error', 'Failed to purge biometric templates.');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00E5FF" />
        <Text style={styles.loadingText}>Retrieving record details...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>User record not found.</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={() => nav.goBack()}>
          <Text style={styles.btnText}>Return to Registry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
          </Text>
        </View>
        <Text style={styles.userName}>{user.full_name}</Text>
        <Text style={styles.userTitle}>
          {user.designation ? `${user.designation} • ` : ''}{user.department || 'No Department'}
        </Text>

        <View style={styles.divider} />

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Employee ID</Text>
          <Text style={styles.metaValue}>{user.employee_id}</Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Enrolled At</Text>
          <Text style={styles.metaValue}>
            {user.enrolled_at ? new Date(user.enrolled_at).toLocaleString() : 'N/A'}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Local Registry ID</Text>
          <Text style={styles.metaValueCode}>{user.id}</Text>
        </View>
      </View>

      {/* Control Actions Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Administrative Controls</Text>
        
        <View style={styles.controlRow}>
          <View style={styles.controlInfo}>
            <Text style={styles.controlLabel}>Account Authentication Status</Text>
            <Text style={styles.controlDescription}>
              {user.active ? 'Active — Allow offline biometric verification' : 'Suspended — Reject all logins'}
            </Text>
          </View>
          <Switch
            value={user.active}
            onValueChange={handleToggleActive}
            thumbColor={user.active ? '#00E5FF' : '#78909C'}
            trackColor={{ false: '#263238', true: '#1E3A5F' }}
          />
        </View>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.btnDanger} onPress={handleForceReenroll}>
          <Text style={styles.btnDangerText}>⚠️ Purge Biometrics & Force Re-enrollment</Text>
        </TouchableOpacity>
      </View>

      {/* History Log Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Biometric Log History</Text>
        {user.logs && user.logs.length > 0 ? (
          user.logs.map((log: any) => {
            const isSuccess = log.verified === 1 || log.verified === true;
            return (
              <View key={log.id} style={styles.logItem}>
                <View style={styles.logHeader}>
                  <View style={[styles.logIndicator, { backgroundColor: isSuccess ? '#00E676' : '#EF5350' }]} />
                  <Text style={styles.logResult}>
                    {isSuccess ? 'Verified Success' : 'Authentication Failed'}
                  </Text>
                  <Text style={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Text style={styles.logMeta}>
                  Similarity: <Text style={styles.logValue}>{(log.similarity * 100).toFixed(1)}%</Text> • Liveness: <Text style={styles.logValue}>{log.liveness_passed ? 'PASSED' : 'FAILED'}</Text>
                </Text>
                <Text style={styles.logHash}>Hash: {log.hash.substring(0, 16)}...</Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.emptyLogsText}>No offline authentication attempts logged for this user.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D1B2A', padding: 24 },
  loadingText: { color: '#78909C', fontSize: 14, marginTop: 12 },
  errorText: { color: '#EF5350', fontSize: 16, fontWeight: '600', marginBottom: 20 },
  profileCard: {
    backgroundColor: '#112233',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E3A5F',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#00E5FF',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#00E5FF',
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#E0F7FA',
    marginBottom: 6,
  },
  userTitle: {
    fontSize: 14,
    color: '#B0BEC5',
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#1E3A5F',
    width: '100%',
    marginVertical: 16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
  },
  metaLabel: {
    fontSize: 13,
    color: '#78909C',
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E0F7FA',
  },
  metaValueCode: {
    fontSize: 11,
    color: '#00E5FF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  card: {
    backgroundColor: '#112233',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#00E5FF',
    marginBottom: 16,
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  controlInfo: {
    flex: 1,
    marginRight: 16,
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E0F7FA',
    marginBottom: 4,
  },
  controlDescription: {
    fontSize: 12,
    color: '#B0BEC5',
  },
  btnDanger: {
    borderWidth: 1,
    borderColor: '#EF5350',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(239, 83, 80, 0.05)',
  },
  btnDangerText: {
    color: '#EF5350',
    fontWeight: '700',
    fontSize: 13,
  },
  btnPrimary: {
    backgroundColor: '#00BCD4',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  btnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  logItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#1E3A5F',
    paddingVertical: 12,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  logIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  logResult: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E0F7FA',
    flex: 1,
  },
  logTime: {
    fontSize: 11,
    color: '#78909C',
  },
  logMeta: {
    fontSize: 12,
    color: '#B0BEC5',
    marginBottom: 4,
  },
  logValue: {
    color: '#00E5FF',
    fontWeight: '600',
  },
  logHash: {
    fontSize: 10,
    color: '#546E7A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  emptyLogsText: {
    color: '#78909C',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
