/**
 * SecurityService
 * Phase 6 — Security hardening:
 *  - Jailbreak / root detection (blocks all biometric operations if detected)
 *  - Screenshot prevention on sensitive screens
 *  - Inactivity session timeout (5 min → force re-PIN)
 *  - SSL pinning note (configured in network_security_config.xml / NSAppTransportSecurity)
 */

import { Platform, Alert } from 'react-native';
import JailMonkey from 'react-native-jail-monkey';
import PreventScreenshot from 'react-native-prevent-screenshot';
import { EdgeLogger } from '../utils/EdgeLogger';
import { invalidateAdminSession } from '../hooks/useAdminAuth';

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
let lastActivityAt = Date.now();
let inactivityTimer: ReturnType<typeof setInterval> | null = null;

export const SecurityService = {

  /** Call once in App.tsx useEffect. Returns false if device is compromised. */
  async checkDeviceIntegrity(): Promise<boolean> {
    try {
      const compromised = JailMonkey.isJailBroken();
      if (compromised) {
        EdgeLogger.error('[Security] COMPROMISED DEVICE detected — all biometric operations disabled');
        Alert.alert(
          'Security Alert',
          'This device appears to be rooted or jailbroken.\n\nBiometric authentication cannot run securely on a compromised device. The app will not function until device integrity is restored.',
          [{ text: 'Understood', style: 'destructive' }],
          { cancelable: false },
        );
        return false;
      }
    } catch (e: any) {
      // JailMonkey not available in dev — log and continue
      EdgeLogger.sys(`[Security] JailMonkey check skipped: ${e.message}`);
    }
    return true;
  },

  /** Call in useEffect on camera/ledger screens */
  enableScreenshotPrevention(): void {
    try {
      PreventScreenshot.enabled(true);
      EdgeLogger.sys('[Security] Screenshot prevention ON');
    } catch (e: any) {
      EdgeLogger.error(`[Security] Screenshot prevention failed: ${e.message}`);
    }
  },

  disableScreenshotPrevention(): void {
    try { PreventScreenshot.enabled(false); } catch { /* ignore */ }
  },

  /** Record user activity to reset inactivity timeout */
  recordActivity(): void {
    lastActivityAt = Date.now();
  },

  /** Start inactivity watcher — call in App.tsx */
  startInactivityWatcher(): void {
    if (inactivityTimer) clearInterval(inactivityTimer);
    inactivityTimer = setInterval(() => {
      if (Date.now() - lastActivityAt > INACTIVITY_TIMEOUT_MS) {
        invalidateAdminSession();
        EdgeLogger.sys('[Security] Session invalidated due to inactivity');
      }
    }, 30_000); // check every 30s
  },

  stopInactivityWatcher(): void {
    if (inactivityTimer) { clearInterval(inactivityTimer); inactivityTimer = null; }
  },
};

/*
 * SSL PINNING SETUP (manual steps — cannot be done purely in JS):
 *
 * Android: android/app/src/main/res/xml/network_security_config.xml
 *   <network-security-config>
 *     <domain-config>
 *       <domain includeSubdomains="true">s3.amazonaws.com</domain>
 *       <domain includeSubdomains="true">dynamodb.ap-south-1.amazonaws.com</domain>
 *       <pin-set>
 *         <pin digest="SHA-256">AWS_ROOT_CA_PIN_BASE64_HERE</pin>
 *       </pin-set>
 *     </domain-config>
 *   </network-security-config>
 *
 * iOS: Info.plist → NSAppTransportSecurity → NSPinnedDomains
 *   Use react-native-ssl-pinning for fetch-level pinning as fallback.
 *
 * Get current AWS pin: openssl s_client -connect s3.amazonaws.com:443 | \
 *   openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | \
 *   openssl dgst -sha256 -binary | base64
 */
