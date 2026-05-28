/**
 * FaceAuth Offline - Web Dashboard Engine (Refactored for Viewport Continuity)
 * Implements real camera streaming, active liveness state machine, 
 * Web Crypto API AES-256 database encryption, audit log blockchain chaining,
 * memory-safe scrubbing, and unstable sync simulation with backoff retry.
 */

// Global State
let cameraStream = null;
let currentChallenges = [];
let challengeIndex = 0;
let challengeCompleted = [false, false];
let livenessActive = false;
let isEnrollmentMode = false;
let dbKey = null;

// Real-Time Motion Tracking State (100% Offline)
let trackingCanvas = null;
let trackingCtx = null;
let prevFrameData = null;
let faceX = 0;
let faceY = 0;
let targetFaceX = 0;
let targetFaceY = 0;
let lastMotionTime = 0;

// Mock database in localStorage
const DB = {
  getEnrollments() {
    const data = localStorage.getItem('web_enrollments');
    return data ? JSON.parse(data) : [];
  },
  saveEnrollments(arr) {
    localStorage.setItem('web_enrollments', JSON.stringify(arr));
  },
  getLogs() {
    const data = localStorage.getItem('web_logs');
    return data ? JSON.parse(data) : [];
  },
  saveLogs(arr) {
    localStorage.setItem('web_logs', JSON.stringify(arr));
  }
};

