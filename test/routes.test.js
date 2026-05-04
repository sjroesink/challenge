import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

// Use a test database
process.env.NODE_ENV = 'test';

import { registerRoutes } from '../src/routes.js';
import { getCurrentDay } from '../src/day.js';
import { closeDb, getDb, getMotionRecording } from '../src/db.js';

const participants = JSON.parse(readFileSync('participants.json', 'utf-8'));
const DB_PATH = 'data/challenge-test.db';

function wipeDb() {
  closeDb();
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
}

function tinyMotion(samples = 30) {
  const t = [], ax = [], ay = [], az = [];
  for (let i = 0; i < samples; i++) {
    t.push(i * 16);
    ax.push(0);
    ay.push(0);
    az.push(9.8 + 4 * Math.sin(i * 0.4));
  }
  const zeros = () => new Array(samples).fill(0);
  return {
    t, ax, ay, az,
    lax: zeros(), lay: zeros(), laz: zeros(),
    rx: zeros(), ry: zeros(), rz: zeros(),
    durationMs: samples * 16,
    sampleCount: samples,
  };
}

describe('API Routes — set-based registration', () => {
  let app;
  const sander = participants.find(p => p.code === 'sander');
  const other = participants.find(p => p.code !== 'sander');

  before(async () => {
    wipeDb();
    app = Fastify();
    registerRoutes(app, participants);
    await app.ready();
  });

  after(async () => {
    await app.close();
    wipeDb();
  });

  describe('GET /api/progress', () => {
    it('returns participants, empty cells, and today', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/progress' });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.deepEqual(body.participants, participants.map(p => p.name));
      assert.deepEqual(body.cells, []);
      assert.equal(typeof body.today, 'number');
      assert.ok(body.today >= 1);
    });
  });

  describe('POST /api/sets — auth & validation', () => {
    it('rejects missing code header', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        payload: { day: 1, reps: 5 },
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects unknown code', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': 'doesnotexist' },
        payload: { day: 1, reps: 5 },
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects non-positive reps', async () => {
      for (const reps of [0, -1, 'foo', null, 1.5]) {
        const res = await app.inject({
          method: 'POST', url: '/api/sets',
          headers: { 'x-participant-code': sander.code },
          payload: { day: 1, reps },
        });
        assert.equal(res.statusCode, 400, `reps=${JSON.stringify(reps)} should be 400`);
      }
    });

    it('rejects day < 1 or > today', async () => {
      const today = getCurrentDay();
      for (const day of [0, -1, today + 1, 1.5, 'x']) {
        const res = await app.inject({
          method: 'POST', url: '/api/sets',
          headers: { 'x-participant-code': sander.code },
          payload: { day, reps: 5 },
        });
        assert.equal(res.statusCode, 400, `day=${JSON.stringify(day)} should be 400`);
      }
    });

    it('rejects motion payload with mismatched array lengths', async () => {
      const motion = {
        t: [0, 16, 32], ax: [0, 0], ay: [0, 0, 0], az: [0, 0, 0],
        lax: [0, 0, 0], lay: [0, 0, 0], laz: [0, 0, 0],
        rx: [0, 0, 0], ry: [0, 0, 0], rz: [0, 0, 0],
      };
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: 1, reps: 1, motion },
      });
      assert.equal(res.statusCode, 400);
    });
  });

  describe('POST /api/sets — backdated and aggregation', () => {
    it('accepts a backdated set on day 1 and returns dayTotal', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: 1, reps: 1 },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.day, 1);
      assert.equal(body.reps, 1);
      assert.equal(body.dayTotal, 1);
      assert.equal(body.hasMotion, false);
      assert.ok(Number.isInteger(body.id));
      assert.ok(body.recordedAt);
    });

    it('allows multiple sets on the same day, summing dayTotal', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: 1, reps: 2 },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.dayTotal, 3); // 1 + 2
    });

    it('exposes the cell via GET /api/sets/:name/:day', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/sets/${encodeURIComponent(sander.name)}/1`,
        headers: { 'x-participant-code': sander.code },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.name, sander.name);
      assert.equal(body.day, 1);
      assert.equal(body.target, 1);
      assert.equal(body.numSets, 2);
      assert.equal(body.totalReps, 3);
      assert.equal(body.isOwn, true);
      assert.equal(body.sets.length, 2);
      assert.equal(body.sets[0].reps, 1);
      assert.equal(body.sets[1].reps, 2);
      assert.equal(body.sets[0].hasMotion, false);
    });

    it('marks isOwn=false when caller is not the owner', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/sets/${encodeURIComponent(sander.name)}/1`,
        headers: { 'x-participant-code': other.code },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.isOwn, false);
    });
  });

  describe('POST /api/sets — push threshold for today', () => {
    // Push fires only when sum(reps) for today crosses >= today (= dayNumber).
    // Backdated sets never push. We can't observe the side-effect directly
    // (no subscriptions in test DB → notifyAllExcept short-circuits), but we
    // can verify the dayTotal math that drives the trigger.
    it('records partial progress on today without crossing the target', async () => {
      const today = getCurrentDay();
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: today, reps: Math.max(1, today - 5) },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.day, today);
      assert.ok(body.dayTotal < today, `dayTotal ${body.dayTotal} should be < target ${today}`);
    });

    it('crosses the target on the next set', async () => {
      const today = getCurrentDay();
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: today, reps: 10 },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.dayTotal >= today, `dayTotal ${body.dayTotal} should be >= target ${today}`);
    });

    it('further sets after target still succeed', async () => {
      const today = getCurrentDay();
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: today, reps: 1 },
      });
      assert.equal(res.statusCode, 200);
    });
  });

  describe('POST /api/sets — motion recording attached to set', () => {
    it('stores motion linked to the new set id', async () => {
      const motion = tinyMotion(30);
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': other.code },
        payload: { day: 2, reps: 4, motion },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.hasMotion, true);

      const stored = getMotionRecording(body.id);
      assert.ok(stored, 'motion recording should be stored for set id');
      assert.equal(stored.set_id, body.id);
      assert.equal(stored.sample_count, 30);
      assert.ok(stored.analysis_meta, 'analysis_meta should be present');
    });
  });

  describe('PUT /api/sets/:id', () => {
    let sanderSetId;

    before(async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: 3, reps: 5 },
      });
      sanderSetId = JSON.parse(res.body).id;
    });

    it('rejects unauthenticated', async () => {
      const res = await app.inject({
        method: 'PUT', url: `/api/sets/${sanderSetId}`,
        payload: { reps: 7 },
      });
      assert.equal(res.statusCode, 401);
    });

    it('returns 404 for unknown id', async () => {
      const res = await app.inject({
        method: 'PUT', url: `/api/sets/9999999`,
        headers: { 'x-participant-code': sander.code },
        payload: { reps: 7 },
      });
      assert.equal(res.statusCode, 404);
    });

    it('rejects non-owner with 403', async () => {
      const res = await app.inject({
        method: 'PUT', url: `/api/sets/${sanderSetId}`,
        headers: { 'x-participant-code': other.code },
        payload: { reps: 7 },
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects invalid reps', async () => {
      const res = await app.inject({
        method: 'PUT', url: `/api/sets/${sanderSetId}`,
        headers: { 'x-participant-code': sander.code },
        payload: { reps: 0 },
      });
      assert.equal(res.statusCode, 400);
    });

    it('updates reps and returns refreshed dayTotal', async () => {
      const res = await app.inject({
        method: 'PUT', url: `/api/sets/${sanderSetId}`,
        headers: { 'x-participant-code': sander.code },
        payload: { reps: 9 },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.id, sanderSetId);
      assert.equal(body.day, 3);
      assert.equal(body.reps, 9);
      assert.equal(body.dayTotal, 9);
    });
  });

  describe('DELETE /api/sets/:id', () => {
    let setId;

    before(async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: 4, reps: 3, motion: tinyMotion(20) },
      });
      setId = JSON.parse(res.body).id;
    });

    it('returns 403 for non-owner', async () => {
      const res = await app.inject({
        method: 'DELETE', url: `/api/sets/${setId}`,
        headers: { 'x-participant-code': other.code },
      });
      assert.equal(res.statusCode, 403);
    });

    it('returns 404 for unknown id', async () => {
      const res = await app.inject({
        method: 'DELETE', url: `/api/sets/9999999`,
        headers: { 'x-participant-code': sander.code },
      });
      assert.equal(res.statusCode, 404);
    });

    it('deletes the set and cascades the motion recording', async () => {
      assert.ok(getMotionRecording(setId), 'motion present before delete');

      const res = await app.inject({
        method: 'DELETE', url: `/api/sets/${setId}`,
        headers: { 'x-participant-code': sander.code },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.success, true);
      assert.equal(body.day, 4);
      assert.equal(body.dayTotal, 0);

      assert.equal(getMotionRecording(setId), undefined, 'motion should be cascade-deleted');
    });
  });

  describe('GET /api/motion/:setId', () => {
    let setIdWithMotion;
    let setIdNoMotion;

    before(async () => {
      const a = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: 5, reps: 5, motion: tinyMotion(40) },
      });
      setIdWithMotion = JSON.parse(a.body).id;
      const b = await app.inject({
        method: 'POST', url: '/api/sets',
        headers: { 'x-participant-code': sander.code },
        payload: { day: 5, reps: 1 },
      });
      setIdNoMotion = JSON.parse(b.body).id;
    });

    it('rejects unauthenticated', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/motion/${setIdWithMotion}` });
      assert.equal(res.statusCode, 401);
    });

    it('returns 404 for unknown set id', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/motion/9999999`,
        headers: { 'x-participant-code': sander.code },
      });
      assert.equal(res.statusCode, 404);
    });

    it('returns 404 for set without motion', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/motion/${setIdNoMotion}`,
        headers: { 'x-participant-code': sander.code },
      });
      assert.equal(res.statusCode, 404);
    });

    it('returns full motion data for set with recording', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/motion/${setIdWithMotion}`,
        headers: { 'x-participant-code': sander.code },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.setId, setIdWithMotion);
      assert.equal(body.name, sander.name);
      assert.equal(body.day, 5);
      assert.equal(body.reps, 5);
      assert.equal(body.sampleCount, 40);
      assert.ok(body.analysisMeta);
      assert.ok(body.raw);
      assert.equal(body.raw.t.length, 40);
    });

    it('any logged-in participant can read another\'s recording', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/motion/${setIdWithMotion}`,
        headers: { 'x-participant-code': other.code },
      });
      assert.equal(res.statusCode, 200);
    });
  });

  describe('GET /api/progress — aggregated per (name, day)', () => {
    it('aggregates multiple sets into one cell per (name, day)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/progress' });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);

      const day1Sander = body.cells.find(c => c.name === sander.name && c.day === 1);
      assert.ok(day1Sander);
      assert.equal(day1Sander.numSets, 2);
      assert.equal(day1Sander.totalReps, 3);
      assert.equal(day1Sander.hasMotionCount, 0);

      const day5Sander = body.cells.find(c => c.name === sander.name && c.day === 5);
      assert.ok(day5Sander);
      assert.equal(day5Sander.numSets, 2);
      assert.equal(day5Sander.totalReps, 6); // 5 + 1
      assert.equal(day5Sander.hasMotionCount, 1);
    });
  });
});

describe('Migration v0 → v1 — old day-keyed checkins to set rows', () => {
  before(() => {
    wipeDb();
    // Build the OLD schema by hand and seed it with realistic data.
    const raw = new Database(DB_PATH);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    raw.pragma('user_version = 0');
    raw.exec(`
      CREATE TABLE checkins (
        code TEXT NOT NULL,
        day INTEGER NOT NULL,
        sets INTEGER NOT NULL,
        checked_at TEXT NOT NULL,
        gimmick_text TEXT,
        gimmick_video TEXT,
        PRIMARY KEY (code, day)
      );
      CREATE TABLE push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        subscription TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE motion_recordings (
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
    raw.prepare(`INSERT INTO checkins (code, day, sets, checked_at, gimmick_text, gimmick_video) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('sander', 1, 1, '2026-04-01T10:00:00.000Z', 'old-text', 'old-video');
    raw.prepare(`INSERT INTO checkins (code, day, sets, checked_at, gimmick_text, gimmick_video) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('sander', 5, 1, '2026-04-05T10:00:00.000Z', 'old-text-2', null);
    raw.prepare(`INSERT INTO checkins (code, day, sets, checked_at, gimmick_text, gimmick_video) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('deelnemer2', 5, 1, '2026-04-05T11:00:00.000Z', null, null);
    raw.prepare(`
      INSERT INTO motion_recordings (code, day, recorded_at, duration_ms, sample_count, raw_data, analyzed_pushups, analyzed_sets, analysis_meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sander', 5, '2026-04-05T10:00:01.000Z', 4800, 50, '{"t":[]}', 5, 1, '{"pushups":5}');
    raw.close();
  });

  after(() => {
    wipeDb();
  });

  it('drops checkins, populates sets with reps=day, re-links motion to set_id', () => {
    const db = getDb(); // triggers runMigrations

    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(t => t.name);
    assert.ok(tables.includes('sets'), 'sets table should exist');
    assert.ok(tables.includes('motion_recordings'), 'motion_recordings table should exist');
    assert.ok(tables.includes('push_subscriptions'), 'push_subscriptions table should exist');
    assert.ok(!tables.includes('checkins'), 'old checkins table should be dropped');
    assert.ok(!tables.includes('motion_recordings_old'), 'temporary motion_recordings_old should be dropped');

    assert.equal(db.pragma('user_version', { simple: true }), 1);

    const sets = db.prepare(`SELECT code, day, reps, recorded_at FROM sets ORDER BY day, code`).all();
    assert.equal(sets.length, 3);
    assert.deepEqual(sets[0], { code: 'sander', day: 1, reps: 1, recorded_at: '2026-04-01T10:00:00.000Z' });
    assert.deepEqual(sets[1], { code: 'deelnemer2', day: 5, reps: 5, recorded_at: '2026-04-05T11:00:00.000Z' });
    assert.deepEqual(sets[2], { code: 'sander', day: 5, reps: 5, recorded_at: '2026-04-05T10:00:00.000Z' });

    // Find sander's day-5 set and confirm motion is re-linked to it.
    const sanderDay5 = db.prepare(`SELECT id FROM sets WHERE code = 'sander' AND day = 5`).get();
    const motion = db.prepare(`SELECT set_id, sample_count, analyzed_pushups FROM motion_recordings`).all();
    assert.equal(motion.length, 1);
    assert.equal(motion[0].set_id, sanderDay5.id);
    assert.equal(motion[0].sample_count, 50);
    assert.equal(motion[0].analyzed_pushups, 5);
  });

  it('is idempotent on a second run', () => {
    closeDb();
    const db = getDb();
    assert.equal(db.pragma('user_version', { simple: true }), 1);
    const sets = db.prepare(`SELECT COUNT(*) AS n FROM sets`).get();
    assert.equal(sets.n, 3, 'sets should be unchanged after re-running migrations');
  });

  it('handles a fresh DB (no checkins table) cleanly', () => {
    wipeDb();
    const db = getDb();
    assert.equal(db.pragma('user_version', { simple: true }), 1);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(t => t.name);
    assert.ok(tables.includes('sets'));
    assert.ok(tables.includes('motion_recordings'));
    assert.ok(tables.includes('push_subscriptions'));
  });
});
