/**
 * AdminSession
 * Active administrative session tracker.
 * Implements a secure 5-minute inactivity sliding-window timeout.
 */

let lastAuthenticatedAt = 0;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5-minute active validation gate

export const AdminSession = {
  /**
   * Authorize session
   */
  authenticate(): void {
    lastAuthenticatedAt = Date.now();
  },

  /**
   * Lock session immediately
   */
  clear(): void {
    lastAuthenticatedAt = 0;
  },

  /**
   * Return true if the active administrative session is within the 5-minute window
   */
  isAuthenticated(): boolean {
    if (lastAuthenticatedAt === 0) return false;
    const age = Date.now() - lastAuthenticatedAt;
    return age < SESSION_TIMEOUT_MS;
  },

  /**
   * Get total elapsed time since active validation
   */
  getSessionAge(): number {
    if (lastAuthenticatedAt === 0) return Infinity;
    return Date.now() - lastAuthenticatedAt;
  },

  recordActivity(): void {
    if (lastAuthenticatedAt > 0) {
      lastAuthenticatedAt = Date.now();
    }
  }
};
