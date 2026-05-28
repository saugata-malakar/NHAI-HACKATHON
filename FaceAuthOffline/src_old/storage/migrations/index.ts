/**
 * Migrations registry
 * Statically exported registry for React Native Metro bundler compatibility.
 * Replaces dynamic filesystem imports (which fail on native runtimes).
 */

import { DB } from '@op-engineering/op-sqlite';

export interface Migration {
  version: number;
  name: string;
  run: (db: DB) => Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial',
    run: async (db: DB) => {
      // 1. Create registry users table
      await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          employee_id TEXT UNIQUE NOT NULL,
          department TEXT DEFAULT '',
          designation TEXT DEFAULT '',
          photo_uri TEXT DEFAULT '',
          enrolled_at INTEGER NOT NULL,
          active INTEGER DEFAULT 1
        );
      `);

      // 2. Create enrollments table with user_registry_id foreign key
      await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS enrollments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          department TEXT DEFAULT '',
          embedding_b64 TEXT NOT NULL,
          enrolled_at INTEGER NOT NULL,
          synced INTEGER DEFAULT 0,
          device_id TEXT DEFAULT '',
          user_registry_id TEXT DEFAULT NULL,
          FOREIGN KEY(user_registry_id) REFERENCES users(id)
        );
      `);

      // 3. Create cryptographically chained auth logs table
      await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS auth_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          verified INTEGER NOT NULL,
          similarity REAL NOT NULL,
          liveness_passed INTEGER NOT NULL,
          synced INTEGER DEFAULT 0,
          hash TEXT NOT NULL,
          prev_hash TEXT DEFAULT ''
        );
      `);

      // 4. Create settings table for administrative PIN access control
      await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS settings (
          admin_pin_hash TEXT,
          admin_set_at INTEGER
        );
      `);

      // 5. Index declarations
      await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_enroll_user ON enrollments(user_id);`);
      await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_log_sync ON auth_logs(synced);`);
      await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_user_emp ON users(employee_id);`);
    }
  },
  {
    version: 2,
    name: '002_add_model_version',
    run: async (db: DB) => {
      // Safely alter enrollments table to add model_version column
      try {
        await db.executeAsync(`
          ALTER TABLE enrollments ADD COLUMN model_version TEXT DEFAULT 'mobilefacenet_int8_v1';
        `);
      } catch (err: any) {
        // Handle case where column might already exist in pre-existing test DBs
        if (!err?.message?.includes('duplicate column')) {
          throw err;
        }
      }
    }
  },
  {
    version: 3,
    name: '003_add_log_hash_and_prev_hash',
    run: async (db: DB) => {
      try {
        await db.executeAsync(`
          ALTER TABLE auth_logs ADD COLUMN log_hash TEXT NOT NULL DEFAULT '';
        `);
      } catch (err: any) {
        if (!err?.message?.includes('duplicate column')) {
          throw err;
        }
      }
    }
  },
  {
    version: 4,
    name: '004_observability_and_retry_queue',
    run: async (db: DB) => {
      // 1. Add stuck sync columns to enrollments table
      try {
        await db.executeAsync(`
          ALTER TABLE enrollments ADD COLUMN sync_attempts INTEGER DEFAULT 0;
        `);
      } catch (err: any) {
        if (!err?.message?.includes('duplicate column')) throw err;
      }
      try {
        await db.executeAsync(`
          ALTER TABLE enrollments ADD COLUMN last_sync_attempt INTEGER DEFAULT 0;
        `);
      } catch (err: any) {
        if (!err?.message?.includes('duplicate column')) throw err;
      }
      try {
        await db.executeAsync(`
          ALTER TABLE enrollments ADD COLUMN sync_error TEXT DEFAULT '';
        `);
      } catch (err: any) {
        if (!err?.message?.includes('duplicate column')) throw err;
      }

      // 2. Create inference_telemetry table
      await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS inference_telemetry (
          id TEXT PRIMARY KEY,
          event TEXT NOT NULL,
          blazeface_ms REAL NOT NULL,
          facemesh_ms REAL NOT NULL,
          embedding_ms REAL NOT NULL,
          antispoof_ms REAL NOT NULL,
          total_ms REAL NOT NULL,
          result TEXT NOT NULL,
          similarity REAL NOT NULL,
          liveness_challenges TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
      `);
    }
  }
];