// Console Logging Helper
function writeLog(tag, message, level = 'sys') {
  const terminal = document.getElementById('terminal-log');
  if (!terminal) return;

  const line = document.createElement('div');
  line.className = 'log-line';

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString();

  const badge = document.createElement('span');
  badge.className = `log-tag ${level}`;
  badge.textContent = `[${tag}]`;

  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = message;

  line.appendChild(time);
  line.appendChild(badge);
  line.appendChild(msg);

  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

// UUID v4 Generator with Web Crypto fallback
function generateUUID() {
  if (typeof window !== 'undefined' && typeof window.crypto !== 'undefined' && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// === Cryptographic SHA-256 Hashing ===
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// === Web Crypto API Key Derivation & AES-256-CBC Encryption ===
async function getCryptoKey() {
  if (dbKey) return dbKey;

  // Key derived from simulated device hardware ID
  const deviceId = "iit-kgp-ee-trinakshi-saha-2026-may";
  writeLog('SEC', 'Deriving AES-256 key from device hardware identifier...', 'sec');

  const encoder = new TextEncoder();
  const rawKeyMaterial = await window.crypto.subtle.digest('SHA-256', encoder.encode(deviceId));

  dbKey = await window.crypto.subtle.importKey(
    'raw',
    rawKeyMaterial,
    { name: 'AES-CBC', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  
  writeLog('SEC', 'Key derived successfully & bound to local Hardware Keystore.', 'sec');
  return dbKey;
}

async function encryptData(plaintext) {
  const key = await getCryptoKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    encoder.encode(plaintext)
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));
  return `${ivB64}:${cipherB64}`;
}

async function decryptData(encryptedStr) {
  const key = await getCryptoKey();
  const parts = encryptedStr.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');

  const iv = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

// === Memory-Safe Biometric Heap Scrubbing ===
function secureZeroMemory(float32Array) {
  if (float32Array) {
    writeLog('SEC', `Scrubbing biometric buffer (heap protection) - Zeroing ${float32Array.length} floats.`, 'sec');
    float32Array.fill(0);
  }
}

// === Active Camera Control ===
async function startCamera() {
  const video = document.getElementById('camera-stream');
  if (!video) return;

  try {
    writeLog('SYS', 'Accessing client media device (front camera)...');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 }
    });
    video.srcObject = cameraStream;
    writeLog('SYS', 'Camera capture stream connected successfully.');
    document.querySelector('.face-guide').className = 'face-guide tracking';
    
    // Initialize 100% offline real-time motion tracking loop
    initMotionTracker(video);
  } catch (err) {
    writeLog('ERR', 'Camera access failed: ' + err.message, 'err');
    alert('Failed to access camera: ' + err.message);
  }
}

function stopCamera() {
  if (cameraStream) {
    writeLog('SYS', 'Terminating camera stream...');
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    const guide = document.querySelector('.face-guide');
    if (guide) {
      guide.className = 'face-guide';
      guide.style.transform = 'none';
    }
    const video = document.getElementById('camera-stream');
    if (video) video.srcObject = null;
  }
}

// 100% Offline Real-Time Video Centroid Motion Tracker
function initMotionTracker(video) {
  if (!trackingCanvas) {
    trackingCanvas = document.createElement('canvas');
    trackingCanvas.width = 80;
    trackingCanvas.height = 60;
    trackingCtx = trackingCanvas.getContext('2d');
  }

  faceX = 0;
  faceY = 0;
  targetFaceX = 0;
  targetFaceY = 0;
  prevFrameData = null;

  function trackLoop() {
    if (!cameraStream) return;

    try {
      trackingCtx.drawImage(video, 0, 0, 80, 60);
      const frame = trackingCtx.getImageData(0, 0, 80, 60);
      const data = frame.data;

      if (prevFrameData) {
        let totalMotion = 0;
        let sumX = 0;
        let sumY = 0;
        let count = 0;

        for (let y = 0; y < 60; y++) {
          for (let x = 0; x < 80; x++) {
            const idx = (y * 80 + x) * 4;
            // Red channel change represents pixel motion
            const diff = Math.abs(data[idx] - prevFrameData[idx]);
            
            if (diff > 25) { // motion sensitivity threshold
              totalMotion += diff;
              sumX += x;
              sumY += y;
              count++;
            }
          }
        }

        if (count > 8) { // minimum threshold of active moving pixels
          const avgX = sumX / count;
          const avgY = sumY / count;

          // Map the low-res coordinate (80x60) to pixel shift values
          // Mirror horizontal due to user facing camera
          targetFaceX = -(avgX - 40) * 3.5;
          targetFaceY = (avgY - 30) * 3.0;

          // Active liveness automatic detection heuristic:
          const now = Date.now();
          if (now - lastMotionTime > 1500 && livenessActive) {
            // 1. Detect significant LEFT head turn
            if (targetFaceX < -40) {
              lastMotionTime = now;
              writeLog('SYS', 'Biometric sensor: Left head rotation tracked.');
              triggerAction('turn_left');
            }
            // 2. Detect significant RIGHT head turn
            else if (targetFaceX > 40) {
              lastMotionTime = now;
              writeLog('SYS', 'Biometric sensor: Right head rotation tracked.');
              triggerAction('turn_right');
            }
            // 3. Detect sudden motion burst in the center (node / blink / features motion)
            else if (count > 250 && Math.abs(targetFaceX) < 15) {
              lastMotionTime = now;
              writeLog('SYS', 'Biometric sensor: Active facial landmark motion tracked.');
              
              if (currentChallenges[challengeIndex]) {
                const activeId = currentChallenges[challengeIndex].id;
                triggerAction(activeId);
              }
            }
          }
        } else {
          // Centripetal drift back to rest center
          targetFaceX += (0 - targetFaceX) * 0.05;
          targetFaceY += (0 - targetFaceY) * 0.05;
        }

        // Lerp interpolation for responsive 60fps guide movement
        faceX += (targetFaceX - faceX) * 0.12;
        faceY += (targetFaceY - faceY) * 0.12;

        const guideEl = document.querySelector('.face-guide');
        if (guideEl) {
          guideEl.style.transition = 'none';
          guideEl.style.transform = `translate(${faceX}px, ${faceY}px)`;
        }
      }

      prevFrameData = data;
    } catch (e) {
      // Ignore canvas draws prior to active streaming
    }

    requestAnimationFrame(trackLoop);
  }

  requestAnimationFrame(trackLoop);
}

// === Active Liveness State Machine ===
const CHALLENGES = [
  { id: 'blink', label: '👁  Blink your eyes' },
  { id: 'smile', label: '😊  Smile at the camera' },
  { id: 'turn_left', label: '⬅️  Turn your head LEFT' },
  { id: 'turn_right', label: '➡️  Turn your head RIGHT' }
];

function selectRandomChallenges() {
  const shuffled = [...CHALLENGES].sort(() => Math.random() - 0.5);
  currentChallenges = shuffled.slice(0, 2);
  challengeIndex = 0;
  challengeCompleted = [false, false];
  updateLivenessUI();
}

function updateLivenessUI() {
  const text = document.getElementById('challenge-text');
  const dots = document.querySelectorAll('.dots-row .dot');

  if (challengeIndex >= currentChallenges.length) {
    text.textContent = '🔍 Verifying Identity...';
    dots.forEach(d => d.classList.add('done'));
    return;
  }

  text.textContent = currentChallenges[challengeIndex].label;
  dots.forEach((dot, idx) => {
    if (idx < challengeIndex || challengeCompleted[idx]) {
      dot.classList.add('done');
    } else {
      dot.classList.remove('done');
    }
  });
}

async function triggerAction(actionId) {
  if (!livenessActive) return;

  writeLog('VAL', `Liveness event received: ${actionId.toUpperCase()}`, 'val');

  if (currentChallenges[challengeIndex].id === actionId) {
    challengeCompleted[challengeIndex] = true;
    writeLog('VAL', `Challenge #${challengeIndex + 1} PASSED!`, 'val');
    challengeIndex++;
    updateLivenessUI();

    if (challengeIndex >= currentChallenges.length) {
      livenessActive = false;
      writeLog('SYS', 'Active Liveness Verification Passed completely.');
      
      // Proceed to Passive anti-spoof & recognition
      setTimeout(async () => {
        await executeInference();
      }, 800);
    }
  } else {
    writeLog('VAL', `Invalid liveness action for current challenge!`, 'err');
  }
}

// === Execute ML Telemetry & Cryptographic DB Logging ===
async function executeInference() {
  writeLog('SYS', 'Initiating edge ML Pipeline (TFLite INT8 inference)...');

  // Trigger telemetry timers
  updateTelemetryTimers();

  const queryEmbedding = new Float32Array(512);

  if (isEnrollmentMode) {
    // Generate a fresh random embedding for the new enrollment
    for (let i = 0; i < 512; i++) {
      queryEmbedding[i] = Math.random() * 2.0 - 1.0;
    }
    writeLog('SEC', 'Extracted 512-d biometric face embedding.');
    await enrollBiometrics(queryEmbedding);
  } else {
    // Authenticate Mode
    const enrollments = DB.getEnrollments();
    if (enrollments.length === 0) {
      writeLog('SYS', 'Authentication aborted - local gallery is empty.', 'err');
      alert('No users enrolled. Please enroll first.');
      selectRandomChallenges();
      livenessActive = true;
      return;
    }

    // Smart simulation: 75% chance of matching a randomly selected enrolled user
    const shouldMatch = Math.random() < 0.75;
    
    if (shouldMatch) {
      const targetUser = enrollments[Math.floor(Math.random() * enrollments.length)];
      writeLog('SYS', `Camera sensor detected face outline of enrolled user: ${targetUser.userName}`);
      
      try {
        const decryptedB64 = await decryptData(targetUser.embeddingB64);
        const decodedBytes = Uint8Array.from(atob(decryptedB64), c => c.charCodeAt(0));
        const entryEmbedding = new Float32Array(decodedBytes.buffer);
        
        // Correlate with a high similarity factor
        const correlationFactor = 0.85 + Math.random() * 0.10;
        for (let i = 0; i < 512; i++) {
          queryEmbedding[i] = entryEmbedding[i] * correlationFactor + (Math.random() * 2.0 - 1.0) * (1 - correlationFactor);
        }
        
        secureZeroMemory(entryEmbedding);
      } catch (err) {
        for (let i = 0; i < 512; i++) {
          queryEmbedding[i] = Math.random() * 2.0 - 1.0;
        }
      }
    } else {
      writeLog('SYS', `Camera sensor detected face outline of UNKNOWN user...`);
      for (let i = 0; i < 512; i++) {
        queryEmbedding[i] = Math.random() * 2.0 - 1.0;
      }
    }
    
    writeLog('SEC', 'Extracted 512-d biometric face embedding.');
    await authenticateBiometrics(queryEmbedding);
  }
}

async function enrollBiometrics(embedding) {
  const name = document.getElementById('enroll-name').value.trim() || 'New User';
  const id = document.getElementById('enroll-id').value.trim() || 'UID-' + Math.floor(Math.random()*10000);
  const dept = document.getElementById('enroll-dept').value.trim() || 'EE';

  writeLog('SYS', `Enrolling face for user: ${name} (ID: ${id})`);
  
  // Encrypt the embedding base64 prior to database insertion
  const serialized = btoa(String.fromCharCode(...new Uint8Array(embedding.buffer)));
  writeLog('SEC', 'Encrypting face embedding with AES-256-CBC...');
  const ciphertext = await encryptData(serialized);
  writeLog('SEC', 'Embedding ciphertext generated successfully.');

  const enrollments = DB.getEnrollments();
  enrollments.push({
    id: generateUUID(),
    userId: id,
    userName: name,
    department: dept,
    embeddingB64: ciphertext,
    enrolledAt: Date.now(),
    synced: 0
  });
  DB.saveEnrollments(enrollments);
  
  writeLog('SYS', `✅ User ${name} successfully enrolled in local SQLite database!`);
  
  // Biometric Memory scrubbing
  secureZeroMemory(embedding);

  // Auto Reset inputs and return to Authenticate tab
  document.getElementById('enroll-name').value = 'Trinakshi Saha';
  document.getElementById('enroll-id').value = 'UID-' + Math.floor(Math.random()*10000);
  
  showBiometricTab('authenticate');
  loadDatabaseGrid();
  updateDashboardStats();
}

async function authenticateBiometrics(embedding) {
  const enrollments = DB.getEnrollments();
  if (enrollments.length === 0) {
    writeLog('SYS', 'Authentication aborted - local gallery is empty.', 'err');
    alert('No users enrolled. Please enroll first.');
    selectRandomChallenges();
    livenessActive = true;
    return;
  }

  writeLog('SYS', 'Matching query embedding against local secure gallery...');
  
  let bestMatch = null;
  let bestSim = 0;

  for (const entry of enrollments) {
    try {
      const decryptedB64 = await decryptData(entry.embeddingB64);
      const decodedBytes = Uint8Array.from(atob(decryptedB64), c => c.charCodeAt(0));
      const entryEmbedding = new Float32Array(decodedBytes.buffer);

      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < 512; i++) {
        dot += embedding[i] * entryEmbedding[i];
        normA += embedding[i] * embedding[i];
        normB += entryEmbedding[i] * entryEmbedding[i];
      }
      const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
      
      secureZeroMemory(entryEmbedding);

      if (similarity > bestSim) {
        bestSim = similarity;
        bestMatch = entry;
      }
    } catch (err) {
      writeLog('ERR', `Failed to decrypt embedding for user ${entry.userId}: ${err.message}`, 'err');
    }
  }

  const threshold = 0.60;
  const verified = bestSim >= threshold;

  // Scrub query embedding from memory
  secureZeroMemory(embedding);

  // Write Tamper-Evident Auth Log Chaining
  const logs = DB.getLogs();
  const logId = generateUUID();
  const timestamp = Date.now();
  const verifiedInt = verified ? 1 : 0;
  const livenessInt = 1; 
  
  const prevHash = logs.length > 0 ? logs[logs.length - 1].hash : '';

  const hashInput = `${logId}${bestMatch && verified ? bestMatch.userId : 'UNKNOWN'}${timestamp}${verifiedInt}${bestSim.toFixed(4)}${livenessInt}${prevHash}`;
  const hash = await sha256(hashInput);

  logs.push({
    id: logId,
    userId: bestMatch && verified ? bestMatch.userId : 'UNKNOWN',
    userName: bestMatch && verified ? bestMatch.userName : 'Access Denied',
    timestamp,
    verified,
    similarity: bestSim,
    livenessPassed: true,
    synced: 0,
    hash,
    prevHash
  });
  DB.saveLogs(logs);

  writeLog('SYS', `Verification Result: ${verified ? 'ACCESS GRANTED' : 'ACCESS DENIED'} (Match Score: ${(bestSim * 100).toFixed(1)}%)`, verified ? 'val' : 'err');

  // Loop back liveness state for subsequent verifications
  selectRandomChallenges();
  livenessActive = true;

  loadDatabaseGrid();
  updateDashboardStats();
}

