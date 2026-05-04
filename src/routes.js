import { getCurrentDay } from './day.js';
import {
  insertSet,
  updateSet,
  deleteSet,
  getSet,
  listSetsForCell,
  getDayTotal,
  getProgressAggregates,
  upsertSubscription,
  insertMotionRecording,
  getMotionRecordingFull,
} from './db.js';
import { getPublicKey, notifyAllExcept } from './push.js';
import { analyzeMotion } from './motionAnalysis.js';

// Validate the motion payload shape sent by the browser. We don't trust
// anything: arrays must exist, all be the same length, and within sane bounds.
function validateMotion(motion) {
  if (motion == null) return null;
  if (typeof motion !== 'object') return 'motion must be an object';
  const { t, ax, ay, az, lax, lay, laz, rx, ry, rz } = motion;
  const arrays = { t, ax, ay, az, lax, lay, laz, rx, ry, rz };
  for (const [key, arr] of Object.entries(arrays)) {
    if (!Array.isArray(arr)) return `motion.${key} must be an array`;
  }
  const n = t.length;
  if (n === 0) return 'motion has no samples';
  if (n > 200000) return 'motion has too many samples';
  for (const [key, arr] of Object.entries(arrays)) {
    if (arr.length !== n) return `motion.${key} length mismatch`;
  }
  return null;
}

function storeMotionForSet(setId, motion, log) {
  try {
    const analysis = analyzeMotion(motion);
    insertMotionRecording(setId, {
      durationMs: motion.durationMs ?? (motion.t.at(-1) - motion.t[0]),
      sampleCount: motion.t.length,
      rawData: motion,
      analysis,
    });
    return true;
  } catch (err) {
    log?.error?.({ err }, 'Motion analysis/insert failed');
    return false;
  }
}

