/**
 * useDBStats
 * Polls FaceDB.getStats() every 3 seconds.
 * Import in any screen that shows enrolled / pending / logs counters.
 */

import { useState, useEffect } from 'react';
import { FaceDB } from '../storage/FaceDB';

export interface DBStats {
  totalEnrolled: number;
  pendingSync: number;
  totalLogs: number;
  lshSize: number;
}

const DEFAULT: DBStats = { totalEnrolled: 0, pendingSync: 0, totalLogs: 0, lshSize: 0 };

export function useDBStats(intervalMs: number = 3000): DBStats {
  const [stats, setStats] = useState<DBStats>(DEFAULT);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const s = await FaceDB.getStats();
        if (!cancelled) setStats({ ...s, lshSize: s.totalEnrolled });
      } catch { /* DB not ready yet */ }
    };

    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return stats;
}
