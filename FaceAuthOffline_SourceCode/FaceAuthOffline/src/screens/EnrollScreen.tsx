/**
 * EnrollScreen
 * Captures 3 high-quality face frames → averages embeddings → stores in FaceDB.
 * Requires liveness check (one challenge) during enrollment.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Platform,
} from 'react-native';
import {
  Camera, useCameraDevice, useFrameProcessor, runAtTargetFps,
} from 'react-native-vision-camera';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Worklets } from 'react-native-worklets-core';
import { detectFaces, getLargestFace } from '../ml/FaceDetector';
import { extractEmbedding } from '../ml/FaceRecognizer';
import {
  detectLandmarks, eyeAspectRatio,
} from '../ml/LandmarkDetector';
import {
  createLivenessSession, updateActiveChallenge, CHALLENGE_LABELS,
  type ActiveLivenessState,
} from '../ml/LivenessDetector';
import { isPassiveLivenessReal } from '../ml/LivenessDetector';
import { FaceDB } from '../storage/FaceDB';
import { resizeAndNormalizeRGBA, cropFaceRegion, enhanceOutdoorLighting } from '../utils/imageUtils';
import DeviceInfo from 'react-native-device-info';

const CAPTURE_COUNT = 3; // average 3 embeddings for robustness

type EnrollStep = 'idle' | 'liveness' | 'capturing' | 'saving' | 'done' | 'error';

export default function EnrollScreen() {
  const nav = useNavigation();
  const device = useCameraDevice('front');

  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [department, setDepartment] = useState('');
  const [step, setStep] = useState<EnrollStep>('idle');
  const [livenessState, setLivenessState] = useState<ActiveLivenessState | null>(null);
  const [captureCount, setCaptureCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const embeddingsRef = useRef<Float32Array[]>([]);
  const livenessRef = useRef<ActiveLivenessState | null>(null);
  const stepRef = useRef<EnrollStep>('idle');

  const setStepSync = (s: EnrollStep) => {
    stepRef.current = s;
    setStep(s);
  };

  // JS-thread callback from frame processor
  const onFrame = Worklets.createRunInJsFn(async (
    rgbaData: Uint8Array,
    width: number,
    height: number,
  ) => {
    if (stepRef.current !== 'liveness' && stepRef.current !== 'capturing') return;

    const enhanced = enhanceOutdoorLighting(rgbaData, width, height);

    // 1. Detect face
    const tensor128 = resizeAndNormalizeRGBA(enhanced, width, height, 128, 128);
    const boxes = await detectFaces(tensor128);
    const face = getLargestFace(boxes);
    if (!face) { setStatusMsg('No face detected'); return; }

    // 2. Crop face for landmarks (192×192)
    const crop192 = cropFaceRegion(enhanced, width, height,
      face.x1, face.y1, face.x2, face.y2, 1.2);
    const tensor192 = resizeAndNormalizeRGBA(
      crop192.data, crop192.w, crop192.h, 192, 192);

    const landmarks = await detectLandmarks(tensor192);
    if (!landmarks) return;

    // 3. Active liveness
    if (stepRef.current === 'liveness' && livenessRef.current) {
      const updated = updateActiveChallenge(livenessRef.current, landmarks);
      livenessRef.current = updated;
      setLivenessState({ ...updated });

      if (updated.done) {
        setStatusMsg('✅ Liveness verified! Capturing face…');
        setStepSync('capturing');
      } else {
        const ch = updated.challenges[updated.currentIndex];
        setStatusMsg(CHALLENGE_LABELS[ch]);
      }
      return;
    }

    // 4. Passive liveness check + capture embedding
    if (stepRef.current === 'capturing') {
      // Passive check on 80×80 patch
      const crop80 = cropFaceRegion(enhanced, width, height,
        face.x1, face.y1, face.x2, face.y2, 1.0);
      const tensor80 = resizeAndNormalizeRGBA(
        crop80.data, crop80.w, crop80.h, 80, 80);
      const realFace = await isPassiveLivenessReal(tensor80);
      if (!realFace) { setStatusMsg('⚠️ Spoof detected — use real face'); return; }

      // Extract embedding (112×112)
      const crop112 = cropFaceRegion(enhanced, width, height,
        face.x1, face.y1, face.x2, face.y2, 1.3);
      const tensor112 = resizeAndNormalizeRGBA(
        crop112.data, crop112.w, crop112.h, 112, 112, 'minus_one_one');
      const embedding = await extractEmbedding(tensor112);

      embeddingsRef.current.push(embedding);
      const count = embeddingsRef.current.length;
      setCaptureCount(count);
      setStatusMsg(`Captured ${count}/${CAPTURE_COUNT}`);

      if (count >= CAPTURE_COUNT) {
        setStepSync('saving');
        await saveEnrollment();
      }
    }
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    runAtTargetFps(8, () => {
      'worklet';
      // Convert frame to RGBA Uint8Array and pass to JS
      const rgba = frame.toArrayBuffer();
      onFrame(new Uint8Array(rgba), frame.width, frame.height);
    });
  }, [onFrame]);

  const startEnroll = () => {
    if (!userId.trim() || !userName.trim()) {
      Alert.alert('Missing Info', 'Please enter User ID and Name.');
      return;
    }
    embeddingsRef.current = [];
    const session = createLivenessSession();
    livenessRef.current = session;
    setLivenessState(session);
    const firstChallenge = session.challenges[0];
    setStatusMsg(CHALLENGE_LABELS[firstChallenge]);
    setStepSync('liveness');
    setCaptureCount(0);
  };

  const saveEnrollment = async () => {
    try {
      const embeddings = embeddingsRef.current;
      // Average the 3 embeddings
      const avgEmbedding = new Float32Array(512);
      for (const emb of embeddings) {
        for (let i = 0; i < 512; i++) avgEmbedding[i] += emb[i];
      }
      for (let i = 0; i < 512; i++) avgEmbedding[i] /= embeddings.length;

      const deviceId = await DeviceInfo.getUniqueId();

      await FaceDB.enrollFace({
        userId: userId.trim(),
        userName: userName.trim(),
        department: department.trim(),
        embedding: avgEmbedding,
        deviceId,
      });

      setStepSync('done');
      setStatusMsg(`✅ ${userName} enrolled successfully!`);
    } catch (err) {
      setStepSync('error');
      setStatusMsg('Enrollment failed. Please try again.');
    }
  };

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Front camera not available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      {(step === 'liveness' || step === 'capturing') && (
        <Camera
          style={styles.camera}
          device={device}
          isActive
          frameProcessor={frameProcessor}
          pixelFormat="rgba"
        />
      )}

      {/* Overlay UI */}
      <View style={styles.overlay}>
        {step === 'idle' && (
          <View style={styles.form}>
            <Text style={styles.formTitle}>Enroll New Face</Text>
            <TextInput
              style={styles.input} placeholder="Employee / User ID"
              placeholderTextColor="#546E7A" value={userId}
              onChangeText={setUserId} />
            <TextInput
              style={styles.input} placeholder="Full Name"
              placeholderTextColor="#546E7A" value={userName}
              onChangeText={setUserName} />
            <TextInput
              style={styles.input} placeholder="Department (optional)"
              placeholderTextColor="#546E7A" value={department}
              onChangeText={setDepartment} />
            <TouchableOpacity style={styles.btn} onPress={startEnroll}>
              <Text style={styles.btnText}>Start Enrollment</Text>
            </TouchableOpacity>
          </View>
        )}

        {(step === 'liveness' || step === 'capturing') && (
          <View style={styles.statusContainer}>
            <View style={styles.faceGuide} />
            <Text style={styles.challengeText}>{statusMsg}</Text>
            {livenessState && (
              <View style={styles.progressRow}>
                {livenessState.challenges.map((ch, i) => (
                  <View key={ch} style={[
                    styles.progressDot,
                    livenessState.completed[i] && styles.progressDotDone,
                  ]} />
                ))}
              </View>
            )}
            {step === 'capturing' && (
              <Text style={styles.captureCount}>{captureCount}/{CAPTURE_COUNT}</Text>
            )}
          </View>
        )}

        {step === 'saving' && (
          <View style={styles.center}>
            <ActivityIndicator color="#00E5FF" size="large" />
            <Text style={styles.statusText}>Saving enrollment…</Text>
          </View>
        )}

        {(step === 'done' || step === 'error') && (
          <View style={styles.resultContainer}>
            <Text style={styles.resultText}>{statusMsg}</Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => { setStepSync('idle'); setCaptureCount(0); }}>
              <Text style={styles.btnText}>Enroll Another</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#263238', marginTop: 8 }]}
              onPress={() => nav.goBack()}>
              <Text style={styles.btnText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  camera: { ...StyleSheet.absoluteFillObject },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end', padding: 20,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  form: {
    backgroundColor: '#0D1B2AEE', borderRadius: 16, padding: 20,
  },
  formTitle: { fontSize: 20, fontWeight: '700', color: '#00E5FF', marginBottom: 16, textAlign: 'center' },
  input: {
    backgroundColor: '#112233', borderRadius: 10, padding: 14,
    color: '#E0F7FA', marginBottom: 12, borderWidth: 1, borderColor: '#1E3A5F',
  },
  btn: {
    backgroundColor: '#00BCD4', borderRadius: 12, padding: 15, alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  statusContainer: { alignItems: 'center', marginBottom: 40 },
  faceGuide: {
    width: 220, height: 280, borderRadius: 110, borderWidth: 3,
    borderColor: '#00E5FF', marginBottom: 20,
    borderStyle: 'dashed', backgroundColor: 'transparent',
  },
  challengeText: {
    color: '#FFFFFF', fontSize: 20, fontWeight: '700', textAlign: 'center',
    backgroundColor: '#0D1B2ACC', padding: 12, borderRadius: 10,
  },
  progressRow: { flexDirection: 'row', marginTop: 16, gap: 12 },
  progressDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#546E7A', borderWidth: 2, borderColor: '#00E5FF',
  },
  progressDotDone: { backgroundColor: '#00E676' },
  captureCount: { color: '#00E5FF', fontSize: 18, fontWeight: '700', marginTop: 8 },
  statusText: { color: '#B0BEC5', marginTop: 12, fontSize: 16 },
  resultContainer: {
    backgroundColor: '#0D1B2AEE', borderRadius: 16, padding: 20, alignItems: 'center',
  },
  resultText: { fontSize: 18, color: '#E0F7FA', marginBottom: 20, textAlign: 'center', fontWeight: '600' },
  errorText: { color: '#EF5350', fontSize: 16 },
});
