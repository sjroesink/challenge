import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

let db;

function getDb() {
  if (db) return db;

  const dbName = process.env.NODE_ENV === 'test' ? 'challenge-test.db' : 'challenge.db';
  const dbPath = join(process.cwd(), 'data', dbName);
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

// Migration v0 → v1: drop the day-keyed `checkins` table in favor of a fine-grained
// per-set table. Old motion_recordings (PK code+day) get re-linked to the synthetic
// sets we materialise. Each old checkin (`sets=N`) becomes ONE set with reps=day,
// because participants so far always hit the daily rep target in a single set.
function runMigrations(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version >= 1) return;

  const hasOldCheckins = !!db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='checkins'`
  ).get();
  const hasOldMotion = !!db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='motion_recordings'`
  ).get();

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        subscription TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    if (hasOldCheckins) {
      // Stash the day-keyed motion_recordings so we can rebuild it under the
      // new schema and copy the rows over.
      if (hasOldMotion) {
        db.exec(`ALTER TABLE motion_recordings RENAME TO motion_recordings_old`);
      }

      db.exec(`
        CREATE TABLE sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL,
          day INTEGER NOT NULL,
          reps INTEGER NOT NULL CHECK (reps > 0),
          recorded_at TEXT NOT NULL
        );
        CREATE INDEX idx_sets_code_day ON sets(code, day);

        CREATE TABLE motion_recordings (
          set_id INTEGER PRIMARY KEY,
          recorded_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          sample_count INTEGER NOT NULL,
          raw_data TEXT NOT NULL,
          analyzed_pushups INTEGER,
          analyzed_sets INTEGER,
          analysis_meta TEXT,
          FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE
        );
      `);

      const oldCheckins = db.prepare(
        `SELECT code, day, checked_at FROM checkins ORDER BY day ASC, checked_at ASC`
      ).all();
      const insertSet = db.prepare(
        `INSERT INTO sets (code, day, reps, recorded_at) VALUES (?, ?, ?, ?)`
      );
      const codeDayToSetId = new Map();
      for (const c of oldCheckins) {
        const result = insertSet.run(c.code, c.day, c.day, c.checked_at);
        codeDayToSetId.set(`${c.code}:${c.day}`, result.lastInsertRowid);
      }

      if (hasOldMotion) {
        const oldMotion = db.prepare(`
          SELECT code, day, recorded_at, duration_ms, sample_count, raw_data,
                 analyzed_pushups, analyzed_sets, analysis_meta
          FROM motion_recordings_old
        `).all();
        const insertMotion = db.prepare(`
          INSERT INTO motion_recordings
            (set_id, recorded_at, duration_ms, sample_count, raw_data,
             analyzed_pushups, analyzed_sets, analysis_meta)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const m of oldMotion) {
          const setId = codeDayToSetId.get(`${m.code}:${m.day}`);
          if (setId) {
            insertMotion.run(
              setId, m.recorded_at, m.duration_ms, m.sample_count, m.raw_data,
              m.analyzed_pushups, m.analyzed_sets, m.analysis_meta,
            );
          }
        }
        db.exec(`DROP TABLE motion_recordings_old`);
      }

      db.exec(`DROP TABLE checkins`);
    } else {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL,
          day INTEGER NOT NULL,
          reps INTEGER NOT NULL CHECK (reps > 0),
          recorded_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sets_code_day ON sets(code, day);

        CREATE TABLE IF NOT EXISTS motion_recordings (
          set_id INTEGER PRIMARY KEY,
          recorded_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          sample_count INTEGER NOT NULL,
          raw_data TEXT NOT NULL,
          analyzed_pushups INTEGER,
          analyzed_sets INTEGER,
          analysis_meta TEXT,
          FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE
        );
      `);
    }

    db.pragma('user_version = 1');
  });
  tx();
}

// ── sets ─────────────────────────────────────────────────────────────────

