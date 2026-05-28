/**
 * UserListScreen — Searchable personnel registry.
 * Lists all enrolled users with active/suspended toggle and nav to profile.
 * Admin PIN required to access.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Switch, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { FaceDB, UserRecord } from '../storage/FaceDB';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { SecurityService } from '../services/SecurityService';

export default function UserListScreen() {
  const nav = useNavigation<any>();
  const { requireAdmin } = useAdminAuth();
  const [users, setUsers]   = useState<UserRecord[]>([]);
  const [query, setQuery]   = useState('');
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    requireAdmin(loadUsers);
  }, []));

  const loadUsers = async () => {
    setLoading(true);
    try {
      const all = query.trim()
        ? await FaceDB.searchUsers(query)
        : await FaceDB.getUsers();
      setUsers(all);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const t = setTimeout(loadUsers, 250);
    return () => clearTimeout(t);
  }, [query]);

  const toggleActive = (user: UserRecord) => {
    requireAdmin(async () => {
      const next = !user.active;
      Alert.alert(
        next ? 'Activate User' : 'Suspend User',
        `${next ? 'Activate' : 'Suspend'} ${user.fullName}? ${!next ? 'They will not be recognizable until reactivated.' : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', style: next ? 'default' : 'destructive', onPress: async () => {
            await FaceDB.setUserActive(user.id, next);
            SecurityService.recordActivity();
            await loadUsers();
          }},
        ],
      );
    });
  };

  const renderItem = ({ item }: { item: UserRecord }) => (
    <TouchableOpacity
      style={[s.row, !item.active && s.rowInactive]}
      onPress={() => nav.navigate('UserDetail', { userId: item.id })}
      activeOpacity={0.75}>
      <View style={[s.avatar, { backgroundColor: item.active ? '#00BCD4' : '#546E7A' }]}>
        <Text style={s.avatarText}>{item.fullName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={s.info}>
        <Text style={s.name}>{item.fullName}</Text>
        <Text style={s.meta}>{item.employeeId}  ·  {item.department || '—'}</Text>
        <Text style={s.enrolled}>Enrolled {new Date(item.enrolledAt).toLocaleDateString()}</Text>
      </View>
      <Switch
        value={item.active}
        onValueChange={() => toggleActive(item)}
        trackColor={{ false: '#263238', true: '#00897B' }}
        thumbColor={item.active ? '#00E5FF' : '#546E7A'}
      />
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      <View style={s.searchRow}>
        <TextInput
          style={s.search}
          placeholder="Search name, ID, department…"
          placeholderTextColor="#546E7A"
          value={query}
          onChangeText={setQuery}
          onFocus={() => SecurityService.recordActivity()}
        />
      </View>
      <View style={s.headerRow}>
        <Text style={s.headerCount}>{users.length} user{users.length !== 1 ? 's' : ''}</Text>
        <TouchableOpacity
          style={s.bulkBtn}
          onPress={() => requireAdmin(() => nav.navigate('BulkEnroll'))}>
          <Text style={s.bulkBtnText}>⬆ CSV Import</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => requireAdmin(() => nav.navigate('Enroll', {}))}>
          <Text style={s.addBtnText}>+ Enroll</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={users}
        keyExtractor={u => u.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshing={loading}
        onRefresh={loadUsers}
        ListEmptyComponent={
          <Text style={s.empty}>{loading ? 'Loading…' : 'No users found'}</Text>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  searchRow: { padding: 12, paddingBottom: 4 },
  search: { backgroundColor: '#112233', borderRadius: 10, padding: 12, color: '#E0F7FA', borderWidth: 1, borderColor: '#1E3A5F', fontSize: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  headerCount: { flex: 1, color: '#546E7A', fontSize: 13 },
  bulkBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  bulkBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  addBtn: { backgroundColor: '#00BCD4', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#112233', marginHorizontal: 12, marginVertical: 4, borderRadius: 12, padding: 12, gap: 12, borderWidth: 1, borderColor: '#1E3A5F' },
  rowInactive: { opacity: 0.5 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  info: { flex: 1 },
  name: { color: '#E0F7FA', fontWeight: '700', fontSize: 15 },
  meta: { color: '#78909C', fontSize: 12, marginTop: 2 },
  enrolled: { color: '#546E7A', fontSize: 11, marginTop: 2 },
  empty: { textAlign: 'center', color: '#546E7A', marginTop: 60, fontSize: 15 },
});
