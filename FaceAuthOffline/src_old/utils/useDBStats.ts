import { useState, useEffect } from 'react';
import { FaceDB } from '../storage/FaceDB';

export interface DBStats {
  totalEnrolled: number;
  pendingSync: number;
  totalLogs: number;
}

export function useDBStats(): DBStats {
  const [stats, setStats] = useState<DBStats>({ totalEnrolled: 0, pendingSync: 0, totalLogs: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const s = await FaceDB.getStats();
        setStats(s);
      } catch (err) {
        console.warn('[useDBStats] Failed to fetch database stats:', err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  return stats;
}
