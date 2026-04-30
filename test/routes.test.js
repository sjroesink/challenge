import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import Fastify from 'fastify';

// Use a test database
process.env.NODE_ENV = 'test';

// We'll test the routes by building the app
import { registerRoutes } from '../src/routes.js';
import { getCurrentDay } from '../src/day.js';
import { closeDb } from '../src/db.js';

const participants = JSON.parse(readFileSync('participants.json', 'utf-8'));
const DB_PATH = 'data/challenge.db';

describe('API Routes', () => {
  let app;

  before(async () => {
    // Clean db from previous runs
    closeDb();
    rmSync(DB_PATH, { force: true });
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });

    app = Fastify();
    registerRoutes(app, participants);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
    rmSync(DB_PATH, { force: true });
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });
  });

  describe('GET /api/progress', () => {
    it('returns participants and empty checkins', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/progress' });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.participants));
      assert.ok(Array.isArray(body.checkins));
      assert.equal(typeof body.today, 'number');
    });
  });

  describe('POST /api/checkin', () => {
    it('rejects missing code header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        payload: { sets: 2 }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects invalid code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': 'doesnotexist' },
        payload: { sets: 2 }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects invalid sets', async () => {
      const code = participants[0].code;
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 0 }
      });
      assert.equal(res.statusCode, 400);
    });

    it('accepts valid checkin', async () => {
      const code = participants[0].code;
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 3 }
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.success, true);
      assert.equal(body.sets, 3);
      assert.equal(body.day, getCurrentDay());
    });

    it('rejects duplicate checkin for same day', async () => {
      const code = participants[0].code;
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 2 }
      });
      assert.equal(res.statusCode, 409);
    });

    it('accepts checkin with motion payload and stores analysis', async () => {
      const { getMotionRecording } = await import('../src/db.js');
      const code = participants[1].code;
      // Tiny synthetic motion: 30 samples of a sine on z-axis.
      const t = [], ax = [], ay = [], az = [];
      for (let i = 0; i < 30; i++) {
        t.push(i * 16);
        ax.push(0); ay.push(0);
        az.push(9.8 + 4 * Math.sin(i * 0.4));
      }
      const zeros = () => new Array(30).fill(0);
      const motion = {
        t, ax, ay, az,
        lax: zeros(), lay: zeros(), laz: zeros(),
        rx: zeros(), ry: zeros(), rz: zeros(),
        durationMs: 480, sampleCount: 30,
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 4, motion }
      });
      assert.equal(res.statusCode, 200);
      const stored = getMotionRecording(code, getCurrentDay());
      assert.ok(stored, 'motion recording should be stored');
      assert.equal(stored.sample_count, 30);
      assert.ok(stored.analysis_meta, 'analysis_meta should be present');
    });

    it('rejects motion payload with mismatched array lengths', async () => {
      // Validation runs before duplicate-check, so reusing an existing
      // participant still surfaces the 400.
      const code = participants[0].code;
      const motion = {
        t: [0, 16, 32], ax: [0, 0], ay: [0, 0, 0], az: [0, 0, 0],
        lax: [0, 0, 0], lay: [0, 0, 0], laz: [0, 0, 0],
        rx: [0, 0, 0], ry: [0, 0, 0], rz: [0, 0, 0],
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 1, motion }
      });
      assert.equal(res.statusCode, 400);
    });
  });

});
