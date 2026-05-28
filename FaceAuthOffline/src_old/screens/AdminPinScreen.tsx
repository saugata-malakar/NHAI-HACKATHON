/**
 * AdminPinScreen
 * Secure administrative gate keypad screen.
 * Handles:
 *  1. PIN Setup: Generates and saves a secure SHA-256 hashed PIN on first launch.
 *  2. PIN Verification: Validates enter key hash matches stored signature.
 *  3. Navigation Redirects: On success, unlocks the session and navigates back to target screen.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import crypto from 'crypto';
import { FaceDB } from '../storage/FaceDB';
import { AdminSession } from '../utils/AdminSession';

export default function AdminPinScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();

  const [pinHash, setPinHash] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isSetup, setIsSetup] = useState(false);
  const [setupStep, setSetupStep] = useState<'enter' | 'confirm'>('enter');

  const { returnTo, returnParams } = route.params || {};

  useEffect(() => {
    (async () => {
      const hash = await FaceDB.getAdminPinHash();
      setPinHash(hash);
      if (!hash) {
        setIsSetup(true);
      }
    })();
  }, []);

  const hashPINStr = (val: string): string => {
    return crypto.createHash('sha256').update(val).digest('hex');
  };

  const handleKeyPress = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
  };

  const handleSubmit = async () => {
    if (pin.length < 4) {
      Alert.alert('Invalid length', 'PIN must be at least 4 digits.');
      return;
    }

    if (isSetup) {
      if (setupStep === 'enter') {
        setConfirmPin(pin);
        setPin('');
        setSetupStep('confirm');
      } else {
        if (pin === confirmPin) {
          const hashed = hashPINStr(pin);
          await FaceDB.setAdminPinHash(hashed);
          AdminSession.authenticate();
          Alert.alert('Setup Complete', 'Admin PIN successfully created!', [
            { text: 'OK', onPress: proceed }
          ]);
        } else {
          Alert.alert('Mismatch', 'PINs do not match. Please try again.');
          setPin('');
          setSetupStep('enter');
        }
      }
    } else {
      const hashed = hashPINStr(pin);
      if (hashed === pinHash) {
        AdminSession.authenticate();
        proceed();
      } else {
        Alert.alert('Access Denied', 'Invalid administrative PIN.');
        setPin('');
      }
    }
  };

  const proceed = () => {
    if (returnTo) {
      nav.navigate(returnTo, returnParams);
    } else {
      nav.navigate('Home');
    }
  };

  const renderKey = (val: string) => (
    <TouchableOpacity style={styles.key} onPress={() => handleKeyPress(val)}>
      <Text style={styles.keyText}>{val}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🔐 Administrative Access</Text>
        <Text style={styles.subtitle}>
          {isSetup
            ? setupStep === 'enter'
              ? 'Create a secure Administrative PIN to shield settings'
              : 'Confirm your Administrative PIN'
            : 'Enter PIN to unlock administrative features'}
        </Text>
      </View>

      {/* PIN dots display */}
      <View style={styles.dotsContainer}>
        {Array.from({ length: isSetup && setupStep === 'confirm' ? confirmPin.length : 6 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < pin.length && styles.dotFilled,
            ]}
          />
        ))}
      </View>

      {/* Secure Keyboard Grid */}
      <View style={styles.keyboard}>
        <View style={styles.row}>
          {renderKey('1')}
          {renderKey('2')}
          {renderKey('3')}
        </View>
        <View style={styles.row}>
          {renderKey('4')}
          {renderKey('5')}
          {renderKey('6')}
        </View>
        <View style={styles.row}>
          {renderKey('7')}
          {renderKey('8')}
          {renderKey('9')}
        </View>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.key, styles.specialKey]} onPress={handleClear}>
            <Text style={styles.specialKeyText}>C</Text>
          </TouchableOpacity>
          {renderKey('0')}
          <TouchableOpacity style={[styles.key, styles.specialKey]} onPress={handleBackspace}>
            <Text style={styles.specialKeyText}>⌫</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
        <Text style={styles.submitBtnText}>
          {isSetup
            ? setupStep === 'enter'
              ? 'Continue'
              : 'Save PIN & Authenticate'
            : 'Verify Credentials'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => nav.navigate('Home')}>
        <Text style={styles.cancelBtnText}>Cancel & Exit</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A', padding: 24, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 30 },
  title: { fontSize: 24, fontWeight: '800', color: '#00E5FF', marginBottom: 12 },
  subtitle: { fontSize: 14, color: '#78909C', textAlign: 'center', lineHeight: 20 },
  dotsContainer: { flexDirection: 'row', gap: 16, marginBottom: 40, height: 20, justifyContent: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#00E5FF', backgroundColor: 'transparent' },
  dotFilled: { backgroundColor: '#00E5FF' },
  keyboard: { width: '85%', gap: 12, marginBottom: 40 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  key: {
    flex: 1, height: 60, borderRadius: 12, backgroundColor: '#112233',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F',
  },
  keyText: { fontSize: 22, fontWeight: '700', color: '#E0F7FA' },
  specialKey: { backgroundColor: '#1C2E42' },
  specialKeyText: { fontSize: 18, fontWeight: '700', color: '#00E5FF' },
  submitBtn: {
    backgroundColor: '#00BCD4', width: '85%', borderRadius: 12, padding: 15,
    alignItems: 'center', marginBottom: 12,
  },
  submitBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  cancelBtn: { padding: 10 },
  cancelBtnText: { color: '#EF5350', fontSize: 14, fontWeight: '600' },
});
