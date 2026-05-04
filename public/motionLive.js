// Client-side motion analysis for live rep counting.
//
// Mirrors `sensorFusion` (and its helpers) from tools/algorithms.mjs so the
// browser can score a partial recording during a set without round-tripping
// to the server. Kept as a plain IIFE that exposes `window.MotionLive` so
// app.js can stay a non-module script.
//
// IMPORTANT: keep this in sync with tools/algorithms.mjs. The benchmark is
// the source of truth for tuning; this file is a port for the browser.

(function (global) {
  'use strict';

  function variance(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
  }
  function stddev(arr) { return Math.sqrt(variance(arr)); }

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

  function bandpass(signal, t, hpWindowMs, lpWindowMs) {
    const trend = movingAvg(signal, t, hpWindowMs);
    const hp = signal.map((v, i) => v - trend[i]);
    return movingAvg(hp, t, lpWindowMs);
  }

  function linMagnitude(raw) {
    const { lax, lay, laz } = raw;
    const n = lax.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = Math.sqrt(lax[i] * lax[i] + lay[i] * lay[i] + laz[i] * laz[i]);
    }
    return out;
  }

  function rotMagnitude(raw) {
    const { rx, ry, rz } = raw;
    const n = rx.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = Math.sqrt(rx[i] * rx[i] + ry[i] * ry[i] + rz[i] * rz[i]);
    }
    return out;
  }

  function findPeaks(signal, t, opts) {
    const { threshold, minGapMs, prominenceFactor = 0 } = opts;
    const peaks = [];
    let lastPeakT = -Infinity;
    for (let i = 1; i < signal.length - 1; i++) {
      const v = signal[i];
      if (v < threshold) continue;
      if (v <= signal[i - 1] || v < signal[i + 1]) continue;

      if (prominenceFactor > 0) {
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

  function magnitudeProminence(raw, opts) {
    opts = opts || {};
    const minGapMs         = opts.minGapMs         != null ? opts.minGapMs         : 500;
    const hpWindowMs       = opts.hpWindowMs       != null ? opts.hpWindowMs       : 1500;
    const lpWindowMs       = opts.lpWindowMs       != null ? opts.lpWindowMs       : 120;
    const thresholdFactor  = opts.thresholdFactor  != null ? opts.thresholdFactor  : 0.5;
    const prominenceFactor = opts.prominenceFactor != null ? opts.prominenceFactor : 0.35;

    if (!raw || !Array.isArray(raw.t) || raw.t.length < 30) return { pushups: 0, peakTimestamps: [] };

    const mag = linMagnitude(raw);
    const filt = bandpass(mag, raw.t, hpWindowMs, lpWindowMs);
    const sd = stddev(filt);
    const threshold = Math.max(0.4, sd * thresholdFactor);

    const peakIdx = findPeaks(filt, raw.t, { threshold, minGapMs, prominenceFactor });
    return { pushups: peakIdx.length, peakTimestamps: peakIdx.map(i => raw.t[i]) };
  }

  function sensorFusion(raw, opts) {
    opts = opts || {};
    const minGapMs        = opts.minGapMs        != null ? opts.minGapMs        : 500;
    const fusionWindowMs  = opts.fusionWindowMs  != null ? opts.fusionWindowMs  : 300;
    const hpWindowMs      = opts.hpWindowMs      != null ? opts.hpWindowMs      : 1500;
    const lpWindowMs      = opts.lpWindowMs      != null ? opts.lpWindowMs      : 120;
    const rotThresholdFactor = opts.rotThresholdFactor != null ? opts.rotThresholdFactor : 0.4;

    if (!raw || !Array.isArray(raw.t) || raw.t.length < 30) return { pushups: 0, peakTimestamps: [] };

    const accel = magnitudeProminence(raw, opts);

    const rotMag = rotMagnitude(raw);
    const rotFilt = bandpass(rotMag, raw.t, hpWindowMs, lpWindowMs);
    const rotSd = stddev(rotFilt);
    const rotThreshold = Math.max(5, rotSd * rotThresholdFactor);
    const rotPeakIdx = findPeaks(rotFilt, raw.t, {
      threshold: rotThreshold,
      minGapMs,
      prominenceFactor: 0.3,
    });
    const rotPeaks = rotPeakIdx.map(i => raw.t[i]);

    const confirmed = accel.peakTimestamps.filter(at =>
      rotPeaks.some(rt => Math.abs(rt - at) <= fusionWindowMs)
    );

    return { pushups: confirmed.length, peakTimestamps: confirmed };
  }

  global.MotionLive = {
    sensorFusion,
    magnitudeProminence,
    // utilities re-exported for ad-hoc experiments in DevTools
    movingAvg, bandpass, linMagnitude, rotMagnitude, findPeaks, stddev,
  };
})(typeof window !== 'undefined' ? window : globalThis);
