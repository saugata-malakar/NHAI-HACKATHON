/**
 * FaceAuth Offline — App root
 * Boots: DB init → migration → LSH warm → security check → onboarding gate → main nav
 */
import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { ModelLoader } from './src/ml/ModelLoader';
import { FaceDB } from './src/storage/FaceDB';
import { SyncManager } from './src/storage/SyncManager';
import { SecurityService } from './src/services/SecurityService';
import { EdgeLogger } from './src/utils/EdgeLogger';

// Sentry init with biometric scrubber
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? '',
  enabled: !__DEV__,
  beforeSend(event) {
    // Scrub any biometric fields before upload
    const scrub = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      const BLOCKED = ['embedding', 'similarity', 'userId', 'user_id', 'facePixels'];
      for (const key of Object.keys(obj)) {
        if (BLOCKED.some(b => key.toLowerCase().includes(b.toLowerCase()))) {
          obj[key] = '[SCRUBBED]';
        } else {
          obj[key] = scrub(obj[key]);
        }
      }
      return obj;
    };
    return scrub(event);
  },
});

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // 1. Security check first — abort on compromised device
        const safe = await SecurityService.checkDeviceIntegrity();
        if (!safe) return; // Alert shown inside checkDeviceIntegrity

        // 2. DB + migrations
        await FaceDB.init();

        // 3. Load TFLite models (non-blocking warm-start)
        ModelLoader.loadAll().catch(e =>
          EdgeLogger.error(`[App] Model load failed: ${e.message}`)
        );

        // 4. Network sync listener
        SyncManager.startListener();

        // 5. Background sync task
        SyncManager.startBackgroundSync().catch(() => {});

        // 6. Inactivity watcher
        SecurityService.startInactivityWatcher();

        setReady(true);
        EdgeLogger.sys('[App] Boot complete');
      } catch (e: any) {
        setError(e.message);
        EdgeLogger.error(`[App] Boot error: ${e.message}`);
      }
    })();

    return () => {
      SyncManager.stopListener();
      SyncManager.stopBackgroundSync();
      SecurityService.stopInactivityWatcher();
    };
  }, []);

  if (error) return (
    <View style={s.center}>
      <Text style={s.errorTitle}>Boot Failed</Text>
      <Text style={s.errorMsg}>{error}</Text>
    </View>
  );

  if (!ready) return (
    <View style={s.center}>
      <ActivityIndicator color="#00E5FF" size="large" />
      <Text style={s.loadingText}>Initializing secure storage…</Text>
    </View>
  );

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0D1B2A" />
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0D1B2A', justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { color: '#78909C', marginTop: 16, fontSize: 14 },
  errorTitle: { color: '#EF5350', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  errorMsg: { color: '#78909C', fontSize: 13, textAlign: 'center' },
});