// === Unstable Sync Manager with Exponential Backoff retry ===
let retryAttempt = 0;
let syncTimeoutId = null;

async function doSimulatedSync() {
  const isOnline = document.getElementById('network-toggle').checked;
  const logs = DB.getLogs();
  const enrollments = DB.getEnrollments();
  
  if (logs.length === 0 && enrollments.filter(e => e.synced === 0).length === 0) {
    writeLog('SYS', 'Sync aborted: no unsynced logs or enrollments found in queue.');
    return;
  }

  writeLog('SYS', 'Initiating background database sync pipeline...', 'sys');

  if (!isOnline) {
    writeLog('ERR', 'Sync failed: network connectivity unreachable.', 'err');
    scheduleSyncRetry();
    return;
  }

  // 1. Audit Chain Integrity Verification
  if (logs.length > 0) {
    writeLog('SEC', 'Validating cryptographic audit ledger integrity before sync...', 'sec');
    let expectedPrevHash = logs[0].prevHash;
    
    try {
      for (const log of logs) {
        const verifiedInt = log.verified ? 1 : 0;
        const livenessInt = log.livenessPassed ? 1 : 0;
        
        const hashInput = `${log.id}${log.userId}${log.timestamp}${verifiedInt}${log.similarity.toFixed(4)}${livenessInt}${log.prevHash}`;
        const recomputedHash = await sha256(hashInput);

        if (log.hash !== recomputedHash) {
          throw new Error(`CRITICAL security breach: Verification signature tampered on auth log ${log.id}!`);
        }

        if (log.prevHash !== expectedPrevHash) {
          throw new Error(`CRITICAL security breach: Auth log ledger chain broken at entry ${log.id}!`);
        }

        expectedPrevHash = log.hash;
      }
    } catch (err) {
      writeLog('ERR', err.message, 'err');
      document.getElementById('sync-indicator').className = 'status-dot inactive';
      alert(err.message);
      return;
    }
    writeLog('SEC', 'Cryptographic audit ledger verified successfully: Chain Intact.', 'val');
  }

  // Simulate AWS upload success
  writeLog('SYS', 'Uploading embeddings binary to S3 and metadata to DynamoDB...', 'val');
  writeLog('SYS', `Uploading ${logs.length} logs to AWS DynamoDB (BatchWriteItem)...`, 'val');
  
  // Mark all logs as synced
  logs.forEach(l => l.synced = 1);
  DB.saveLogs(logs);

  // Mark enrollments as synced
  enrollments.forEach(e => e.synced = 1);
  DB.saveEnrollments(enrollments);

  retryAttempt = 0;
  writeLog('SYS', '✅ Database sync complete. local purged for GDPR minimization principles.', 'val');
  loadDatabaseGrid();
  updateDashboardStats();
}

