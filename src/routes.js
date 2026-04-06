import { getCurrentDay } from './day.js';
import { getAllCheckins, getCheckin, insertCheckin } from './db.js';

function registerRoutes(app, participants) {
  const codeSet = new Set(participants.map(p => p.code));

  // Progress endpoint — public (no codes exposed)
  const codeToName = Object.fromEntries(participants.map(p => [p.code, p.name]));

  app.get('/api/progress', async () => {
    const today = getCurrentDay();
    const checkins = getAllCheckins().map(c => ({
      name: codeToName[c.code],
      day: c.day,
      sets: c.sets,
    }));
    return {
      participants: participants.map(p => p.name),
      checkins,
      today
    };
  });

  // Identify current user by code
  app.get('/api/me', async (request, reply) => {
    const code = request.headers['x-participant-code'];
    if (!code || !codeToName[code]) {
      return reply.status(401).send({ error: 'Invalid participant code' });
    }
    return { name: codeToName[code] };
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
}

export { registerRoutes };
