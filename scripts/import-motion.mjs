import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

const path = process.argv[2];
const sets = process.argv[3] ? Number(process.argv[3]) : 1;
if (!path) {
  console.error('Usage: node scripts/import-motion.mjs <path-to-recording.json> [sets]');
  process.exit(1);
}

const data = JSON.parse(readFileSync(path, 'utf-8'));

mkdirSync('data', { recursive: true });
const db = new Database('data/challenge.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Recreate schema if missing (avoids running the server first).
db.exec(`
  CREATE TABLE IF NOT EXISTS checkins (
    code TEXT NOT NULL,
    day INTEGER NOT NULL,
    sets INTEGER NOT NULL,
    checked_at TEXT NOT NULL,
    gimmick_text TEXT,
    gimmick_video TEXT,
    PRIMARY KEY (code, day)
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
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    subscription TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const code = data.code;
const day = data.day;

const existingCheckin = db.prepare('SELECT 1 FROM checkins WHERE code = ? AND day = ?').get(code, day);
if (!existingCheckin) {
  db.prepare(`
    INSERT INTO checkins (code, day, sets, checked_at, gimmick_text, gimmick_video)
    VALUES (?, ?, ?, ?, NULL, NULL)
  `).run(code, day, sets, data.recordedAt);
  console.log(`Inserted checkin: ${code} day=${day} sets=${sets}`);
} else {
  console.log(`Checkin already exists: ${code} day=${day}`);
}

db.prepare('DELETE FROM motion_recordings WHERE code = ? AND day = ?').run(code, day);
db.prepare(`
  INSERT INTO motion_recordings
    (code, day, recorded_at, duration_ms, sample_count, raw_data, analyzed_pushups, analyzed_sets, analysis_meta)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  code, day, data.recordedAt, data.durationMs, data.sampleCount,
  JSON.stringify(data.raw),
  data.analyzedPushups, data.analyzedSets,
  data.analysisMeta ? JSON.stringify(data.analysisMeta) : null,
);

console.log(`Inserted motion: ${data.sampleCount} samples, ${data.analyzedPushups} pushups`);
db.close();