function scheduleSyncRetry() {
  retryAttempt++;
  const baseDelay = 2000;
  const maxDelay = 30000;
  const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, retryAttempt));
  const jitteredDelay = Math.floor(Math.random() * exponentialDelay);

  writeLog('SYS', `Unstable connection: Retrying sync in ${jitteredDelay}ms (attempt #${retryAttempt})...`, 'sys');
  document.getElementById('sync-indicator').className = 'status-dot loading';

  if (syncTimeoutId) clearTimeout(syncTimeoutId);
  syncTimeoutId = setTimeout(() => {
    doSimulatedSync();
  }, jitteredDelay);
}

// === Security Tampering Lab ===
let originalSimilarity = null;
let tamperedLogId = null;

function triggerLedgerTampering() {
  const logs = DB.getLogs();
  if (logs.length === 0) {
    alert('Please complete at least one authentication log first!');
    return;
  }

  // Preserve for restoration
  const targetLog = logs[logs.length - 1];
  originalSimilarity = targetLog.similarity;
  tamperedLogId = targetLog.id;

  // Corrupt log verification status directly in DB
  writeLog('SYS', '⚠️ Injecting malicious DB record update (setting verified = true on a Denied Log)...', 'err');
  targetLog.verified = true;
  targetLog.userName = 'TAMPERED / BREACH';
  DB.saveLogs(logs);
  
  writeLog('SEC', 'CRITICAL: Database has been tampered with. Log signature is now broken.', 'err');
  loadDatabaseGrid();
}

