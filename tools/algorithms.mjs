// Candidate motion-analysis algorithms for push-up counting.
//
// Each algorithm has the signature (rawData, opts?) → result, where
// rawData is the in-memory recording produced by the browser:
//   { t, ax, ay, az, lax, lay, laz, rx, ry, rz, durationMs, sampleCount, ... }
// and result is at minimum { pushups: number, peakTimestamps: number[], meta: {} }.
//
// Algorithms here are kept self-contained so the benchmark can swap them
// freely. Production still imports from src/motionAnalysis.js — that one
// is re-exported below as `currentBaseline` so the benchmark exercises the
// real shipped code, not a copy.

import { analyzeMotion as currentAnalyze } from '../src/motionAnalysis.js';

// ── shared utilities ──────────────────────────────────────────────────────

function variance(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
}

function stddev(arr) { return Math.sqrt(variance(arr)); }

// Centered moving average over a time-aware window.
function movingAvg(signal, t, windowMs) {
  const n = signal.length;
  const out = new Array(n);
  let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const target = t[i];
    while (lo < n && t[lo] < target - windowMs / 2) { sum -= signal[lo]; lo++; }
    while (hi < n && t[hi] <= target + windowMs / 2) { sum += signal[hi]; hi++; }
    const count = hi - lo;
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

// Bandpass via cascade: HP (subtract long moving avg) → LP (short moving avg).
function bandpass(signal, t, hpWindowMs = 1500, lpWindowMs = 120) {
  const trend = movingAvg(signal, t, hpWindowMs);
  const hp = signal.map((v, i) => v - trend[i]);
  return movingAvg(hp, t, lpWindowMs);
}

// Magnitude of linear acceleration (gravity already removed by the platform).
function linMagnitude(rawData) {
  const { lax, lay, laz } = rawData;
  const n = lax.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sqrt(lax[i] * lax[i] + lay[i] * lay[i] + laz[i] * laz[i]);
  }
  return out;
}

// Magnitude of rotation rate.
function rotMagnitude(rawData) {
  const { rx, ry, rz } = rawData;
  const n = rx.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sqrt(rx[i] * rx[i] + ry[i] * ry[i] + rz[i] * rz[i]);
  }
  return out;
}

