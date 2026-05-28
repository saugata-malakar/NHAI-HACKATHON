import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Switch, Alert, ActivityIndicator
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { FaceDB } from '../storage/FaceDB';
import { useAdminAuth } from '../utils/useAdminAuth';

export default function UserListScreen() {
  useAdminAuth();
  const nav = useNavigation<any>();
  const isFocused = useIsFocused();

  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await FaceDB.searchUsers(searchQuery);
      setUsers(data);
    } catch (err) {
      console.error('[UserListScreen] Error fetching users:', err);
      Alert.alert('Error', 'Failed to retrieve user registry records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isFocused) {
      fetchUsers();
    }
  }, [isFocused, searchQuery]);

  const handleToggleActive = async (user: any, newValue: boolean) => {
    try {
      await FaceDB.updateUserStatus(user.id, newValue);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: newValue ? 1 : 0 } : u));
    } catch (err) {
      Alert.alert('Error', 'Failed to update user status.');
    }
  };

  const renderUserItem = ({ item }: { item: any }) => {
    const isActive = item.active === 1;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => nav.navigate('UserDetail', { userId: item.id })}>
        <View style={styles.cardContent}>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{item.full_name}</Text>
            <Text style={styles.userMeta}>
              ID: {item.employee_id} • {item.department || 'No Dept'}
            </Text>
            <Text style={styles.userRole}>
              {item.designation || 'No Title'}
            </Text>
          </View>
          <View style={styles.actionColumn}>
            <View style={[styles.badge, isActive ? styles.badgeActive : styles.badgeInactive]}>
              <Text style={[styles.badgeText, isActive ? styles.badgeTextActive : styles.badgeTextInactive]}>
                {isActive ? 'ACTIVE' : 'SUSPENDED'}
              </Text>
            </View>
            <Switch
              value={isActive}
              onValueChange={(val) => handleToggleActive(item, val)}
              thumbColor={isActive ? '#00E5FF' : '#78909C'}
              trackColor={{ false: '#263238', true: '#1E3A5F' }}
            />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header bar actions */}
      <View style={styles.headerActions}>
        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => nav.navigate('BulkEnroll')}>
          <Text style={styles.btnText}>📥 CSV Bulk Import</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or employee ID..."
          placeholderTextColor="#78909C"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={() => setSearchQuery('')}>
            <Text style={styles.clearBtnText}>×</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && users.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00E5FF" />
          <Text style={styles.loadingText}>Searching database...</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderUserItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyText}>No users found</Text>
              <Text style={styles.emptySubtext}>
                {searchQuery ? 'Try adjusting your search query.' : 'Get started by importing users via CSV.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#112233',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    height: 48,
    color: '#E0F7FA',
    fontSize: 15,
  },
  clearBtn: {
    padding: 6,
  },
  clearBtnText: {
    color: '#78909C',
    fontSize: 22,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#112233',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    marginBottom: 12,
    padding: 16,
  },
  cardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
    marginRight: 12,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E0F7FA',
    marginBottom: 4,
  },
  userMeta: {
    fontSize: 12,
    color: '#B0BEC5',
    marginBottom: 2,
  },
  userRole: {
    fontSize: 11,
    color: '#78909C',
  },
  actionColumn: {
    alignItems: 'flex-end',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
  },
  badgeInactive: {
    backgroundColor: 'rgba(239, 83, 80, 0.15)',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  badgeTextActive: {
    color: '#00E676',
  },
  badgeTextInactive: {
    color: '#EF5350',
  },
  btnSecondary: {
    backgroundColor: '#1565C0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  loadingText: {
    color: '#78909C',
    fontSize: 14,
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E0F7FA',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#78909C',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 40,
  },
});