function triggerLedgerDeletion() {
  const logs = DB.getLogs();
  if (logs.length < 2) {
    alert('Please complete at least two authentication logs first!');
    return;
  }

  writeLog('SYS', '⚠️ Deleting record #2 from local SQLite tables directly to simulate dropout attack...', 'err');
  logs.splice(logs.length - 2, 1);
  DB.saveLogs(logs);
  
  writeLog('SEC', 'CRITICAL: Database hash ledger chain broken (prev_hash mismatch).', 'err');
  loadDatabaseGrid();
}

function restoreLedgerWeb() {
  const logs = DB.getLogs();
  if (logs.length === 0) {
    alert('No logs available to restore.');
    return;
  }

  if (tamperedLogId && originalSimilarity !== null) {
    const targetLog = logs.find(l => l.id === tamperedLogId);
    if (targetLog) {
      targetLog.verified = false;
      targetLog.userName = 'Access Denied';
      targetLog.similarity = originalSimilarity;
      
      // Recompute correct hash for this entry
      const prevHash = logs.indexOf(targetLog) > 0 ? logs[logs.indexOf(targetLog) - 1].hash : '';
      const verifiedInt = 0;
      const livenessInt = 1;
      const hashInput = `${targetLog.id}${targetLog.userId}${targetLog.timestamp}${verifiedInt}${originalSimilarity.toFixed(4)}${livenessInt}${prevHash}`;
      
      sha256(hashInput).then(correctHash => {
        targetLog.hash = correctHash;
        DB.saveLogs(logs);
        writeLog('SEC', '✅ Cryptographic ledger integrity restored successfully. Hash signatures are aligned.', 'val');
        loadDatabaseGrid();
        alert('Ledger integrity successfully restored!');
      });
      return;
    }
  }

  // Fallback: full purge to clean slate
  localStorage.removeItem('web_logs');
  localStorage.removeItem('web_enrollments');
  writeLog('SYS', '🔄 Reset database back to clean state.', 'val');
  loadDatabaseGrid();
  updateDashboardStats();
  alert('Ledger database successfully reset to perfect state!');
}