// Find local-maxima peaks above `threshold`, spaced at least `minGapMs` apart.
// If `prominenceFactor` is set, also require the peak to stand out by that
// fraction of its own height above the lowest sample within ±minGapMs.
function findPeaks(signal, t, { threshold, minGapMs, prominenceFactor = 0 }) {
  const peaks = [];
  let lastPeakT = -Infinity;
  for (let i = 1; i < signal.length - 1; i++) {
    const v = signal[i];
    if (v < threshold) continue;
    if (v <= signal[i - 1] || v < signal[i + 1]) continue;

    if (prominenceFactor > 0) {
      // Look at the minimum on each side within minGapMs.
      const tHere = t[i];
      let minLeft = v, minRight = v;
      for (let j = i - 1; j >= 0 && tHere - t[j] <= minGapMs; j--) {
        if (signal[j] < minLeft) minLeft = signal[j];
      }
      for (let j = i + 1; j < signal.length && t[j] - tHere <= minGapMs; j++) {
        if (signal[j] < minRight) minRight = signal[j];
      }
      const drop = v - Math.max(minLeft, minRight);
      if (drop < prominenceFactor * Math.abs(v)) continue;
    }

    if (t[i] - lastPeakT < minGapMs) {
      // Within refractory: replace previous peak only if this one is taller.
      if (peaks.length > 0 && v > signal[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
        lastPeakT = t[i];
      }
      continue;
    }
    peaks.push(i);
    lastPeakT = t[i];
  }
  return peaks;
}

const EMPTY = (rawData, label) => ({
  algorithm: label,
  pushups: 0,
  peakTimestamps: [],
  durationMs: rawData?.durationMs ?? 0,
  sampleCount: rawData?.sampleCount ?? 0,
  meta: { note: 'insufficient-data' },
});

// ── algorithm 1: current production baseline ──────────────────────────────

function currentBaseline(rawData) {
  const result = currentAnalyze(rawData);
  return {
    algorithm: 'current',
    pushups: result.pushups,
    peakTimestamps: result.peakTimestamps,
    durationMs: result.durationMs,
    sampleCount: result.sampleCount,
    meta: {
      dominantAxis: result.dominantAxis,
      threshold: result.threshold,
      detrendStddev: result.detrendStddev,
    },
  };
}

// ── algorithm 2: magnitude + bandpass + prominence ────────────────────────
// Orientation-invariant (uses |lin_a|), bandpassed to the rep-frequency band,
// peaks must stand out by `prominenceFactor` to be counted.

function magnitudeProminence(rawData, opts = {}) {
  const minGapMs = opts.minGapMs ?? 500;
  const hpWindowMs = opts.hpWindowMs ?? 1500;
  const lpWindowMs = opts.lpWindowMs ?? 120;
  const thresholdFactor = opts.thresholdFactor ?? 0.5;
  const prominenceFactor = opts.prominenceFactor ?? 0.35;

  if (!rawData?.t || rawData.t.length < 10) return EMPTY(rawData, 'magnitude-prominence');

  const mag = linMagnitude(rawData);
  const filt = bandpass(mag, rawData.t, hpWindowMs, lpWindowMs);
  const sd = stddev(filt);
  const threshold = Math.max(0.4, sd * thresholdFactor);

  const peakIdx = findPeaks(filt, rawData.t, { threshold, minGapMs, prominenceFactor });

  return {
    algorithm: 'magnitude-prominence',
    pushups: peakIdx.length,
    peakTimestamps: peakIdx.map(i => rawData.t[i]),
    durationMs: rawData.durationMs ?? (rawData.t.at(-1) - rawData.t[0]),
    sampleCount: rawData.sampleCount ?? rawData.t.length,
    meta: { stddev: sd, threshold, prominenceFactor, hpWindowMs, lpWindowMs },
  };
}

// ── algorithm 3: sensor-fusion (accel + gyro confirmation) ────────────────
// Detect candidate peaks on both |lin_a| and |rotation rate|. A push-up is
// counted only when the two streams agree within ±fusionWindowMs. This
// suppresses false positives from non-rep movements (typing, walking, etc.).

function sensorFusion(rawData, opts = {}) {
  const minGapMs = opts.minGapMs ?? 500;
  const fusionWindowMs = opts.fusionWindowMs ?? 300;

  if (!rawData?.t || rawData.t.length < 10) return EMPTY(rawData, 'sensor-fusion');

  const accelPeaks = magnitudeProminence(rawData, opts).peakTimestamps;

  const rotMag = rotMagnitude(rawData);
  const rotFilt = bandpass(rotMag, rawData.t, opts.hpWindowMs ?? 1500, opts.lpWindowMs ?? 120);
  const rotSd = stddev(rotFilt);
  const rotThreshold = Math.max(5, rotSd * (opts.rotThresholdFactor ?? 0.4));
  const rotPeakIdx = findPeaks(rotFilt, rawData.t, {
    threshold: rotThreshold,
    minGapMs,
    prominenceFactor: 0.3,
  });
  const rotPeaks = rotPeakIdx.map(i => rawData.t[i]);

  // Confirmed peaks = accel peaks with a rot-peak within ±fusionWindowMs.
  const confirmed = accelPeaks.filter(at =>
    rotPeaks.some(rt => Math.abs(rt - at) <= fusionWindowMs)
  );

  return {
    algorithm: 'sensor-fusion',
    pushups: confirmed.length,
    peakTimestamps: confirmed,
    durationMs: rawData.durationMs ?? (rawData.t.at(-1) - rawData.t[0]),
    sampleCount: rawData.sampleCount ?? rawData.t.length,
    meta: {
      accelCount: accelPeaks.length,
      rotCount: rotPeaks.length,
      fusionWindowMs,
      rotThreshold,
    },
  };
}

// ── algorithm 4: zero-crossing on bandpassed magnitude ────────────────────
// Counts upward zero-crossings of the bandpass-filtered linear-acceleration
// magnitude. Threshold-free, amplitude-independent, naturally picks up one
// crossing per rep cycle. Robust at varying intensities.

function zeroCrossing(rawData, opts = {}) {
  const minGapMs = opts.minGapMs ?? 500;
  const hpWindowMs = opts.hpWindowMs ?? 1500;
  const lpWindowMs = opts.lpWindowMs ?? 150;
  const minAmplitude = opts.minAmplitude ?? 0.5; // m/s² floor — ignore micro-noise

  if (!rawData?.t || rawData.t.length < 10) return EMPTY(rawData, 'zero-crossing');

  const mag = linMagnitude(rawData);
  const filt = bandpass(mag, rawData.t, hpWindowMs, lpWindowMs);

  const crossings = [];
  let lastCrossT = -Infinity;
  for (let i = 1; i < filt.length; i++) {
    const prev = filt[i - 1];
    const cur = filt[i];
    if (prev < 0 && cur >= 0) {
      // Validate the swing has minimum amplitude — find the previous trough
      // and next peak in a minGapMs window.
      const tHere = rawData.t[i];
      let minBefore = 0, maxAfter = 0;
      for (let j = i - 1; j >= 0 && tHere - rawData.t[j] <= minGapMs; j--) {
        if (filt[j] < minBefore) minBefore = filt[j];
      }
      for (let j = i + 1; j < filt.length && rawData.t[j] - tHere <= minGapMs; j++) {
        if (filt[j] > maxAfter) maxAfter = filt[j];
      }
      if (maxAfter - minBefore < minAmplitude) continue;
      if (tHere - lastCrossT < minGapMs) continue;
      crossings.push(rawData.t[i]);
      lastCrossT = tHere;
    }
  }

  return {
    algorithm: 'zero-crossing',
    pushups: crossings.length,
    peakTimestamps: crossings,
    durationMs: rawData.durationMs ?? (rawData.t.at(-1) - rawData.t[0]),
    sampleCount: rawData.sampleCount ?? rawData.t.length,
    meta: { minAmplitude, hpWindowMs, lpWindowMs },
  };
}

// ── pre-processing: auto-trim ─────────────────────────────────────────────
// Crops rawData to the rep zone by detecting the high-|ω| transient bursts
// that happen when the phone goes in/out of the pocket. The rep zone is the
// longest gap between event clusters (or before the first / after the last).
//
// Why detect events instead of "calm zones": calm-zone thresholds based on
// percentile-of-range break when the rep zone itself has moderate rotation —
// the threshold can sit above the rep zone, leaving "no stable segment".
// Events on the other hand are dramatic outliers (|ω| spikes 5-10× above
// the rep median), so detecting them and using the gap is much more robust.

function autoTrim(rawData, opts = {}) {
  const windowMs              = opts.windowMs              ?? 500;
  const minSegmentMs          = opts.minSegmentMs          ?? 3000;
  const insetMs               = opts.insetMs               ?? 200;
  const eventMultiplier       = opts.eventMultiplier       ?? 4;     // event = rolling > median × N
  const eventP98Floor         = opts.eventP98Floor         ?? 0.5;   // also: rolling > p98 × this
  const eventClusterGapMs     = opts.eventClusterGapMs     ?? 800;
  const tailMultiplier        = opts.tailMultiplier        ?? 2;     // tail = rolling > median × N
  const tailStableMs          = opts.tailStableMs          ?? 1500;  // need this much continuous sub-tail

  const t = rawData?.t;
  if (!Array.isArray(t) || t.length < 30) {
    return { trimmed: rawData, meta: { skipped: 'too-short' } };
  }

  // |ω| at each sample and rolling mean.
  const omega = new Array(t.length);
  for (let i = 0; i < t.length; i++) {
    omega[i] = Math.sqrt(rawData.rx[i] ** 2 + rawData.ry[i] ** 2 + rawData.rz[i] ** 2);
  }
  const rolling = movingAvg(omega, t, windowMs);

  const sorted = [...rolling].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.50)];
  const p98    = sorted[Math.floor(sorted.length * 0.98)];

  // An "event" sample exceeds either threshold. The MAX makes it strict
  // enough to ignore mid-rep peaks; the OR with p98×0.5 catches high signals
  // where median is small (e.g. very calm rep zone but huge in/out spike).
  const eventThreshold = Math.max(median * eventMultiplier, p98 * eventP98Floor);

  // Walk the rolling signal and accumulate event clusters. A cluster ends
  // only when the signal stays below threshold for `eventClusterGapMs`.
  const clusters = [];
  let cur = null;
  let belowSinceT = -Infinity;
  for (let i = 0; i < rolling.length; i++) {
    if (rolling[i] > eventThreshold) {
      if (!cur) cur = { startIdx: i, endIdx: i };
      else cur.endIdx = i;
      belowSinceT = -Infinity;
    } else {
      if (cur) {
        if (belowSinceT === -Infinity) belowSinceT = t[i];
        if (t[i] - belowSinceT > eventClusterGapMs) {
          clusters.push(cur);
          cur = null;
        }
      }
    }
  }
  if (cur) clusters.push(cur);

  // No events → keep everything. Likely a clean recording.
  if (clusters.length === 0) {
    return {
      trimmed: rawData,
      meta: { skipped: 'no-events', median, p98, eventThreshold, windowMs },
    };
  }

  // Tail extension: the primary threshold catches the spike of an in/out
  // event, but the signal often has a decaying "settling tail" that doesn't
  // exceed the threshold (e.g. picking the phone out of the pocket creates
  // a big spike, then secondary motion as the user repositions). Walk
  // forward from the leading event end and backward from the trailing
  // event start until rolling has stayed below `tailThreshold` for at
  // least `tailStableMs` continuously — that's the rep zone.
  const tailThreshold = median * tailMultiplier;
  {
    const lead = clusters[0];
    let runStart = -1;
    for (let i = lead.endIdx + 1; i < rolling.length; i++) {
      if (rolling[i] < tailThreshold) {
        if (runStart < 0) runStart = i;
        if (t[i] - t[runStart] >= tailStableMs) {
          lead.endIdx = runStart - 1;
          break;
        }
      } else {
        runStart = -1;
      }
    }
  }
  {
    const trail = clusters[clusters.length - 1];
    let runEnd = -1;
    for (let i = trail.startIdx - 1; i >= 0; i--) {
      if (rolling[i] < tailThreshold) {
        if (runEnd < 0) runEnd = i;
        if (t[runEnd] - t[i] >= tailStableMs) {
          trail.startIdx = runEnd + 1;
          break;
        }
      } else {
        runEnd = -1;
      }
    }
  }

  // Find the longest gap. Candidates: [start, firstEvent], between events, [lastEvent, end].
  const tStart = t[0], tEnd = t.at(-1);
  const candidates = [
    { startMs: tStart, endMs: t[clusters[0].startIdx] },
  ];
  for (let i = 0; i < clusters.length - 1; i++) {
    candidates.push({
      startMs: t[clusters[i].endIdx],
      endMs:   t[clusters[i + 1].startIdx],
    });
  }
  candidates.push({ startMs: t[clusters.at(-1).endIdx], endMs: tEnd });

  let best = candidates[0];
  for (const c of candidates) {
    if (c.endMs - c.startMs > best.endMs - best.startMs) best = c;
  }

  if ((best.endMs - best.startMs) < minSegmentMs) {
    return {
      trimmed: rawData,
      meta: { skipped: 'no-stable-gap', median, p98, eventThreshold, eventCount: clusters.length },
    };
  }

  // Inset inward so we don't include the transition edges.
  const startMs = best.startMs + insetMs;
  const endMs   = best.endMs   - insetMs;

  let lo = 0, hi = t.length - 1;
  while (lo < t.length && t[lo] < startMs) lo++;
  while (hi >= 0 && t[hi] > endMs) hi--;
  if (hi - lo < 10) {
    return {
      trimmed: rawData,
      meta: { skipped: 'after-inset-too-small', eventThreshold, eventCount: clusters.length },
    };
  }

  const slice = (arr) => arr.slice(lo, hi + 1);
  const trimmed = {
    ...rawData,
    t: slice(t),
    ax: slice(rawData.ax),  ay: slice(rawData.ay),  az: slice(rawData.az),
    lax: slice(rawData.lax), lay: slice(rawData.lay), laz: slice(rawData.laz),
    rx: slice(rawData.rx),  ry: slice(rawData.ry),  rz: slice(rawData.rz),
    durationMs: t[hi] - t[lo],
    sampleCount: hi - lo + 1,
  };

  return {
    trimmed,
    meta: {
      median, p98, eventThreshold, tailThreshold, windowMs,
      eventCount: clusters.length,
      startMs: t[lo],
      endMs: t[hi],
      originalDurationMs: rawData.durationMs ?? (t.at(-1) - t[0]),
      trimmedDurationMs: t[hi] - t[lo],
      droppedStartMs: t[lo] - t[0],
      droppedEndMs: t.at(-1) - t[hi],
    },
  };
}

export const ALGORITHMS = [
  { name: 'current',              fn: currentBaseline },
  { name: 'magnitude-prominence', fn: magnitudeProminence },
  { name: 'sensor-fusion',        fn: sensorFusion },
  { name: 'zero-crossing',        fn: zeroCrossing },
];

export {
  currentBaseline,
  magnitudeProminence,
  sensorFusion,
  zeroCrossing,
  autoTrim,
  // utilities exported for ad-hoc scripts and unit tests
  movingAvg,
  bandpass,
  linMagnitude,
  rotMagnitude,
  findPeaks,
  stddev,
};
