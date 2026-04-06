import { getCurrentDay } from './day.js';
import { getAllCheckins, getCheckin, insertCheckin } from './db.js';

function registerRoutes(app, participants) {
  const codeSet = new Set(participants.map(p => p.code));

  // Progress endpoint — public
  app.get('/api/progress', async () => {
    const today = getCurrentDay();
    const checkins = getAllCheckins();
    return {
      participants: participants.map(p => ({ code: p.code, name: p.name })),
      checkins,
      today
    };
  });

  // Check-in endpoint — requires valid code
  app.post('/api/checkin', async (request, reply) => {
    const code = request.headers['x-participant-code'];
    if (!code || !codeSet.has(code)) {
      return reply.status(401).send({ error: 'Invalid participant code' });
    }

    const sets = request.body?.sets;
    if (!sets || typeof sets !== 'number' || sets < 1 || !Number.isInteger(sets)) {
      return reply.status(400).send({ error: 'Sets must be a positive integer' });
    }

    const today = getCurrentDay();
    const existing = getCheckin(code, today);
    if (existing) {
      return reply.status(409).send({ error: 'Already checked in today' });
    }

    insertCheckin(code, today, sets);
    return { success: true, day: today, sets };
  });

  // Code redirect — must be registered last (catch-all single segment)
  app.get('/:code', async (request, reply) => {
    const { code } = request.params;

    // Skip static files and api routes
    if (code.includes('.') || code === 'api') {
      return reply.status(404).send({ error: 'Not found' });
    }

    if (!codeSet.has(code)) {
      return reply.status(404).send({ error: 'Unknown participant code' });
    }

    return reply.redirect(`/?code=${code}`);
  });
}

export { registerRoutes };
