// Best-effort push-up + set detection from raw devicemotion samples.
//
// Input: parallel arrays from the browser
//   { t: number[],            // ms relative to start
//     ax, ay, az: number[],   // accelerationIncludingGravity
//     lax, lay, laz: number[],// linear acceleration (no gravity)
//     rx, ry, rz: number[],   // rotationRate (deg/s)
//     durationMs, sampleCount, startedAt, userAgent, ... }
//
// Output: { pushups, sets, perSet, dominantAxis, peakCount, durationMs,
//           sampleCount, peakTimestamps, algorithmVersion }

const ALGORITHM_VERSION = 1;

// Tunables — picked from informal expectations, expected to be re-tuned later.
const MIN_PEAK_GAP_MS = 500;          // push-ups can't realistically be < 0.5s apart
const SET_GAP_MS = 5000;              // > 5s between peaks ⇒ new set
const MOVING_AVG_WINDOW_MS = 1500;    // detrend window (removes orientation/drift)
const PEAK_THRESHOLD_FACTOR = 0.4;    // peak must exceed 0.4 × stddev of detrended signal

function variance(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
}

function stddev(arr) {
  return Math.sqrt(variance(arr));
}

// Detrend by subtracting a centered moving average.
function detrend(signal, t, windowMs) {
  const n = signal.length;
  const out = new Array(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const target = t[i];
    while (lo < n && t[lo] < target - windowMs / 2) {
      sum -= signal[lo];
      lo++;
    }
    while (hi < n && t[hi] <= target + windowMs / 2) {
      sum += signal[hi];
      hi++;
    }
    const count = hi - lo;
    const avg = count > 0 ? sum / count : 0;
    out[i] = signal[i] - avg;
  }
  return out;
}

// Find peaks: local maxima above threshold, spaced >= minGapMs.
function findPeaks(signal, t, threshold, minGapMs) {
  const peaks = [];
  let lastPeakT = -Infinity;
  for (let i = 1; i < signal.length - 1; i++) {
    const v = signal[i];
    if (v < threshold) continue;
    if (v <= signal[i - 1] || v < signal[i + 1]) continue;
    if (t[i] - lastPeakT < minGapMs) {
      // Replace previous peak if this one is taller (still within gap).
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

// Cluster peak indices into sets where consecutive gaps exceed setGapMs.
function clusterIntoSets(peakIndices, t, setGapMs) {
  if (peakIndices.length === 0) return [];
  const sets = [[peakIndices[0]]];
  for (let i = 1; i < peakIndices.length; i++) {
    const gap = t[peakIndices[i]] - t[peakIndices[i - 1]];
    if (gap > setGapMs) {
      sets.push([peakIndices[i]]);
    } else {
      sets[sets.length - 1].push(peakIndices[i]);
    }
  }
  return sets;
}

function pickDominantAxis(rawData) {
  const axes = [
    { name: 'x', signal: rawData.ax },
    { name: 'y', signal: rawData.ay },
    { name: 'z', signal: rawData.az },
  ];
  let best = axes[0];
  let bestVar = -1;
  for (const a of axes) {
    if (!Array.isArray(a.signal)) continue;
    const v = variance(a.signal);
    if (v > bestVar) {
      bestVar = v;
      best = a;
    }
  }
  return best;
}

function analyzeMotion(rawData) {
  const empty = {
    pushups: 0,
    sets: 0,
    perSet: [],
    dominantAxis: null,
    peakCount: 0,
    durationMs: rawData?.durationMs ?? 0,
    sampleCount: rawData?.sampleCount ?? 0,
    peakTimestamps: [],
    algorithmVersion: ALGORITHM_VERSION,
    note: 'insufficient-data',
  };

  if (!rawData || !Array.isArray(rawData.t) || rawData.t.length < 10) {
    return empty;
  }

  const dominant = pickDominantAxis(rawData);
  if (!dominant.signal || dominant.signal.length !== rawData.t.length) {
    return { ...empty, dominantAxis: dominant.name };
  }

  const detrended = detrend(dominant.signal, rawData.t, MOVING_AVG_WINDOW_MS);
  const sd = stddev(detrended);
  const threshold = Math.max(0.5, sd * PEAK_THRESHOLD_FACTOR); // m/s² floor

  const peaks = findPeaks(detrended, rawData.t, threshold, MIN_PEAK_GAP_MS);
  const sets = clusterIntoSets(peaks, rawData.t, SET_GAP_MS);

  return {
    pushups: peaks.length,
    sets: sets.length,
    perSet: sets.map(s => s.length),
    dominantAxis: dominant.name,
    peakCount: peaks.length,
    durationMs: rawData.durationMs ?? (rawData.t[rawData.t.length - 1] - rawData.t[0]),
    sampleCount: rawData.sampleCount ?? rawData.t.length,
    peakTimestamps: peaks.map(i => rawData.t[i]),
    detrendStddev: sd,
    threshold,
    algorithmVersion: ALGORITHM_VERSION,
  };
}

export { analyzeMotion, ALGORITHM_VERSION };
