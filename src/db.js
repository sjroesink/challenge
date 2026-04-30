import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

let db;

function getDb() {
  if (db) return db;

  const dbPath = join(process.cwd(), 'data', 'challenge.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      code TEXT NOT NULL,
      day INTEGER NOT NULL,
      sets INTEGER NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (code, day)
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      subscription TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS motion_recordings (
      code TEXT NOT NULL,
      day INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      sample_count INTEGER NOT NULL,
      raw_data TEXT NOT NULL,
      analyzed_pushups INTEGER,
      analyzed_sets INTEGER,
      analysis_meta TEXT,
      PRIMARY KEY (code, day),
      FOREIGN KEY (code, day) REFERENCES checkins(code, day) ON DELETE CASCADE
    );
  `);

  // Migrations: add gimmick columns if missing
  const cols = db.prepare(`PRAGMA table_info(checkins)`).all().map(c => c.name);
  if (!cols.includes('gimmick_text')) {
    db.exec(`ALTER TABLE checkins ADD COLUMN gimmick_text TEXT`);
  }
  if (!cols.includes('gimmick_video')) {
    db.exec(`ALTER TABLE checkins ADD COLUMN gimmick_video TEXT`);
  }

  return db;
}

function getAllCheckins() {
  return getDb().prepare('SELECT code, day, sets, checked_at, gimmick_text, gimmick_video FROM checkins ORDER BY day DESC').all();
}

function getCheckin(code, day) {
  return getDb().prepare('SELECT code, day, sets, checked_at, gimmick_text, gimmick_video FROM checkins WHERE code = ? AND day = ?').get(code, day);
}

function insertCheckin(code, day, sets, gimmickText, gimmickVideo) {
  const checked_at = new Date().toISOString();
  getDb().prepare(
    'INSERT INTO checkins (code, day, sets, checked_at, gimmick_text, gimmick_video) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(code, day, sets, checked_at, gimmickText, gimmickVideo);
  return { code, day, sets, checked_at, gimmick_text: gimmickText, gimmick_video: gimmickVideo };
}

function getUsedGimmicks() {
  const rows = getDb().prepare('SELECT gimmick_text, gimmick_video FROM checkins WHERE gimmick_text IS NOT NULL').all();
  return {
    texts: rows.map(r => r.gimmick_text).filter(Boolean),
    videos: rows.map(r => r.gimmick_video).filter(Boolean),
  };
}

function getAllSubscriptions() {
  return getDb().prepare('SELECT endpoint, code, subscription FROM push_subscriptions').all()
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
  getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

function insertMotionRecording(code, day, recording) {
  const recorded_at = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO motion_recordings
      (code, day, recorded_at, duration_ms, sample_count, raw_data, analyzed_pushups, analyzed_sets, analysis_meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    day,
    recorded_at,
    recording.durationMs,
    recording.sampleCount,
    JSON.stringify(recording.rawData),
    recording.analysis?.pushups ?? null,
    recording.analysis?.sets ?? null,
    recording.analysis ? JSON.stringify(recording.analysis) : null,
  );
}

function getMotionRecording(code, day) {
  return getDb().prepare(
    'SELECT code, day, recorded_at, duration_ms, sample_count, analyzed_pushups, analyzed_sets, analysis_meta FROM motion_recordings WHERE code = ? AND day = ?'
  ).get(code, day);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export {
  getDb,
  getAllCheckins,
  getCheckin,
  insertCheckin,
  getUsedGimmicks,
  getAllSubscriptions,
  upsertSubscription,
  deleteSubscription,
  insertMotionRecording,
  getMotionRecording,
  closeDb,
};
