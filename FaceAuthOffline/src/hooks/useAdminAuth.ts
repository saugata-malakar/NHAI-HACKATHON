/**
 * useAdminAuth
 * Returns { isAuthed, requestAuth, invalidate }.
 * Any screen that needs admin access calls requestAuth() which navigates
 * to AdminPinScreen if the session has expired (> SESSION_TIMEOUT_MS).
 *
 * Session state is module-level so it survives component unmounts.
 */

import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Module-level session — shared across all hook instances
let _lastVerifiedAt = 0;
let _isAuthed = false;

export function markAdminAuthed(): void {
  _lastVerifiedAt = Date.now();
  _isAuthed = true;
}

export function invalidateAdminSession(): void {
  _lastVerifiedAt = 0;
  _isAuthed = false;
}

export function isAdminSessionValid(): boolean {
  if (!_isAuthed) return false;
  return Date.now() - _lastVerifiedAt < SESSION_TIMEOUT_MS;
}

export function useAdminAuth() {
  const nav = useNavigation<any>();

  const requireAdmin = useCallback((onSuccess: () => void) => {
    if (isAdminSessionValid()) {
      onSuccess();
    } else {
      nav.navigate('AdminPin', { onSuccess });
    }
  }, [nav]);

  return { isAuthed: isAdminSessionValid(), requireAdmin, invalidate: invalidateAdminSession };
}
