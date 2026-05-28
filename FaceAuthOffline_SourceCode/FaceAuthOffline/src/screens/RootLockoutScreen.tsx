/**
 * RootLockoutScreen
 * Non-dismissable screen shown when JailMonkey detects root/jailbreak.
 * No back navigation. No dismiss button. User must restore device.
 */
import React from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';

export default function RootLockoutScreen() {
  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A0000" />
      <Text style={s.icon}>⛔</Text>
      <Text style={s.title}>Device Integrity Compromised</Text>
      <Text style={s.body}>
        This device is rooted or jailbroken.{'\n\n'}
        Biometric authentication cannot operate securely on a compromised device.
        The local encryption key may be accessible to malicious processes.{'\n\n'}
        Restore your device to factory firmware to use FaceAuth Offline.
      </Text>
      <View style={s.badge}>
        <Text style={s.badgeText}>SECURITY POLICY VIOLATION</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A0000', alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { fontSize: 72, marginBottom: 24 },
  title: { fontSize: 22, fontWeight: '800', color: '#EF5350', textAlign: 'center', marginBottom: 20 },
  body: { fontSize: 14, color: '#78909C', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  badge: { backgroundColor: '#4A0000', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#EF5350' },
  badgeText: { color: '#EF5350', fontWeight: '700', fontSize: 12, letterSpacing: 1.5 },
});
