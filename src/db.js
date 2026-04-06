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
    )
  `);

  return db;
}

function getAllCheckins() {
  return getDb().prepare('SELECT code, day, sets, checked_at FROM checkins ORDER BY day DESC').all();
}

function getCheckin(code, day) {
  return getDb().prepare('SELECT code, day, sets, checked_at FROM checkins WHERE code = ? AND day = ?').get(code, day);
}

function insertCheckin(code, day, sets) {
  const checked_at = new Date().toISOString();
  getDb().prepare('INSERT INTO checkins (code, day, sets, checked_at) VALUES (?, ?, ?, ?)').run(code, day, sets, checked_at);
  return { code, day, sets, checked_at };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export { getDb, getAllCheckins, getCheckin, insertCheckin, closeDb };