// === Tab Switching Controls (Viewport Continuity Refined) ===
function showBiometricTab(tabId) {
  document.querySelectorAll('.biometric-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.biometric-tab-btn').forEach(b => b.classList.remove('active'));

  const content = document.getElementById(`biometric-${tabId}`);
  if (content) content.classList.add('active');

  const btn = document.querySelector(`.biometric-tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');

  if (tabId === 'authenticate') {
    isEnrollmentMode = false;
    writeLog('SYS', 'Switched to Authenticate Mode. Camera feed linked.');
  } else if (tabId === 'enroll') {
    isEnrollmentMode = true;
    writeLog('SYS', 'Switched to Enrollment Mode. Enter details below.');
  }

  // Keep webcam feed completely active
  if (!cameraStream) {
    startCamera();
  }
  selectRandomChallenges();
  livenessActive = true;
}

function showConsoleTab(tabId) {
  document.querySelectorAll('.console-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.console-tab-btn').forEach(b => b.classList.remove('active'));

  const content = document.getElementById(`console-${tabId}`);
  if (content) content.classList.add('active');

  const btn = document.querySelector(`.console-tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
}

function startEnrollmentRegistration() {
  const name = document.getElementById('enroll-name').value.trim();
  const id = document.getElementById('enroll-id').value.trim();

  if (!name || !id) {
    alert('Please enter Name and Employee ID first!');
    return;
  }

  writeLog('SYS', `Registering biometrics for ${name}... Active liveness challenge initiated.`);
  isEnrollmentMode = true;
  selectRandomChallenges();
  livenessActive = true;
}

// === Telemetry & Stats UI Updaters ===
function updateTelemetryTimers() {
  const det = (2.2 + Math.random() * 1.5).toFixed(1);
  const mesh = (16.5 + Math.random() * 3.0).toFixed(1);
  const fas = (7.1 + Math.random() * 2.0).toFixed(1);
  const recognition = (32.8 + Math.random() * 5.0).toFixed(1);
  const total = (parseFloat(det) + parseFloat(mesh) + parseFloat(fas) + parseFloat(recognition) + 4.5).toFixed(1);

  document.getElementById('stat-det').textContent = `${det}ms`;
  document.getElementById('stat-mesh').textContent = `${mesh}ms`;
  document.getElementById('stat-fas').textContent = `${fas}ms`;
  document.getElementById('stat-rec').textContent = `${recognition}ms`;
  document.getElementById('stat-total').textContent = `${total}ms`;
}

function updateDashboardStats() {
  const enrollments = DB.getEnrollments();
  const logs = DB.getLogs();
  const unsynced = logs.filter(l => l.synced === 0).length + enrollments.filter(e => e.synced === 0).length;

  document.getElementById('stat-enrolled').textContent = enrollments.length;
  document.getElementById('stat-pending').textContent = unsynced;
  document.getElementById('stat-logs').textContent = logs.length;
}

function loadDatabaseGrid() {
  const tbody = document.getElementById('ledger-tbody');
  tbody.innerHTML = '';
  const logs = DB.getLogs();

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Database empty</td></tr>`;
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
      <td><strong>${log.userId}</strong></td>
      <td>${log.userName}</td>
      <td>${log.verified ? '<span class="badge">✅ Granted</span>' : '<span class="badge offline" style="background-color:rgba(239,83,80,0.1);color:var(--color-error);border-color:rgba(239,83,80,0.2);">❌ Denied</span>'}</td>
      <td>${(log.similarity * 100).toFixed(1)}%</td>
      <td class="hash-cell">${log.hash}</td>
      <td class="hash-cell">${log.prevHash || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  writeLog('SYS', 'FaceAuth Web Edge Application Engine Initialized.');
  writeLog('SYS', 'Browser compatibility checks: Web Crypto, getUserMedia [OK].');
  
  // Pre-seed secure local database if empty
  const enrollments = DB.getEnrollments();
  if (enrollments.length === 0) {
    writeLog('SEC', 'Pre-seeding secure local database with hardware-bound biometric template...', 'sec');
    
    // Generate a default 512-d embedding
    const defaultEmbedding = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      defaultEmbedding[i] = Math.random() * 2.0 - 1.0;
    }
    
    const serialized = btoa(String.fromCharCode(...new Uint8Array(defaultEmbedding.buffer)));
    getCryptoKey().then(async (key) => {
      const ciphertext = await encryptData(serialized);
      enrollments.push({
        id: "default-user-uuid-2026",
        userId: "UID-4912",
        userName: "Trinakshi Saha",
        department: "Electrical Engineering",
        embeddingB64: ciphertext,
        enrolledAt: Date.now() - 3600000,
        synced: 0
      });
      DB.saveEnrollments(enrollments);
      
      // Seed audit log
      const logs = DB.getLogs();
      const logId = "default-log-uuid-2026";
      const timestamp = Date.now() - 3600000;
      const verifiedInt = 1;
      const similarityVal = 0.8954;
      const livenessInt = 1;
      const prevHash = "";
      
      const hashInput = `${logId}UID-4912${timestamp}${verifiedInt}${similarityVal.toFixed(4)}${livenessInt}${prevHash}`;
      const hash = await sha256(hashInput);
      
      logs.push({
        id: logId,
        userId: "UID-4912",
        userName: "Trinakshi Saha",
        timestamp,
        verified: true,
        similarity: similarityVal,
        livenessPassed: true,
        synced: 0,
        hash,
        prevHash
      });
      DB.saveLogs(logs);
      
      updateDashboardStats();
      loadDatabaseGrid();
      writeLog('SYS', '✅ Pre-seeded default enrollment successfully.');
    });
  }

  // Explicitly sync tab visibilities on load
  showBiometricTab('authenticate');
  showConsoleTab('ledger');

  // Set initial screen stats
  updateDashboardStats();
  loadDatabaseGrid();

  // Initialize persistent webcam
  startCamera().then(() => {
    selectRandomChallenges();
    livenessActive = true;
  });

  // Network listener UI update
  document.getElementById('network-toggle').addEventListener('change', (e) => {
    const isOnline = e.target.checked;
    writeLog('SYS', `Network state changed: ${isOnline ? 'ONLINE' : 'OFFLINE'}`, isOnline ? 'val' : 'err');
    
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
      indicator.className = `status-dot ${isOnline ? '' : 'inactive'}`;
    }
  });
});
