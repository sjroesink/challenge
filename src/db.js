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

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export { getDb, getAllCheckins, getCheckin, insertCheckin, getAllSubscriptions, upsertSubscription, deleteSubscription, closeDb };
