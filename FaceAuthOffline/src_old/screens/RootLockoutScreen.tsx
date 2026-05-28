import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

export default function RootLockoutScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>🚨</Text>
        <Text style={styles.title}>CRITICAL SECURITY VIOLATION</Text>
        <View style={styles.divider} />
        <Text style={styles.message}>
          Jailbreak or Root environment has been detected on this device.
        </Text>
        <Text style={styles.description}>
          Operating in a compromised environment violates our biometric security model. Hardware-bound keystores, AES-256 local database encryptions, and app sandbox directories are exposed to cross-process memory extraction.
        </Text>
        <Text style={styles.lockedText}>
          ALL BIOMETRIC CAPTURE & DATABASE READ/WRITE OPERATIONS ARE TEMPORARILY DISABLED.
        </Text>
      </View>
      <Text style={styles.footer}>FaceAuth Offline • Hardware Security Shield</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#112233',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#EF5350',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#EF5350',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  icon: {
    fontSize: 50,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: '#EF5350',
    textAlign: 'center',
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#EF5350',
    width: '100%',
    marginVertical: 16,
    opacity: 0.3,
  },
  message: {
    fontSize: 15,
    fontWeight: '700',
    color: '#E0F7FA',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 12,
    color: '#B0BEC5',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  lockedText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FF8A80',
    textAlign: 'center',
    backgroundColor: 'rgba(239, 83, 80, 0.08)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 83, 80, 0.2)',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    fontSize: 11,
    color: '#546E7A',
    fontWeight: '600',
  },
});
