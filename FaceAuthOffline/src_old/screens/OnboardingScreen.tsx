import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, ScrollView, Platform
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import EncryptedStorage from 'react-native-encrypted-storage';
import crypto from 'crypto';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import {
  Camera, useCameraDevice, useFrameProcessor, runAtTargetFps
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { detectFaces, getLargestFace } from '../ml/FaceDetector';
import { extractEmbedding } from '../ml/FaceRecognizer';
import { detectLandmarks } from '../ml/LandmarkDetector';
import {
  createLivenessSession, updateActiveChallenge, CHALLENGE_LABELS,
  type ActiveLivenessState, isPassiveLivenessReal
} from '../ml/LivenessDetector';
import { FaceDB } from '../storage/FaceDB';
import { LSHIndex } from '../ml/LSHIndex';
import { resizeAndNormalizeRGBA, cropFaceRegion } from '../utils/imageUtils';
import DeviceInfo from 'react-native-device-info';
import { SyncManager } from '../storage/SyncManager';
import { EdgeLogger } from '../utils/EdgeLogger';

type SetupStep = 'pin' | 'aws' | 'permission' | 'biometric' | 'saving';

export default function OnboardingScreen() {
  const nav = useNavigation<any>();
  const device = useCameraDevice('front');

  const [step, setStep] = useState<SetupStep>('pin');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinSetupStep, setPinSetupStep] = useState<'enter' | 'confirm'>('enter');

  // AWS states
  const [region, setRegion] = useState('ap-south-1');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [isOfflineOnly, setIsOfflineOnly] = useState(false);

  // Permission states
  const [cameraPermission, setCameraPermission] = useState<'granted' | 'denied' | 'checking'>('checking');

  // Biometric Enrollment states
  const [biomStep, setBiomStep] = useState<'idle' | 'liveness' | 'capturing' | 'saving' | 'done'>('idle');
  const [userId, setUserId] = useState('UID-ADMIN');
  const [userName, setUserName] = useState('Primary Administrator');
  const [department, setDepartment] = useState('Security Operations');
  const [livenessState, setLivenessState] = useState<ActiveLivenessState | null>(null);
  const [captureCount, setCaptureCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const embeddingsRef = useRef<Float32Array[]>([]);
  const livenessRef = useRef<ActiveLivenessState | null>(null);
  const stepRef = useRef<string>('idle');

  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    const perm = Platform.OS === 'android' ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA;
    const status = await check(perm);
    if (status === RESULTS.GRANTED) {
      setCameraPermission('granted');
    } else {
      setCameraPermission('denied');
    }
  };

  const handleRequestPermission = async () => {
    const perm = Platform.OS === 'android' ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA;
    const status = await request(perm);
    if (status === RESULTS.GRANTED) {
      setCameraPermission('granted');
      Alert.alert('Granted', 'Camera access enabled successfully.');
    } else {
      setCameraPermission('denied');
      Alert.alert('Denied', 'Camera permission is required for face registration.');
    }
  };

  const handleSavePin = async () => {
    if (pin.length < 4) {
      Alert.alert('Invalid length', 'Admin PIN must be at least 4 digits.');
      return;
    }

    if (pinSetupStep === 'enter') {
      setConfirmPin(pin);
      setPin('');
      setPinSetupStep('confirm');
    } else {
      if (pin === confirmPin) {
        const hash = crypto.createHash('sha256').update(pin).digest('hex');
        await FaceDB.setAdminPinHash(hash);
        Alert.alert('Success', 'Admin Passcode saved successfully.');
        setStep('aws');
      } else {
        Alert.alert('Mismatch', 'PINs do not match. Please start over.');
        setPin('');
        setPinSetupStep('enter');
      }
    }
  };

  const handleSaveAws = async () => {
    if (isOfflineOnly) {
      // Pre-fill dummy keys to bypass config validation loops
      await SyncManager.saveConfig({
        region: 'ap-south-1',
        accessKeyId: 'OFFLINE_ONLY_BYPASS',
        secretAccessKey: 'OFFLINE_ONLY_BYPASS',
        s3Bucket: 'offline-only-bypass',
        dynamoEnrollmentsTable: 'offline_enrollments',
        dynamoLogsTable: 'offline_logs',
      });
      setStep('permission');
      return;
    }

    if (!accessKey || !secretKey || !s3Bucket) {
      Alert.alert('Missing fields', 'Please enter Access Key, Secret Key, and Bucket details or select Offline-Only mode.');
      return;
    }

    await SyncManager.saveConfig({
      region,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      s3Bucket,
      dynamoEnrollmentsTable: 'face_enrollments',
      dynamoLogsTable: 'auth_logs',
    });
    Alert.alert('AWS Configured', 'Credentials saved securely on hardware store.');
    setStep('permission');
  };

  // frame processor JS call
  const onFrame = Worklets.createRunOnJS(async (
    rgbaData: Uint8Array,
    width: number,
    height: number,
  ) => {
    if (stepRef.current !== 'liveness' && stepRef.current !== 'capturing') return;

    try {
      // 1. Detect Face
      const tensor128 = resizeAndNormalizeRGBA(rgbaData, width, height, 128, 128);
      let boxes;
      try {
        boxes = await detectFaces(tensor128);
      } catch (err: any) {
        EdgeLogger.error('OnboardingScreen', `BlazeFace detection failed: ${err?.message || err}`);
        throw err;
      }
      const face = getLargestFace(boxes);
      if (!face) { setStatusMsg('No face detected'); return; }

      // 2. Crop face for landmarks
      const crop192 = cropFaceRegion(rgbaData, width, height, face.x1, face.y1, face.x2, face.y2, 1.2);
      const tensor192 = resizeAndNormalizeRGBA(crop192.data, crop192.w, crop192.h, 192, 192);
      let landmarks;
      try {
        landmarks = await detectLandmarks(tensor192);
      } catch (err: any) {
        EdgeLogger.error('OnboardingScreen', `FaceMesh landmark failed: ${err?.message || err}`);
        throw err;
      }
      if (!landmarks) return;

      // 3. Active Liveness Challenge
      if (stepRef.current === 'liveness' && livenessRef.current) {
        const updated = updateActiveChallenge(livenessRef.current, landmarks);
        livenessRef.current = updated;
        setLivenessState({ ...updated });

        if (updated.done) {
          setStatusMsg('✅ Liveness verified! Capturing template...');
          stepRef.current = 'capturing';
          setBiomStep('capturing');
        } else {
          const ch = updated.challenges[updated.currentIndex];
          setStatusMsg(CHALLENGE_LABELS[ch]);
        }
        return;
      }

      // 4. Capture & averaging
      if (stepRef.current === 'capturing') {
        const crop80 = cropFaceRegion(rgbaData, width, height, face.x1, face.y1, face.x2, face.y2, 1.0);
        const tensor80 = resizeAndNormalizeRGBA(crop80.data, crop80.w, crop80.h, 80, 80);
        let isReal = false;
        try {
          isReal = await isPassiveLivenessReal(tensor80);
        } catch (err: any) {
          EdgeLogger.error('OnboardingScreen', `MiniFAS net passive liveness failed: ${err?.message || err}`);
          throw err;
        }
        if (!isReal) {
          setStatusMsg('❌ Passive liveness check failed. Spoof suspected!');
          return;
        }

        const crop112 = cropFaceRegion(rgbaData, width, height, face.x1, face.y1, face.x2, face.y2, 1.0);
        const tensor112 = resizeAndNormalizeRGBA(crop112.data, crop112.w, crop112.h, 112, 112);
        
        let embedding;
        try {
          embedding = await extractEmbedding(tensor112);
        } catch (err: any) {
          EdgeLogger.error('OnboardingScreen', `MobileFaceNet embedding extraction failed: ${err?.message || err}`);
          throw err;
        }
        
        if (embedding) {
          embeddingsRef.current.push(embedding);
          const count = embeddingsRef.current.length;
          setCaptureCount(count);
          setStatusMsg(`Captured ${count}/3 samples...`);

          if (count >= 3) {
            stepRef.current = 'saving';
            setBiomStep('saving');
            await handleSaveBiometric();
          }
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      EdgeLogger.error('OnboardingScreen', `Onboarding frame processor error: ${errMsg}`);
      console.error('[OnboardingScreen] Frame processing error:', err);
    }
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    runAtTargetFps(8, () => {
      'worklet';
      const rgba = frame.toArrayBuffer();
      onFrame(new Uint8Array(rgba), frame.width, frame.height);
    });
  }, [onFrame]);

  const handleStartLiveness = () => {
    embeddingsRef.current = [];
    setCaptureCount(0);
    const session = createLivenessSession();
    livenessRef.current = session;
    setLivenessState(session);
    stepRef.current = 'liveness';
    setBiomStep('liveness');
  };

  const handleSaveBiometric = async () => {
    setStatusMsg('Averaging face templates...');
    
    // Average embeddings
    const avg = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      let sum = 0;
      for (const e of embeddingsRef.current) {
        sum += e[i];
      }
      avg[i] = sum / embeddingsRef.current.length;
    }

    try {
      const devId = await DeviceInfo.getUniqueId();
      
      // Save locally
      await FaceDB.enrollFace({
        userId,
        userName,
        department,
        embedding: avg,
        deviceId: devId,
      });

      // Warm-up and push to index
      LSHIndex.addEntry({
        userId,
        userName,
        embedding: avg,
      });

      setStatusMsg('✅ Biometric successfully captured & indexed.');
      setBiomStep('done');

      // Finalize onboarding complete in EncryptedStorage!
      await EncryptedStorage.setItem('onboarding_complete', 'true');
      
      Alert.alert(
        'Onboarding Complete',
        'Device successfully secured, AWS datalake routed, camera permission enabled, and administrator biometrics registered!',
        [{ text: 'Start using FaceAuth', onPress: () => nav.replace('Home') }]
      );
    } catch (e) {
      console.error(e);
      Alert.alert('Save Failed', 'Could not register administrator biometrics in SQLite.');
      stepRef.current = 'idle';
      setBiomStep('idle');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>🚀 Device Onboarding</Text>
        <Text style={styles.subtitle}>
          Secure and route your offline biometric authentication device.
        </Text>
      </View>

      {/* Progress indicators */}
      <View style={styles.progressRow}>
        {['PIN', 'AWS', 'Perms', 'Face'].map((label, idx) => {
          const isActive = 
            (step === 'pin' && idx === 0) ||
            (step === 'aws' && idx === 1) ||
            (step === 'permission' && idx === 2) ||
            (step === 'biometric' && idx === 3) ||
            (step === 'saving' && idx === 3);
          const isDone = 
            (step === 'aws' && idx < 1) ||
            (step === 'permission' && idx < 2) ||
            (step === 'biometric' && idx < 3);

          return (
            <View key={label} style={styles.progressStep}>
              <View style={[
                styles.progressDot,
                isActive && styles.progressDotActive,
                isDone && styles.progressDotDone
              ]}>
                <Text style={styles.progressStepText}>{idx + 1}</Text>
              </View>
              <Text style={styles.progressStepLabel}>{label}</Text>
            </View>
          );
        })}
      </View>

      {/* Slide 1: Administrative PIN Setup */}
      {step === 'pin' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔐 Set Administrative PIN</Text>
          <Text style={styles.cardDesc}>
            Setup a passcode to shield critical registries, AWS configurations, and offline sync logs in the field.
          </Text>

          <Text style={styles.fieldLabel}>
            {pinSetupStep === 'enter' ? 'Enter Passcode (4-6 digits)' : 'Confirm Administrative Passcode'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="••••"
            placeholderTextColor="#546E7A"
            secureTextEntry
            keyboardType="numeric"
            maxLength={6}
            value={pin}
            onChangeText={setPin}
          />
          <TouchableOpacity style={styles.btnPrimary} onPress={handleSavePin}>
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Slide 2: AWS Configuration */}
      {step === 'aws' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>☁️ Route AWS Datalake (Optional)</Text>
          <Text style={styles.cardDesc}>
            Connect this device to your DynamoDB and S3 tables to support multi-device biometric sync-downs.
          </Text>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Operate in 100% Offline-Only Mode</Text>
            <SwitchBypass value={isOfflineOnly} onValueChange={setIsOfflineOnly} />
          </View>

          {!isOfflineOnly && (
            <View style={{ gap: 10, marginTop: 8 }}>
              <TextInput style={styles.input} placeholder="Region (ap-south-1)" placeholderTextColor="#546E7A" value={region} onChangeText={setRegion} />
              <TextInput style={styles.input} placeholder="Access Key ID" placeholderTextColor="#546E7A" value={accessKey} onChangeText={setAccessKey} secureTextEntry />
              <TextInput style={styles.input} placeholder="Secret Access Key" placeholderTextColor="#546E7A" value={secretKey} onChangeText={setSecretKey} secureTextEntry />
              <TextInput style={styles.input} placeholder="S3 Bucket Name" placeholderTextColor="#546E7A" value={s3Bucket} onChangeText={setS3Bucket} />
            </View>
          )}

          <TouchableOpacity style={styles.btnPrimary} onPress={handleSaveAws}>
            <Text style={styles.btnText}>Save Config & Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Slide 3: Camera Permission */}
      {step === 'permission' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📷 Enable Camera Permissions</Text>
          <Text style={styles.cardDesc}>
            FaceAuth requires local camera access to calculate eye aspect ratios, passive liveness filters, and matching embeddings.
          </Text>

          <View style={styles.statusRow}>
            <View style={[styles.statusIndicator, cameraPermission === 'granted' ? styles.statusSuccess : styles.statusDanger]} />
            <Text style={styles.statusText}>
              Camera Access: {cameraPermission === 'granted' ? 'ENABLED (Grated)' : 'DISABLED'}
            </Text>
          </View>

          {cameraPermission !== 'granted' ? (
            <TouchableOpacity style={styles.btnPrimary} onPress={handleRequestPermission}>
              <Text style={styles.btnText}>Grant Camera Access</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.btnPrimary} onPress={() => setStep('biometric')}>
              <Text style={styles.btnText}>Proceed to Biometric Enrollment</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Slide 4: First Face Capture */}
      {step === 'biometric' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>👤 Enroll Administrator Biometric</Text>
          <Text style={styles.cardDesc}>
            Capture your facial template to seed the SQLite credentials and allow local device unlocking.
          </Text>

          <View style={{ gap: 10, marginBottom: 14 }}>
            <TextInput style={styles.input} placeholder="Admin Name" placeholderTextColor="#546E7A" value={userName} onChangeText={setUserName} />
            <TextInput style={styles.input} placeholder="Admin Employee ID" placeholderTextColor="#546E7A" value={userId} onChangeText={setUserId} />
          </View>

          {biomStep !== 'idle' && device && cameraPermission === 'granted' && (
            <View style={styles.cameraViewport}>
              <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={true}
                pixelFormat="rgb"
                frameProcessor={frameProcessor}
              />
              <View style={styles.guideCircle} />
              
              {/* Telemetry info layer */}
              {captureCount > 0 && (
                <View style={styles.badgeRow}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Samples: {captureCount}/3</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {statusMsg ? <Text style={styles.statusLabel}>{statusMsg}</Text> : null}

          {biomStep === 'idle' ? (
            <TouchableOpacity style={styles.btnPrimary} onPress={handleStartLiveness}>
              <Text style={styles.btnText}>🎯 Initialize Face Scan</Text>
            </TouchableOpacity>
          ) : biomStep === 'saving' ? (
            <ActivityIndicator size="small" color="#00E5FF" style={{ marginVertical: 10 }} />
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

function SwitchBypass({ value, onValueChange }: { value: boolean; onValueChange: (val: boolean) => void }) {
  return (
    <TouchableOpacity 
      style={[styles.switchTrack, value && styles.switchTrackActive]} 
      onPress={() => onValueChange(!value)}>
      <View style={[styles.switchThumb, value && styles.switchThumbActive]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  content: { padding: 24, paddingBottom: 60, justifyContent: 'center' },
  header: { alignItems: 'center', marginVertical: 20 },
  title: { fontSize: 26, fontWeight: '800', color: '#00E5FF', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#78909C', textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 24, paddingHorizontal: 10 },
  progressStep: { alignItems: 'center', flex: 1 },
  progressDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#1E3A5F', backgroundColor: '#112233', justifyContent: 'center', alignItems: 'center' },
  progressDotActive: { borderColor: '#00E5FF', backgroundColor: '#00E5FF' },
  progressDotDone: { borderColor: '#00E676', backgroundColor: '#00E676' },
  progressStepText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  progressStepLabel: { color: '#78909C', fontSize: 10, marginTop: 6, fontWeight: '600' },
  card: { backgroundColor: '#112233', borderRadius: 16, borderWidth: 1, borderColor: '#1E3A5F', padding: 20 },
  cardTitle: { color: '#00E5FF', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  cardDesc: { color: '#B0BEC5', fontSize: 12, lineHeight: 16, marginBottom: 20 },
  fieldLabel: { color: '#78909C', fontSize: 12, marginBottom: 8 },
  input: { backgroundColor: '#0D1B2A', borderRadius: 10, borderWidth: 1, borderColor: '#1E3A5F', color: '#E0F7FA', padding: 14, fontSize: 14, marginBottom: 16 },
  btnPrimary: { backgroundColor: '#00BCD4', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  toggleLabel: { color: '#E0F7FA', fontSize: 13, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  statusIndicator: { width: 10, height: 10, borderRadius: 5 },
  statusSuccess: { backgroundColor: '#00E676' },
  statusDanger: { backgroundColor: '#EF5350' },
  statusText: { color: '#B0BEC5', fontSize: 13, fontWeight: '600' },
  cameraViewport: { width: '100%', height: 260, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#1E3A5F', marginVertical: 14, justifyContent: 'center', alignItems: 'center' },
  guideCircle: { width: 160, height: 160, borderRadius: 80, borderWidth: 2, borderColor: 'rgba(0, 229, 255, 0.4)', borderStyle: 'dashed', backgroundColor: 'transparent' },
  statusLabel: { color: '#FFF', fontSize: 13, fontWeight: '600', textAlign: 'center', marginVertical: 10 },
  badgeRow: { position: 'absolute', top: 12, right: 12 },
  badge: { backgroundColor: 'rgba(0, 229, 255, 0.2)', borderWidth: 1, borderColor: '#00E5FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#00E5FF', fontSize: 11, fontWeight: '700' },
  switchTrack: { width: 44, height: 22, borderRadius: 11, backgroundColor: '#263238', padding: 2, justifyContent: 'center' },
  switchTrackActive: { backgroundColor: '#1E3A5F' },
  switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#78909C' },
  switchThumbActive: { backgroundColor: '#00E5FF', transform: [{ translateX: 22 }] }
});
