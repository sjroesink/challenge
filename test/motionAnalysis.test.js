import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMotion } from '../src/motionAnalysis.js';

// Build a synthetic recording with known reps and rest gaps.
function makeRecording({ sampleHz = 60, reps, restGapsMs = [], cadenceMs = 1500, axis = 'z' }) {
  const dt = 1000 / sampleHz;
  const t = [];
  const z = [];

  let totalRestPos = 0;
  // restGapsMs[i] = rest in ms inserted BEFORE reps in set i (skip for set 0)
  // We build chunked ranges of reps; between chunks insert rest.
  // For simplicity: assume reps is total reps spread over (restGapsMs.length + 1) sets, evenly.
  const setCount = restGapsMs.length + 1;
  const repsPerSet = Math.floor(reps / setCount);
  const remainder = reps - repsPerSet * setCount;

  let now = 0;
  for (let s = 0; s < setCount; s++) {
    if (s > 0) {
      const restMs = restGapsMs[s - 1];
      // Add quiet samples during rest (low noise around 9.8 baseline).
      const restSamples = Math.floor(restMs / dt);
      for (let i = 0; i < restSamples; i++) {
        t.push(Math.round(now));
        z.push(9.8 + (Math.random() - 0.5) * 0.05);
        now += dt;
      }
      totalRestPos += restMs;
    }
    const repsThisSet = repsPerSet + (s < remainder ? 1 : 0);
    for (let r = 0; r < repsThisSet; r++) {
      // Each rep is one cycle of a cosine over `cadenceMs`. Peak at quarter cycle.
      const cycleSamples = Math.floor(cadenceMs / dt);
      for (let i = 0; i < cycleSamples; i++) {
        const phase = (i / cycleSamples) * 2 * Math.PI;
        // 9.8 baseline + sinusoidal motion of amplitude 4 m/s² + small noise.
        const v = 9.8 + 4 * Math.sin(phase) + (Math.random() - 0.5) * 0.1;
        t.push(Math.round(now));
        z.push(v);
        now += dt;
      }
    }
  }

  const n = t.length;
  const zeros = () => new Array(n).fill(0);
  const baseline = () => new Array(n).fill(0).map(() => (Math.random() - 0.5) * 0.05);

  const rec = {
    t,
    ax: baseline(), ay: baseline(), az: baseline(),
    lax: zeros(), lay: zeros(), laz: zeros(),
    rx: zeros(), ry: zeros(), rz: zeros(),
    durationMs: t[t.length - 1] ?? 0,
    sampleCount: n,
  };
  // Place the active signal on the requested axis.
  rec[`a${axis}`] = z;
  return rec;
}

describe('analyzeMotion', () => {
  it('returns zero pushups for empty data', () => {
    const out = analyzeMotion({ t: [], ax: [], ay: [], az: [], lax: [], lay: [], laz: [], rx: [], ry: [], rz: [] });
    assert.equal(out.pushups, 0);
    assert.equal(out.sets, 0);
    assert.equal(out.algorithmVersion, 1);
  });

  it('returns zero pushups for null input', () => {
    const out = analyzeMotion(null);
    assert.equal(out.pushups, 0);
    assert.equal(out.sets, 0);
  });

  it('detects roughly the right number of pushups in a single set', () => {
    const rec = makeRecording({ reps: 12, cadenceMs: 1500, axis: 'z' });
    const out = analyzeMotion(rec);
    // Allow 1-rep slack on either side — peak detection isn't pixel-perfect.
    assert.ok(out.pushups >= 11 && out.pushups <= 13, `expected ~12 pushups, got ${out.pushups}`);
    assert.equal(out.sets, 1);
    assert.equal(out.dominantAxis, 'z');
  });

  it('clusters peaks separated by long rest into multiple sets', () => {
    const rec = makeRecording({ reps: 18, restGapsMs: [8000, 8000], cadenceMs: 1500, axis: 'z' });
    const out = analyzeMotion(rec);
    // Peak counts on noisy synthetic data fluctuate by ±15% — the contract
    // we care about is that 3 distinct sets are detected with roughly the
    // right total count.
    assert.ok(out.pushups >= 14 && out.pushups <= 22, `expected ~18 pushups, got ${out.pushups}`);
    assert.equal(out.sets, 3, `expected 3 sets, got ${out.sets} (perSet=${out.perSet})`);
  });

  it('picks the correct dominant axis', () => {
    const rec = makeRecording({ reps: 8, cadenceMs: 1500, axis: 'y' });
    const out = analyzeMotion(rec);
    assert.equal(out.dominantAxis, 'y');
  });

  it('returns insufficient-data note for very short recordings', () => {
    const out = analyzeMotion({
      t: [0, 16, 32], ax: [0, 0, 0], ay: [0, 0, 0], az: [0, 0, 0],
      lax: [0, 0, 0], lay: [0, 0, 0], laz: [0, 0, 0],
      rx: [0, 0, 0], ry: [0, 0, 0], rz: [0, 0, 0],
    });
    assert.equal(out.pushups, 0);
    assert.equal(out.note, 'insufficient-data');
  });
});
