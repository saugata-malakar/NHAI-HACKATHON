/**
 * OnboardingScreen — 4-step wizard shown on first launch only.
 * Steps: Welcome → Set Admin PIN → Camera Permission → Enroll First Face
 * On completion writes onboarding_complete=1 and navigates to Home.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { FaceDB } from '../storage/FaceDB';
import { markAdminAuthed } from '../hooks/useAdminAuth';

const STEPS = ['Welcome', 'Admin PIN', 'Camera', 'Enroll'];

export default function OnboardingScreen() {
  const nav = useNavigation<any>();
  const [step, setStep] = useState(0);
  const [camGranted, setCamGranted] = useState(false);

  const requestCamera = async () => {
    const perm = Platform.OS === 'android' ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA;
    const status = await request(perm);
    if (status === RESULTS.GRANTED) { setCamGranted(true); }
    else { Alert.alert('Camera Required', 'Camera permission is required for face authentication.'); }
  };

  const finish = async () => {
    await FaceDB.setSetting('onboarding_complete', '1');
    nav.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const Dot = ({ i }: { i: number }) => (
    <View style={[s.stepDot, i === step && s.stepDotActive, i < step && s.stepDotDone]} />
  );

  return (
    <View style={s.container}>
      {/* Progress */}
      <View style={s.progress}>
        {STEPS.map((_, i) => <Dot key={i} i={i} />)}
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <View style={s.card}>
            <Text style={s.bigIcon}>🔐</Text>
            <Text style={s.cardTitle}>Welcome to FaceAuth Offline</Text>
            <Text style={s.cardBody}>
              Secure biometric authentication that works entirely without internet.
              {'\n\n'}Your face embeddings are AES-256 encrypted and stored only on this device.
              Nothing leaves the device until you explicitly sync to your AWS account.
              {'\n\n'}This setup takes about 2 minutes.
            </Text>
            <View style={s.featureList}>
              {['100% offline operation','Dual-layer liveness detection','Cryptographic audit ledger','GDPR & DPDP compliant'].map(f => (
                <View key={f} style={s.featureRow}>
                  <Text style={s.featureTick}>✓</Text>
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Step 1 — Admin PIN */}
        {step === 1 && (
          <View style={s.card}>
            <Text style={s.bigIcon}>🔑</Text>
            <Text style={s.cardTitle}>Set Admin PIN</Text>
            <Text style={s.cardBody}>
              Create a 6-digit PIN to protect enrollment, user management, and sync settings.
              {'\n\n'}This PIN is SHA-256 hashed before storage — it cannot be recovered. Store it somewhere safe.
            </Text>
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() => nav.navigate('AdminPin', {
                title: 'Create Admin PIN',
                onSuccess: () => { markAdminAuthed(); setStep(2); },
              })}>
              <Text style={s.actionBtnText}>Set PIN →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2 — Camera */}
        {step === 2 && (
          <View style={s.card}>
            <Text style={s.bigIcon}>📷</Text>
            <Text style={s.cardTitle}>Camera Permission</Text>
            <Text style={s.cardBody}>
              FaceAuth needs access to your front camera to capture and verify faces.
              {'\n\n'}No images are ever saved to your gallery or transmitted anywhere.
            </Text>
            {camGranted ? (
              <View style={s.successBadge}>
                <Text style={s.successText}>✓  Camera permission granted</Text>
              </View>
            ) : (
              <TouchableOpacity style={s.actionBtn} onPress={requestCamera}>
                <Text style={s.actionBtnText}>Grant Camera Access</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Step 3 — Enroll */}
        {step === 3 && (
          <View style={s.card}>
            <Text style={s.bigIcon}>👤</Text>
            <Text style={s.cardTitle}>Enroll First Face</Text>
            <Text style={s.cardBody}>
              Enroll at least one face to enable authentication.
              {'\n\n'}You can also skip this step and enroll from the home screen later.
              For bulk enrollment, use the CSV import feature under User Registry.
            </Text>
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() => nav.navigate('Enroll', {})}>
              <Text style={s.actionBtnText}>Enroll Now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.skipBtn} onPress={finish}>
              <Text style={s.skipText}>Skip — I'll enroll later</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Nav buttons */}
      <View style={s.navRow}>
        {step > 0 && (
          <TouchableOpacity style={s.backBtn} onPress={() => setStep(s => s - 1)}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        {step < 3 && step !== 1 && (
          <TouchableOpacity
            style={[s.nextBtn, step === 2 && !camGranted && s.nextBtnDisabled]}
            disabled={step === 2 && !camGranted}
            onPress={() => setStep(s => s + 1)}>
            <Text style={s.nextText}>{step === 0 ? "Let's Start" : 'Continue →'}</Text>
          </TouchableOpacity>
        )}
        {step === 3 && (
          <TouchableOpacity style={s.nextBtn} onPress={finish}>
            <Text style={s.nextText}>Finish Setup ✓</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  progress: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingTop: 60, paddingBottom: 12 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1E3A5F' },
  stepDotActive: { backgroundColor: '#00E5FF', width: 28, borderRadius: 5 },
  stepDotDone: { backgroundColor: '#00E676' },
  content: { padding: 20, paddingBottom: 8 },
  card: { backgroundColor: '#112233', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#1E3A5F' },
  bigIcon: { fontSize: 56, textAlign: 'center', marginBottom: 16 },
  cardTitle: { fontSize: 22, fontWeight: '800', color: '#00E5FF', textAlign: 'center', marginBottom: 12 },
  cardBody: { fontSize: 14, color: '#78909C', lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  featureList: { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureTick: { color: '#00E676', fontSize: 16, fontWeight: '700' },
  featureText: { color: '#B0BEC5', fontSize: 14 },
  actionBtn: { backgroundColor: '#00BCD4', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipBtn: { padding: 12, alignItems: 'center', marginTop: 8 },
  skipText: { color: '#546E7A', fontSize: 14 },
  successBadge: { backgroundColor: '#0A2E1A', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#00E676', alignItems: 'center', marginTop: 8 },
  successText: { color: '#00E676', fontWeight: '700', fontSize: 15 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, paddingBottom: 36, gap: 12 },
  backBtn: { flex: 1, backgroundColor: '#112233', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  backText: { color: '#78909C', fontWeight: '600', fontSize: 15 },
  nextBtn: { flex: 2, backgroundColor: '#00BCD4', borderRadius: 12, padding: 16, alignItems: 'center' },
  nextBtnDisabled: { opacity: 0.4 },
  nextText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