function registerRoutes(app, participants) {
  const codeSet = new Set(participants.map(p => p.code));
  const codeToName = Object.fromEntries(participants.map(p => [p.code, p.name]));
  const nameToCode = Object.fromEntries(participants.map(p => [p.name, p.code]));

  function requireCode(request, reply) {
    const code = request.headers['x-participant-code'];
    if (!code || !codeSet.has(code)) {
      reply.status(401).send({ error: 'Invalid participant code' });
      return null;
    }
    return code;
  }

  // ── Progress (public) ──
  app.get('/api/progress', async () => {
    const today = getCurrentDay();
    const cells = getProgressAggregates().map(r => ({
      name: codeToName[r.code],
      day: r.day,
      numSets: r.num_sets,
      totalReps: r.total_reps,
      hasMotionCount: r.has_motion_count,
    }));
    return {
      participants: participants.map(p => p.name),
      cells,
      today,
    };
  });

  // ── Identify current user by code ──
  app.get('/api/me', async (request, reply) => {
    const code = requireCode(request, reply);
    if (!code) return;
    return { name: codeToName[code] };
  });

  // ── List sets for one (participant, day) cell ──
  // Auth required (any participant can read any cell), URL uses :name to match the
  // frontend's name-based addressing.
  app.get('/api/sets/:name/:day', async (request, reply) => {
    const callerCode = requireCode(request, reply);
    if (!callerCode) return;

    const targetCode = nameToCode[request.params.name];
    if (!targetCode) {
      return reply.status(404).send({ error: 'Unknown participant' });
    }
    const day = Number(request.params.day);
    if (!Number.isInteger(day) || day < 1) {
      return reply.status(400).send({ error: 'Invalid day' });
    }

    const target = codeToName[targetCode];
    const sets = listSetsForCell(targetCode, day).map(s => ({
      id: s.id,
      reps: s.reps,
      recordedAt: s.recorded_at,
      hasMotion: !!s.has_motion,
    }));
    const totalReps = sets.reduce((acc, s) => acc + s.reps, 0);
    return {
      name: target,
      day,
      target: day,
      isOwn: targetCode === callerCode,
      sets,
      numSets: sets.length,
      totalReps,
    };
  });

  // ── Motion recording detail for one set ──
  app.get('/api/motion/:setId', async (request, reply) => {
    const callerCode = requireCode(request, reply);
    if (!callerCode) return;

    const setId = Number(request.params.setId);
    if (!Number.isInteger(setId) || setId < 1) {
      return reply.status(400).send({ error: 'Invalid set id' });
    }
    const set = getSet(setId);
    if (!set) {
      return reply.status(404).send({ error: 'Set not found' });
    }
    const row = getMotionRecordingFull(setId);
    if (!row) {
      return reply.status(404).send({ error: 'No recording for this set' });
    }
    return {
      setId,
      name: codeToName[set.code],
      day: set.day,
      reps: set.reps,
      recordedAt: row.recorded_at,
      durationMs: row.duration_ms,
      sampleCount: row.sample_count,
      analyzedPushups: row.analyzed_pushups,
      analyzedSets: row.analyzed_sets,
      analysisMeta: row.analysis_meta ? JSON.parse(row.analysis_meta) : null,
      raw: JSON.parse(row.raw_data),
    };
  });

  // ── Register a new set ──
  app.post('/api/sets', async (request, reply) => {
    const code = requireCode(request, reply);
    if (!code) return;

    const body = request.body || {};
    const today = getCurrentDay();
    const day = body.day ?? today;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > today) {
      return reply.status(400).send({ error: 'Day must be between 1 and today' });
    }

    const reps = body.reps;
    if (typeof reps !== 'number' || !Number.isInteger(reps) || reps < 1) {
      return reply.status(400).send({ error: 'Reps must be a positive integer' });
    }

    const motion = body.motion;
    const motionError = validateMotion(motion);
    if (motionError) {
      return reply.status(400).send({ error: motionError });
    }

    const before = getDayTotal(code, day);
    const inserted = insertSet(code, day, reps);

    let hasMotion = false;
    if (motion) {
      hasMotion = storeMotionForSet(inserted.id, motion, request.log);
    }

    // Push fires only when the day's rep total *crosses* the day-N threshold,
    // and only for sets registered against today. Backdated sets never push.
    if (day === today && before < today && before + reps >= today) {
      notifyAllExcept(code, {
        title: 'Push-Up Challenge 💪',
        body: `${codeToName[code]} heeft dag ${today} gehaald!`,
      }).catch(err => console.error('Notify failed:', err));
    }

    return {
      id: inserted.id,
      day,
      reps,
      recordedAt: inserted.recorded_at,
      hasMotion,
      dayTotal: before + reps,
    };
  });

  // ── Update reps on an existing set ──
  app.put('/api/sets/:id', async (request, reply) => {
    const code = requireCode(request, reply);
    if (!code) return;

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return reply.status(400).send({ error: 'Invalid set id' });
    }
    const set = getSet(id);
    if (!set) {
      return reply.status(404).send({ error: 'Set not found' });
    }
    if (set.code !== code) {
      return reply.status(403).send({ error: 'Not your set' });
    }

    const reps = request.body?.reps;
    if (typeof reps !== 'number' || !Number.isInteger(reps) || reps < 1) {
      return reply.status(400).send({ error: 'Reps must be a positive integer' });
    }

    updateSet(id, reps);
    return {
      id,
      day: set.day,
      reps,
      dayTotal: getDayTotal(code, set.day),
    };
  });

  // ── Delete a set (cascades the motion recording) ──
  app.delete('/api/sets/:id', async (request, reply) => {
    const code = requireCode(request, reply);
    if (!code) return;

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return reply.status(400).send({ error: 'Invalid set id' });
    }
    const set = getSet(id);
    if (!set) {
      return reply.status(404).send({ error: 'Set not found' });
    }
    if (set.code !== code) {
      return reply.status(403).send({ error: 'Not your set' });
    }

    deleteSet(id);
    return { success: true, day: set.day, dayTotal: getDayTotal(code, set.day) };
  });

  // ── Web Push ──
  app.get('/api/push/key', async () => {
    return { publicKey: getPublicKey() };
  });

  app.post('/api/push/subscribe', async (request, reply) => {
    const code = requireCode(request, reply);
    if (!code) return;
    const subscription = request.body?.subscription;
    if (!subscription || !subscription.endpoint) {
      return reply.status(400).send({ error: 'Invalid subscription' });
    }
    upsertSubscription(code, subscription);
    return { success: true };
  });
}

export { registerRoutes };
