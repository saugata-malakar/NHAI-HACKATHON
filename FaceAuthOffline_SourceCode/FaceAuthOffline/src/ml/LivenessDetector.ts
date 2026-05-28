/**
 * LivenessDetector
 * Two-layer anti-spoofing system:
 *
 * Layer 1 — ACTIVE (challenge-response):
 *   Randomly selects 2 of 3 challenges: Blink, Smile, Turn Head Left/Right
 *   Verified via facial landmark geometry (EAR, MAR, yaw angle)
 *   Resistant to: static photos, looped videos
 *
 * Layer 2 — PASSIVE (texture analysis):
 *   MiniFASNet v1 TFLite model classifies real vs. spoof
 *   Input: 80×80 face patch centered on detected face
 *   Resistant to: printed photos, screen replay, 3D masks
 *
 * Both layers must pass for liveness to be confirmed.
 */

import { ModelLoader } from './ModelLoader';
import { Landmarks, eyeAspectRatio, headYaw, smileIntensity } from './LandmarkDetector';

// ─── Active Liveness ──────────────────────────────────────────────────────────

export type Challenge = 'blink' | 'smile' | 'turn_left' | 'turn_right';

export interface ActiveLivenessState {
  challenges: Challenge[];         // ordered list of challenges to complete
  currentIndex: number;            // which challenge we're on
  completed: boolean[];            // completion status per challenge
  done: boolean;
}

export const CHALLENGE_LABELS: Record<Challenge, string> = {
  blink: '👁  Blink your eyes',
  smile: '😊  Smile at the camera',
  turn_left: '⬅️  Turn your head LEFT',
  turn_right: '➡️  Turn your head RIGHT',
};

// Thresholds
const EAR_CLOSED = 0.21;          // eyes-closed threshold
const EAR_OPEN = 0.28;            // eyes-open (post-blink) threshold
const SMILE_THRESHOLD = 0.52;     // smile detected
const YAW_THRESHOLD = 18;         // degrees of head rotation required

export function createLivenessSession(): ActiveLivenessState {
  // Randomly pick 2 of 4 challenges
  const pool: Challenge[] = ['blink', 'smile', 'turn_left', 'turn_right'];
  const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, 2);
  return {
    challenges: shuffled,
    currentIndex: 0,
    completed: [false, false],
    done: false,
  };
}

interface BlinkTracker {
  sawClosed: boolean;
  closedFrames: number;
}

const blinkTrackers: WeakMap<ActiveLivenessState, BlinkTracker> = new WeakMap();

/**
 * Feed a new set of landmarks to the active liveness state machine.
 * Returns updated state (immutable).
 */
export function updateActiveChallenge(
  state: ActiveLivenessState,
  lm: Landmarks,
): ActiveLivenessState {
  if (state.done) return state;

  const current = state.challenges[state.currentIndex];
  let passed = false;

  switch (current) {
    case 'blink': {
      if (!blinkTrackers.has(state)) blinkTrackers.set(state, { sawClosed: false, closedFrames: 0 });
      const tracker = blinkTrackers.get(state)!;
      const avgEAR = (eyeAspectRatio(lm, 'left') + eyeAspectRatio(lm, 'right')) / 2;

      if (avgEAR < EAR_CLOSED) {
        tracker.closedFrames++;
        if (tracker.closedFrames >= 2) tracker.sawClosed = true;
      } else if (tracker.sawClosed && avgEAR > EAR_OPEN) {
        passed = true; // blink complete: closed → open transition
      }
      break;
    }

    case 'smile': {
      const smile = smileIntensity(lm);
      passed = smile >= SMILE_THRESHOLD;
      break;
    }

    case 'turn_left': {
      const yaw = headYaw(lm);
      passed = yaw < -YAW_THRESHOLD; // negative = left
      break;
    }

    case 'turn_right': {
      const yaw = headYaw(lm);
      passed = yaw > YAW_THRESHOLD;
      break;
    }
  }

  if (!passed) return state;

  const completed = [...state.completed];
  completed[state.currentIndex] = true;
  const nextIndex = state.currentIndex + 1;
  const done = nextIndex >= state.challenges.length;

  return {
    ...state,
    currentIndex: nextIndex,
    completed,
    done,
  };
}

// ─── Passive Liveness (MiniFASNet) ───────────────────────────────────────────

const PASSIVE_LIVENESS_THRESHOLD = 0.82; // probability of being "real"
const PASSIVE_INPUT_SIZE = 80;

/**
 * Run passive anti-spoof on an 80×80 face patch.
 * @param facePatch Float32Array [80*80*3], values [0, 1]
 * @returns probability that the face is real (not a spoof)
 */
export async function passiveLivenessScore(facePatch: Float32Array): Promise<number> {
  const model = ModelLoader.get('minifas');
  const outputs = await model.run([facePatch]);
  const logits = outputs[0] as Float32Array; // [2]: [spoof_prob, real_prob]

  // Softmax
  const expSpoof = Math.exp(logits[0]);
  const expReal = Math.exp(logits[1]);
  return expReal / (expSpoof + expReal);
}

export async function isPassiveLivenessReal(facePatch: Float32Array): Promise<boolean> {
  const score = await passiveLivenessScore(facePatch);
  return score >= PASSIVE_LIVENESS_THRESHOLD;
}

export { PASSIVE_INPUT_SIZE };
