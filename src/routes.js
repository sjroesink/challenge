import { getCurrentDay } from './day.js';
import { getAllCheckins, getCheckin, insertCheckin, getUsedGimmicks, upsertSubscription, insertMotionRecording, getMotionRecordingFull } from './db.js';
import { getPublicKey, notifyAllExcept } from './push.js';
import { pickGimmick } from './gimmicks.js';
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

function registerRoutes(app, participants) {
  const codeSet = new Set(participants.map(p => p.code));

  // Progress endpoint — public (no codes exposed)
  const codeToName = Object.fromEntries(participants.map(p => [p.code, p.name]));
  const nameToCode = Object.fromEntries(participants.map(p => [p.name, p.code]));

  app.get('/api/progress', async () => {
    const today = getCurrentDay();
    const checkins = getAllCheckins().map(c => ({
      name: codeToName[c.code],
      day: c.day,
      sets: c.sets,
      gimmickText: c.gimmick_text,
      gimmickVideo: c.gimmick_video,
      hasMotion: !!c.has_motion,
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

  // Motion recording detail — auth required, any logged-in participant can read any recording
  app.get('/api/motion/:name/:day', async (request, reply) => {
    const callerCode = request.headers['x-participant-code'];
    if (!callerCode || !codeSet.has(callerCode)) {
      return reply.status(401).send({ error: 'Invalid participant code' });
    }
    const targetName = request.params.name;
    const targetCode = nameToCode[targetName];
    if (!targetCode) {
      return reply.status(404).send({ error: 'Unknown participant' });
    }
    const day = Number(request.params.day);
    if (!Number.isInteger(day) || day < 1) {
      return reply.status(400).send({ error: 'Invalid day' });
    }
    const row = getMotionRecordingFull(targetCode, day);
    if (!row) {
      return reply.status(404).send({ error: 'No recording for this day' });
    }
    return {
      name: targetName,
      day: row.day,
      recordedAt: row.recorded_at,
      durationMs: row.duration_ms,
      sampleCount: row.sample_count,
      analyzedPushups: row.analyzed_pushups,
      analyzedSets: row.analyzed_sets,
      analysisMeta: row.analysis_meta ? JSON.parse(row.analysis_meta) : null,
      raw: JSON.parse(row.raw_data),
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
    const day = request.body?.day ?? today;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > today) {
      return reply.status(400).send({ error: 'Day must be between 1 and today' });
    }

    const motion = request.body?.motion;
    const motionError = validateMotion(motion);
    if (motionError) {
      return reply.status(400).send({ error: motionError });
    }

    const existing = getCheckin(code, day);
    if (existing) {
      return reply.status(409).send({ error: 'Already checked in for this day' });
    }

    const used = getUsedGimmicks();
    const { text: gimmickText, video: gimmickVideo } = pickGimmick(used.texts, used.videos);

    insertCheckin(code, day, sets, gimmickText, gimmickVideo);

    if (motion) {
      try {
        const analysis = analyzeMotion(motion);
        insertMotionRecording(code, day, {
          durationMs: motion.durationMs ?? (motion.t.at(-1) - motion.t[0]),
          sampleCount: motion.t.length,
          rawData: motion,
          analysis,
        });
      } catch (err) {
        // Recording is best-effort — never let it block the check-in.
        request.log.error({ err }, 'Motion analysis/insert failed');
      }
    }

    // Send push notification to others if checking in for today
    if (day === today) {
      notifyAllExcept(code, {
        title: 'Push-Up Challenge 💪',
        body: `${codeToName[code]} heeft dag ${day} gehaald!`,
      }).catch(err => console.error('Notify failed:', err));
    }

    return { success: true, day, sets, gimmickText, gimmickVideo };
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