function insertSet(code, day, reps, recordedAt) {
  const at = recordedAt || new Date().toISOString();
  const result = getDb().prepare(
    `INSERT INTO sets (code, day, reps, recorded_at) VALUES (?, ?, ?, ?)`
  ).run(code, day, reps, at);
  return { id: result.lastInsertRowid, code, day, reps, recorded_at: at };
}

function updateSet(id, reps) {
  const result = getDb().prepare(`UPDATE sets SET reps = ? WHERE id = ?`).run(reps, id);
  return result.changes > 0;
}

function deleteSet(id) {
  const result = getDb().prepare(`DELETE FROM sets WHERE id = ?`).run(id);
  return result.changes > 0;
}

function getSet(id) {
  return getDb().prepare(
    `SELECT id, code, day, reps, recorded_at FROM sets WHERE id = ?`
  ).get(id);
}

function listSetsForCell(code, day) {
  return getDb().prepare(`
    SELECT s.id, s.code, s.day, s.reps, s.recorded_at,
           EXISTS(SELECT 1 FROM motion_recordings m WHERE m.set_id = s.id) AS has_motion
    FROM sets s
    WHERE s.code = ? AND s.day = ?
    ORDER BY s.recorded_at ASC, s.id ASC
  `).all(code, day);
}

function getDayTotal(code, day) {
  const row = getDb().prepare(
    `SELECT COALESCE(SUM(reps), 0) AS total FROM sets WHERE code = ? AND day = ?`
  ).get(code, day);
  return row.total;
}

function getProgressAggregates() {
  return getDb().prepare(`
    SELECT s.code, s.day,
           COUNT(*) AS num_sets,
           SUM(s.reps) AS total_reps,
           SUM(CASE WHEN m.set_id IS NOT NULL THEN 1 ELSE 0 END) AS has_motion_count
    FROM sets s
    LEFT JOIN motion_recordings m ON m.set_id = s.id
    GROUP BY s.code, s.day
    ORDER BY s.day DESC, s.code ASC
  `).all();
}

// ── motion recordings ────────────────────────────────────────────────────

function insertMotionRecording(setId, recording) {
  const recorded_at = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO motion_recordings
      (set_id, recorded_at, duration_ms, sample_count, raw_data,
       analyzed_pushups, analyzed_sets, analysis_meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    setId,
    recorded_at,
    recording.durationMs,
    recording.sampleCount,
    JSON.stringify(recording.rawData),
    recording.analysis?.pushups ?? null,
    recording.analysis?.sets ?? null,
    recording.analysis ? JSON.stringify(recording.analysis) : null,
  );
}

function getMotionRecording(setId) {
  return getDb().prepare(
    `SELECT set_id, recorded_at, duration_ms, sample_count, analyzed_pushups,
            analyzed_sets, analysis_meta
     FROM motion_recordings WHERE set_id = ?`
  ).get(setId);
}

function getMotionRecordingFull(setId) {
  return getDb().prepare(
    `SELECT set_id, recorded_at, duration_ms, sample_count, raw_data,
            analyzed_pushups, analyzed_sets, analysis_meta
     FROM motion_recordings WHERE set_id = ?`
  ).get(setId);
}

// ── push subscriptions ───────────────────────────────────────────────────

function getAllSubscriptions() {
  return getDb().prepare(`SELECT endpoint, code, subscription FROM push_subscriptions`).all()
    .map(r => ({ endpoint: r.endpoint, code: r.code, subscription: JSON.parse(r.subscription) }));
}

function upsertSubscription(code, subscription) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO push_subscriptions (endpoint, code, subscription, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET code = excluded.code, subscription = excluded.subscription
  `).run(subscription.endpoint, code, JSON.stringify(subscription), now);
}

function deleteSubscription(endpoint) {
  getDb().prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export {
  getDb,
  insertSet,
  updateSet,
  deleteSet,
  getSet,
  listSetsForCell,
  getDayTotal,
  getProgressAggregates,
  insertMotionRecording,
  getMotionRecording,
  getMotionRecordingFull,
  getAllSubscriptions,
  upsertSubscription,
  deleteSubscription,
  closeDb,
};
