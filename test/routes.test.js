import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import Fastify from 'fastify';

// Use a test database
process.env.NODE_ENV = 'test';

// We'll test the routes by building the app
import { registerRoutes } from '../src/routes.js';
import { getCurrentDay } from '../src/day.js';

const participants = JSON.parse(readFileSync('participants.json', 'utf-8'));

describe('API Routes', () => {
  let app;

  before(async () => {
    // Clean test db
    rmSync('data/challenge-test.db', { force: true });

    app = Fastify();
    registerRoutes(app, participants);
    await app.ready();
  });

  after(async () => {
    await app.close();
    rmSync('data/challenge-test.db', { force: true });
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
  });

  describe('GET /:code', () => {
    it('redirects valid code to /', async () => {
      const code = participants[0].code;
      const res = await app.inject({ method: 'GET', url: `/${code}` });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, `/?code=${code}`);
    });

    it('returns 404 for invalid code', async () => {
      const res = await app.inject({ method: 'GET', url: '/invalidcode' });
      assert.equal(res.statusCode, 404);
    });
  });
});
