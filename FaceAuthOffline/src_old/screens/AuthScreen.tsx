/**
 * AuthScreen
 * Full authentication flow:
 * 1. Active liveness challenge (2 challenges, randomly selected)
 * 2. Passive anti-spoof (MiniFASNet)
 * 3. Face recognition (MobileFaceNet cosine similarity)
 * 4. Log result to FaceDB (synced to AWS when online)
 *
 * Target: < 1 second total inference on mid-range devices
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import {
  Camera, useCameraDevice, useFrameProcessor, runAtTargetFps,
} from 'react-native-vision-camera';
import { useNavigation } from '@react-navigation/native';
import { Worklets } from 'react-native-worklets-core';
import { detectFaces, getLargestFace } from '../ml/FaceDetector';
import { extractEmbedding, matchEmbedding, type MatchResult } from '../ml/FaceRecognizer';
import { LSHIndex } from '../ml/LSHIndex';
import { detectLandmarks } from '../ml/LandmarkDetector';
import {
  createLivenessSession, updateActiveChallenge, CHALLENGE_LABELS,
  isPassiveLivenessReal, type ActiveLivenessState,
} from '../ml/LivenessDetector';
import { FaceDB } from '../storage/FaceDB';
import { resizeAndNormalizeRGBA, cropFaceRegion, enhanceOutdoorLighting } from '../utils/imageUtils';
import { EdgeLogger } from '../utils/EdgeLogger';

type AuthStep = 'liveness' | 'recognizing' | 'success' | 'fail' | 'spoof';

export default function AuthScreen() {
  const nav = useNavigation();
  const device = useCameraDevice('front');

  const [step, setStep] = useState<AuthStep>('liveness');
  const [challengeText, setChallengeText] = useState('');
  const [livenessState, setLivenessState] = useState<ActiveLivenessState | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [inferenceMs, setInferenceMs] = useState(0);

  const livenessRef = useRef<ActiveLivenessState | null>(null);
  const stepRef = useRef<AuthStep>('liveness');
  const galleryRef = useRef<Array<{ userId: string; userName: string; embedding: Float32Array }>>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    try {
      const { preventScreenshot } = require('react-native-prevent-screenshot');
      preventScreenshot();
    } catch (err) {
      console.warn('[AuthScreen] Screenshot prevention not available:', err);
    }

    // Load enrolled faces into memory
    (async () => {
      galleryRef.current = await FaceDB.getAllEmbeddings();
      LSHIndex.build(galleryRef.current);
      const session = createLivenessSession();
      livenessRef.current = session;
      setLivenessState(session);
      setChallengeText(CHALLENGE_LABELS[session.challenges[0]]);
    })();

    return () => {
      try {
        const { allowScreenshot } = require('react-native-prevent-screenshot');
        allowScreenshot();
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (step === 'success') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ]),
      ).start();
    }
  }, [step]);

  const setStepSync = (s: AuthStep) => {
    stepRef.current = s;
    setStep(s);
  };

  const onFrame = Worklets.createRunOnJS(async (
    rgbaData: Uint8Array,
    width: number,
    height: number,
  ) => {
    if (stepRef.current !== 'liveness' && stepRef.current !== 'recognizing') return;

    const t0 = Date.now();
    try {
      const enhanced = enhanceOutdoorLighting(rgbaData, width, height);

      // ── Face detection ──────────────────────────────────────────────────────
      const tFace0 = Date.now();
      const tensor128 = resizeAndNormalizeRGBA(enhanced, width, height, 128, 128);
      let boxes;
      try {
        boxes = await detectFaces(tensor128);
      } catch (err: any) {
        EdgeLogger.error('AuthScreen', `BlazeFace detection model execution failed: ${err?.message || err}`);
        throw err;
      }
      const blazeface_ms = Date.now() - tFace0;
      const face = getLargestFace(boxes);
      if (!face) { setChallengeText('👤 Position your face in frame'); return; }

      // ── Landmark detection (for active liveness) ────────────────────────────
      const tLandmark0 = Date.now();
      const crop192 = cropFaceRegion(enhanced, width, height,
        face.x1, face.y1, face.x2, face.y2, 1.2);
      const tensor192 = resizeAndNormalizeRGBA(
        crop192.data, crop192.w, crop192.h, 192, 192);
      let landmarks;
      try {
        landmarks = await detectLandmarks(tensor192);
      } catch (err: any) {
        EdgeLogger.error('AuthScreen', `FaceMesh landmark model execution failed: ${err?.message || err}`);
        throw err;
      }
      const facemesh_ms = Date.now() - tLandmark0;
      if (!landmarks) return;

      // ── Active liveness ─────────────────────────────────────────────────────
      if (stepRef.current === 'liveness' && livenessRef.current) {
        const updated = updateActiveChallenge(livenessRef.current, landmarks);
        livenessRef.current = updated;
        setLivenessState({ ...updated });

        if (!updated.done) {
          const ch = updated.challenges[updated.currentIndex];
          setChallengeText(CHALLENGE_LABELS[ch]);
          return;
        }

        setChallengeText('🔍 Verifying identity…');
        setStepSync('recognizing');
      }

      // ── Passive anti-spoof ──────────────────────────────────────────────────
      if (stepRef.current === 'recognizing') {
        const tSpoof0 = Date.now();
        const crop80 = cropFaceRegion(enhanced, width, height,
          face.x1, face.y1, face.x2, face.y2, 1.0);
        const tensor80 = resizeAndNormalizeRGBA(
          crop80.data, crop80.w, crop80.h, 80, 80);
        let realFace = false;
        try {
          realFace = await isPassiveLivenessReal(tensor80);
        } catch (err: any) {
          EdgeLogger.error('AuthScreen', `MiniFAS net passive anti-spoof model execution failed: ${err?.message || err}`);
          throw err;
        }
        const antispoof_ms = Date.now() - tSpoof0;

        if (!realFace) {
          setStepSync('spoof');
          await FaceDB.logAuth({ userId: 'UNKNOWN', verified: false, similarity: 0, livenessPassed: false });
          try {
            await FaceDB.logTelemetry({
              event: 'authentication',
              blazeface_ms,
              facemesh_ms,
              embedding_ms: 0,
              antispoof_ms,
              total_ms: Date.now() - t0,
              result: 'spoof',
              similarity: 0,
              liveness_challenges: livenessRef.current?.challenges ?? [],
            });
          } catch (e) {
            console.error('Failed to log spoof telemetry', e);
          }
          return;
        }

        // ── Face recognition ────────────────────────────────────────────────
        const tEmb0 = Date.now();
        const crop112 = cropFaceRegion(enhanced, width, height,
          face.x1, face.y1, face.x2, face.y2, 1.3);
        const tensor112 = resizeAndNormalizeRGBA(
          crop112.data, crop112.w, crop112.h, 112, 112, 'minus_one_one');
        let embedding;
        try {
          embedding = await extractEmbedding(tensor112);
        } catch (err: any) {
          EdgeLogger.error('AuthScreen', `MobileFaceNet embedding extraction failed: ${err?.message || err}`);
          throw err;
        }
        const embedding_ms = Date.now() - tEmb0;

        const candidates = LSHIndex.query(embedding, 10);
        const matchResult = matchEmbedding(embedding, candidates);
        const elapsed = Date.now() - t0;
        setInferenceMs(elapsed);

        if (matchResult?.verified) {
          setResult(matchResult);
          setStepSync('success');
          await FaceDB.logAuth({
            userId: matchResult.userId,
            verified: true,
            similarity: matchResult.similarity,
            livenessPassed: true,
          });
          try {
            await FaceDB.logTelemetry({
              event: 'authentication',
              blazeface_ms,
              facemesh_ms,
              embedding_ms,
              antispoof_ms,
              total_ms: elapsed,
              result: 'success',
              similarity: matchResult.similarity,
              liveness_challenges: livenessRef.current?.challenges ?? [],
            });
          } catch (e) {
            console.error('Failed to log success telemetry', e);
          }
        } else {
          setStepSync('fail');
          await FaceDB.logAuth({
            userId: matchResult?.userId ?? 'UNKNOWN',
            verified: false,
            similarity: matchResult?.similarity ?? 0,
            livenessPassed: true,
          });
          try {
            await FaceDB.logTelemetry({
              event: 'authentication',
              blazeface_ms,
              facemesh_ms,
              embedding_ms,
              antispoof_ms,
              total_ms: elapsed,
              result: 'fail',
              similarity: matchResult?.similarity ?? 0,
              liveness_challenges: livenessRef.current?.challenges ?? [],
            });
          } catch (e) {
            console.error('Failed to log fail telemetry', e);
          }
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      EdgeLogger.error('AuthScreen', `Authentication frame processor error: ${errMsg}`);
      console.error('[AuthScreen] Frame processing error:', err);
    }
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    runAtTargetFps(10, () => {
      'worklet';
      const rgba = frame.toArrayBuffer();
      onFrame(new Uint8Array(rgba), frame.width, frame.height);
    });
  }, [onFrame]);

  const retry = () => {
    const session = createLivenessSession();
    livenessRef.current = session;
    setLivenessState(session);
    setChallengeText(CHALLENGE_LABELS[session.challenges[0]]);
    setResult(null);
    setStepSync('liveness');
  };

  if (!device) return (
    <View style={styles.center}><Text style={styles.errorText}>Camera unavailable</Text></View>
  );

  return (
    <View style={styles.container}>
      {(step === 'liveness' || step === 'recognizing') && (
        <Camera
          style={styles.camera}
          device={device}
          isActive
          frameProcessor={frameProcessor}
          pixelFormat="rgb"
        />
      )}

      {/* Result overlays */}
      {step === 'success' && result && (
        <View style={[styles.resultOverlay, styles.successOverlay]}>
          <Animated.Text style={[styles.resultIcon, { transform: [{ scale: pulseAnim }] }]}>✅</Animated.Text>
          <Text style={styles.resultName}>{result.userName}</Text>
          <Text style={styles.resultId}>ID: {result.userId}</Text>
          <Text style={styles.resultSim}>
            Match: {(result.similarity * 100).toFixed(1)}%  |  {inferenceMs}ms
          </Text>
          <Text style={styles.resultTimestamp}>{new Date().toLocaleTimeString()}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={retry}>
            <Text style={styles.retryText}>Authenticate Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'fail' && (
        <View style={[styles.resultOverlay, styles.failOverlay]}>
          <Text style={styles.resultIcon}>❌</Text>
          <Text style={styles.resultTitle}>Access Denied</Text>
          <Text style={styles.resultSub}>Face not recognized</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={retry}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'spoof' && (
        <View style={[styles.resultOverlay, styles.spoofOverlay]}>
          <Text style={styles.resultIcon}>⚠️</Text>
          <Text style={styles.resultTitle}>Spoof Detected</Text>
          <Text style={styles.resultSub}>Presentation attack blocked</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={retry}>
            <Text style={styles.retryText}>Use Real Face</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Live challenge UI */}
      {(step === 'liveness' || step === 'recognizing') && (
        <View style={styles.challengeOverlay}>
          <View style={styles.faceGuide} />
          <View style={styles.challengeBox}>
            <Text style={styles.challengeText}>{challengeText}</Text>
            {livenessState && (
              <View style={styles.progressRow}>
                {livenessState.challenges.map((_, i) => (
                  <View key={i} style={[
                    styles.progressDot,
                    livenessState.completed[i] && styles.progressDotDone,
                  ]} />
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { ...StyleSheet.absoluteFillObject },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D1B2A' },
  errorText: { color: '#EF5350' },
  challengeOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
  },
  faceGuide: {
    width: 230, height: 290, borderRadius: 115,
    borderWidth: 3, borderColor: '#00E5FF', borderStyle: 'dashed',
    marginBottom: 24,
  },
  challengeBox: {
    backgroundColor: '#0D1B2ACC', borderRadius: 14,
    padding: 16, alignItems: 'center', width: '85%',
  },
  challengeText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  progressRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  progressDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#546E7A', borderWidth: 2, borderColor: '#00E5FF',
  },
  progressDotDone: { backgroundColor: '#00E676' },
  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center', padding: 30,
  },
  successOverlay: { backgroundColor: '#0A2E1A' },
  failOverlay: { backgroundColor: '#2E0A0A' },
  spoofOverlay: { backgroundColor: '#2E200A' },
  resultIcon: { fontSize: 80, marginBottom: 16 },
  resultName: { fontSize: 32, fontWeight: '800', color: '#00E676', marginBottom: 4 },
  resultId: { fontSize: 16, color: '#78909C', marginBottom: 12 },
  resultTitle: { fontSize: 28, fontWeight: '800', color: '#EF5350', marginBottom: 8 },
  resultSub: { fontSize: 16, color: '#78909C', marginBottom: 24 },
  resultSim: { fontSize: 14, color: '#80CBC4', marginBottom: 4 },
  resultTimestamp: { fontSize: 12, color: '#546E7A', marginBottom: 32 },
  retryBtn: {
    backgroundColor: '#263238', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14,
  },
  retryText: { color: '#00E5FF', fontWeight: '700', fontSize: 16 },
});
