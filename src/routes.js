import { getCurrentDay } from './day.js';
import { getAllCheckins, getCheckin, insertCheckin, upsertSubscription } from './db.js';
import { getPublicKey, notifyAllExcept } from './push.js';

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
    const day = request.body?.day ?? today;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > today) {
      return reply.status(400).send({ error: 'Day must be between 1 and today' });
    }

    const existing = getCheckin(code, day);
    if (existing) {
      return reply.status(409).send({ error: 'Already checked in for this day' });
    }

    insertCheckin(code, day, sets);

    // Send push notification to others if checking in for today
    if (day === today) {
      notifyAllExcept(code, {
        title: 'Push-Up Challenge 💪',
        body: `${codeToName[code]} heeft dag ${day} gehaald!`,
      }).catch(err => console.error('Notify failed:', err));
    }

    return { success: true, day, sets };
  });

  // Web Push endpoints
  app.get('/api/push/key', async () => {
    return { publicKey: getPublicKey() };
  });

  app.post('/api/push/subscribe', async (request, reply) => {
    const code = request.headers['x-participant-code'];
    if (!code || !codeSet.has(code)) {
      return reply.status(401).send({ error: 'Invalid participant code' });
    }
    const subscription = request.body?.subscription;
    if (!subscription || !subscription.endpoint) {
      return reply.status(400).send({ error: 'Invalid subscription' });
    }
    upsertSubscription(code, subscription);
    return { success: true };
  });
}

export { registerRoutes };
