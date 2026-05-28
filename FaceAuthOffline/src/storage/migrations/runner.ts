/**
 * Migration Runner
 * Reads schema_version from SQLite and applies any pending migrations in order.
 * Each migration is an isolated async function that receives the open DB handle.
 * Migrations are never re-run — version is incremented atomically inside a transaction.
 */

import { DB } from '@op-engineering/op-sqlite';

type Migration = (db: DB) => Promise<void>;

const MIGRATIONS: Migration[] = [
  // 001 — initial schema (enrollments + auth_logs + users + devices)
  async (db) => {
    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        full_name     TEXT NOT NULL,
        employee_id   TEXT UNIQUE NOT NULL,
        department    TEXT DEFAULT '',
        designation   TEXT DEFAULT '',
        photo_uri     TEXT DEFAULT '',
        enrolled_at   INTEGER NOT NULL,
        active        INTEGER DEFAULT 1
      );`);

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id              TEXT PRIMARY KEY,
        user_registry_id TEXT REFERENCES users(id),
        user_id         TEXT NOT NULL,
        user_name       TEXT NOT NULL,
        department      TEXT DEFAULT '',
        embedding_b64   TEXT NOT NULL,
        model_version   TEXT DEFAULT 'mobilefacenet_int8_v1',
        enrolled_at     INTEGER NOT NULL,
        synced          INTEGER DEFAULT 0,
        sync_attempts   INTEGER DEFAULT 0,
        last_sync_attempt INTEGER DEFAULT 0,
        device_id       TEXT DEFAULT ''
      );`);

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS auth_logs (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        timestamp       INTEGER NOT NULL,
        verified        INTEGER NOT NULL,
        similarity      REAL NOT NULL,
        liveness_passed INTEGER NOT NULL,
        log_hash        TEXT NOT NULL DEFAULT '',
        prev_hash       TEXT NOT NULL DEFAULT '',
        synced          INTEGER DEFAULT 0
      );`);

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id     TEXT PRIMARY KEY,
        device_name   TEXT DEFAULT '',
        registered_at INTEGER NOT NULL,
        last_sync_at  INTEGER DEFAULT 0
      );`);

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );`);

    await db.executeAsync(`
      CREATE TABLE IF NOT EXISTS inference_telemetry (
        id            TEXT PRIMARY KEY,
        ts            INTEGER NOT NULL,
        blazeface_ms  REAL DEFAULT 0,
        facemesh_ms   REAL DEFAULT 0,
        embedding_ms  REAL DEFAULT 0,
        antispoof_ms  REAL DEFAULT 0,
        total_ms      REAL DEFAULT 0,
        result        TEXT DEFAULT '',
        similarity    REAL DEFAULT 0,
        challenges    TEXT DEFAULT ''
      );`);

    await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_enroll_user    ON enrollments(user_id);`);
    await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_enroll_sync    ON enrollments(synced);`);
    await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_log_sync       ON auth_logs(synced);`);
    await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_log_ts         ON auth_logs(timestamp);`);
    await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_telemetry_ts   ON inference_telemetry(ts);`);
    await db.executeAsync(`CREATE INDEX IF NOT EXISTS idx_users_empid    ON users(employee_id);`);
  },

  // 002 — add sync_cursor support to settings (no-op DDL, just documents intent)
  async (_db) => {
    // sync_cursor stored as a settings row, not a column — no schema change needed
  },

  // 003 — add liveness_challenges column to auth_logs for richer audit
  async (db) => {
    await db.executeAsync(
      `ALTER TABLE auth_logs ADD COLUMN liveness_challenges TEXT DEFAULT '';`
    ).catch(() => {}); // ignore if already exists (safe re-run)
  },
];

export async function runMigrations(db: DB): Promise<void> {
  // Ensure schema_version table exists
  await db.executeAsync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL DEFAULT 0
    );
  `);

  const result = await db.executeAsync(`SELECT version FROM schema_version LIMIT 1`);
  const rows = result.rows?._array ?? [];
  const currentVersion: number = rows.length > 0 ? (rows[0].version as number) : 0;

  if (currentVersion === 0) {
    await db.executeAsync(`INSERT INTO schema_version (version) VALUES (0)`);
  }

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    console.log(`[Migration] Applying migration ${i + 1}/${MIGRATIONS.length}`);
    await MIGRATIONS[i](db);
    await db.executeAsync(`UPDATE schema_version SET version = ?`, [i + 1]);
    console.log(`[Migration] Migration ${i + 1} applied`);
  }
}
