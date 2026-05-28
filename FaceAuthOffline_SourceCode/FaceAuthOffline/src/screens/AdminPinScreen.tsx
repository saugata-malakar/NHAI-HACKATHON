/**
 * AdminPinScreen
 * First launch: set a 6-digit PIN (SHA-256 hashed before storage).
 * Subsequent visits: verify PIN to grant admin session.
 * Called from useAdminAuth when session has expired.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, Alert,
} from 'react-native';
import Crypto from 'react-native-crypto';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { FaceDB } from '../storage/FaceDB';
import { markAdminAuthed } from '../hooks/useAdminAuth';
import { SecurityService } from '../services/SecurityService';
import type { RootStackParamList } from '../navigation/AppNavigator';

type RouteP = RouteProp<RootStackParamList, 'AdminPin'>;

function hashPin(pin: string): string {
  const h = Crypto.createHash('sha256');
  h.update(pin, 'utf8');
  return h.digest('hex');
}

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export default function AdminPinScreen() {
  const nav    = useNavigation<any>();
  const route  = useRoute<RouteP>();
  const { onSuccess, title } = route.params ?? {};

  const [mode, setMode]       = useState<'setup' | 'verify' | 'confirm'>('verify');
  const [pin, setPin]         = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [shake, setShake]     = useState(false);
  const MAX_ATTEMPTS = 5;

  useEffect(() => {
    (async () => {
      const stored = await FaceDB.getSetting('admin_pin_hash');
      setMode(stored ? 'verify' : 'setup');
    })();
  }, []);

  const triggerShake = () => {
    setShake(true);
    Vibration.vibrate(300);
    setTimeout(() => setShake(false), 600);
  };

  const press = (key: string) => {
    SecurityService.recordActivity();
    if (key === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (key === '') return;
    const next = pin + key;
    if (next.length > 6) return;
    setPin(next);
    if (next.length === 6) setTimeout(() => handleComplete(next), 120);
  };

  const handleComplete = async (p: string) => {
    const hash = hashPin(p);

    if (mode === 'setup') {
      setFirstPin(p);
      setPin('');
      setMode('confirm');
      return;
    }

    if (mode === 'confirm') {
      if (p === firstPin) {
        await FaceDB.setSetting('admin_pin_hash', hash);
        markAdminAuthed();
        nav.goBack();
        onSuccess?.();
      } else {
        triggerShake();
        setPin('');
        setFirstPin('');
        setMode('setup');
        Alert.alert('PINs do not match', 'Please set your PIN again.');
      }
      return;
    }

    // verify mode
    const stored = await FaceDB.getSetting('admin_pin_hash');
    if (hash === stored) {
      markAdminAuthed();
      setAttempts(0);
      nav.goBack();
      onSuccess?.();
    } else {
      const next = attempts + 1;
      setAttempts(next);
      triggerShake();
      setPin('');
      if (next >= MAX_ATTEMPTS) {
        Alert.alert('Too many attempts', 'Access locked for 5 minutes.', [{ text: 'OK' }]);
      }
    }
  };

  const dots = Array.from({ length: 6 }, (_, i) => i < pin.length);
  const modeLabel = mode === 'setup'   ? 'Create Admin PIN'
                  : mode === 'confirm' ? 'Confirm PIN'
                  : (title ?? 'Admin Verification');

  return (
    <View style={s.container}>
      <Text style={s.title}>{modeLabel}</Text>
      {mode === 'verify' && (
        <Text style={s.sub}>
          {attempts > 0 ? `${MAX_ATTEMPTS - attempts} attempts remaining` : 'Enter your 6-digit admin PIN'}
        </Text>
      )}
      {mode === 'setup'   && <Text style={s.sub}>Choose a 6-digit PIN to protect admin features</Text>}
      {mode === 'confirm' && <Text style={s.sub}>Re-enter your PIN to confirm</Text>}

      <View style={[s.dots, shake && s.shake]}>
        {dots.map((filled, i) => (
          <View key={i} style={[s.dot, filled && s.dotFilled]} />
        ))}
      </View>

      <View style={s.grid}>
        {KEYS.map((k, i) => (
          <TouchableOpacity
            key={i}
            style={[s.key, k === '' && s.keyEmpty]}
            onPress={() => press(k)}
            disabled={k === '' || attempts >= MAX_ATTEMPTS}
            activeOpacity={0.6}>
            <Text style={s.keyText}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: '#00E5FF', marginBottom: 8 },
  sub: { fontSize: 13, color: '#78909C', marginBottom: 36, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 14, marginBottom: 48 },
  shake: { transform: [{ translateX: 10 }] },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#00E5FF', backgroundColor: 'transparent' },
  dotFilled: { backgroundColor: '#00E5FF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 264, gap: 12, justifyContent: 'center' },
  key: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#112233', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  keyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { fontSize: 26, fontWeight: '600', color: '#E0F7FA' },
});
