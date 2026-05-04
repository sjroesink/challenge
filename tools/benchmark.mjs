// Replay every motion recording through every candidate algorithm and report
// detected vs registered reps. The DB is the primary source; any *.json file
// in `recordings/` whose (code, day) is not already in the DB is also picked
// up, so exports from prod can be replayed locally.
//
// Usage:
//   node tools/benchmark.mjs                  # all recordings, all algorithms
//   node tools/benchmark.mjs --csv > out.csv  # machine-readable output
//   node tools/benchmark.mjs --algo current   # just one algorithm
//   node tools/benchmark.mjs --code sander    # filter to one participant
//   node tools/benchmark.mjs --db PATH        # use a different SQLite DB (default: data/challenge.db)
//   node tools/benchmark.mjs --min-duration 10000   # skip <10s recordings
//
// The DB loader handles both the live v1 schema (`sets` + `motion_recordings`)
// and the legacy v0 schema (`checkins` + day-keyed `motion_recordings`) so you
// can point at a pre-migration backup without modifying it. In v0, registered
// reps default to `day` (matches the v0→v1 migration's assumption).

import Database from 'better-sqlite3';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALGORITHMS, autoTrim } from './algorithms.mjs';

const args = parseArgs(process.argv.slice(2));

const recordings = loadRecordings({
  dbPath: args.db ?? 'data/challenge.db',
  recordingsDir: args.recordingsDir ?? 'recordings',
  code: args.code,
});

if (recordings.length === 0) {
  console.error('No recordings found in data/challenge.db or recordings/.');
  process.exit(1);
}

const algorithms = args.algo
  ? ALGORITHMS.filter(a => a.name === args.algo)
  : ALGORITHMS;

if (algorithms.length === 0) {
  console.error(`No algorithm matches "${args.algo}". Available: ${ALGORITHMS.map(a => a.name).join(', ')}`);
  process.exit(1);
}

const filtered = recordings.filter(r => {
  if (args.minDuration && r.durationMs < args.minDuration) return false;
  if (args.minSamples && r.sampleCount < args.minSamples) return false;
  return true;
});

if (filtered.length === 0) {
  console.error(`All ${recordings.length} recordings filtered out.`);
  process.exit(1);
}

const rows = filtered.map(rec => {
  let raw = rec.raw;
  let trimMeta = null;
  if (args.autoTrim) {
    const r = autoTrim(rec.raw);
    raw = r.trimmed;
    trimMeta = r.meta;
  }
  const row = {
    source: rec.source,
    code: rec.code,
    day: rec.day,
    reps: rec.reps,
    durationMs: raw.durationMs ?? rec.durationMs,
    sampleCount: raw.sampleCount ?? rec.sampleCount,
    hz: Math.round(1000 * (raw.sampleCount ?? rec.sampleCount) / Math.max(1, raw.durationMs ?? rec.durationMs)),
    trimmed: trimMeta && !trimMeta.skipped
      ? `-${Math.round(trimMeta.droppedStartMs / 100) / 10}s/-${Math.round(trimMeta.droppedEndMs / 100) / 10}s`
      : (trimMeta?.skipped ?? ''),
  };
  for (const algo of algorithms) {
    try {
      const r = algo.fn(raw);
      row[algo.name] = r.pushups;
      row[algo.name + '_err'] = r.pushups - rec.reps;
    } catch (err) {
      row[algo.name] = 'ERR';
      row[algo.name + '_err'] = NaN;
    }
  }
  return row;
});

if (args.csv) {
  printCsv(rows, algorithms, args);
} else {
  printTable(rows, algorithms, args);
  console.log();
  printSummary(rows, algorithms);
}

// ── helpers ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    csv: false, algo: null, code: null,
    db: null, recordingsDir: null,
    minDuration: 0, minSamples: 0,
    autoTrim: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') out.csv = true;
    else if (a === '--auto-trim')      out.autoTrim = true;
    else if (a === '--algo')           out.algo = argv[++i];
    else if (a === '--code')           out.code = argv[++i];
    else if (a === '--db')             out.db = argv[++i];
    else if (a === '--recordings-dir') out.recordingsDir = argv[++i];
    else if (a === '--min-duration')   out.minDuration = Number(argv[++i]);
    else if (a === '--min-samples')    out.minSamples = Number(argv[++i]);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node tools/benchmark.mjs [--csv] [--auto-trim] [--algo NAME] [--code CODE] [--db PATH] [--recordings-dir PATH] [--min-duration MS] [--min-samples N]');
      process.exit(0);
    }
  }
  return out;
}

function loadRecordings({ dbPath, recordingsDir, code }) {
  const out = [];
  const seen = new Set();

  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const hasSets = !!db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='sets'`
      ).get();

      const rows = hasSets
        ? db.prepare(`
            SELECT m.set_id, s.code, s.day, s.reps, m.recorded_at,
                   m.duration_ms, m.sample_count, m.raw_data,
                   m.analyzed_pushups, m.analysis_meta
            FROM motion_recordings m
            JOIN sets s ON s.id = m.set_id
            ORDER BY m.recorded_at ASC
          `).all()
        // v0 (legacy): motion_recordings keyed by (code, day); reps == day
        // (matches the v0→v1 migration's assumption that each day was one set).
        : db.prepare(`
            SELECT NULL AS set_id, code, day, day AS reps, recorded_at,
                   duration_ms, sample_count, raw_data,
                   analyzed_pushups, analysis_meta
            FROM motion_recordings
            ORDER BY recorded_at ASC
          `).all();

      for (const r of rows) {
        if (code && r.code !== code) continue;
        const key = `${r.code}:${r.day}:${r.recorded_at}`;
        seen.add(key);
        out.push({
          source: hasSets ? 'db' : 'db-v0',
          setId: r.set_id,
          code: r.code,
          day: r.day,
          reps: r.reps,
          recordedAt: r.recorded_at,
          durationMs: r.duration_ms,
          sampleCount: r.sample_count,
          analyzedPushups: r.analyzed_pushups,
          raw: JSON.parse(r.raw_data),
        });
      }
    } finally {
      db.close();
    }
  }

  if (existsSync(recordingsDir)) {
    for (const file of readdirSync(recordingsDir)) {
      if (!file.endsWith('.json')) continue;
      const data = JSON.parse(readFileSync(join(recordingsDir, file), 'utf8'));
      if (code && data.code !== code) continue;
      const recCode = data.code ?? 'unknown';
      const day = data.day ?? 0;
      const recordedAt = data.recordedAt ?? data.raw?.startedAt ?? '';
      const key = `${recCode}:${day}:${recordedAt}`;
      if (seen.has(key)) continue;
      const reps = data.reps ?? data.day ?? 0; // legacy exports use day-as-reps
      out.push({
        source: `file:${file}`,
        setId: null,
        code: recCode,
        day,
        reps,
        recordedAt,
        durationMs: data.durationMs,
        sampleCount: data.sampleCount,
        analyzedPushups: data.analyzedPushups,
        raw: data.raw,
      });
    }
  }

  return out;
}

function printTable(rows, algorithms, args) {
  const trimCol = args?.autoTrim;
  const headers = [
    'src', 'code', 'day', 'reps', 'dur(s)', 'samples', 'hz',
    ...(trimCol ? ['trim'] : []),
    ...algorithms.flatMap(a => [a.name, '±']),
  ];
  const formatted = rows.map(r => [
    short(r.source),
    r.code,
    String(r.day),
    String(r.reps),
    (r.durationMs / 1000).toFixed(1),
    String(r.sampleCount),
    String(r.hz),
    ...(trimCol ? [String(r.trimmed ?? '')] : []),
    ...algorithms.flatMap(a => [
      String(r[a.name]),
      formatErr(r[a.name + '_err']),
    ]),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...formatted.map(row => row[i].length))
  );
  const sep = widths.map(w => '─'.repeat(w)).join('─┼─');

  const fmtRow = row => row.map((c, i) => c.padEnd(widths[i])).join(' │ ');
  console.log(fmtRow(headers));
  console.log(sep);
  for (const row of formatted) console.log(fmtRow(row));
}

function printSummary(rows, algorithms) {
  console.log(`Summary over ${rows.length} recording${rows.length === 1 ? '' : 's'}:`);
  console.log();
  const headers = ['algorithm', 'mean ±', 'median ±', '|err|', '|err|≤1', '|err|≤2', 'within 10%'];
  const formatted = algorithms.map(a => {
    const errs = rows.map(r => r[a.name + '_err']).filter(e => Number.isFinite(e));
    if (errs.length === 0) return [a.name, '–', '–', '–', '–', '–', '–'];
    const abs = errs.map(Math.abs);
    const within1 = abs.filter(e => e <= 1).length;
    const within2 = abs.filter(e => e <= 2).length;
    const within10 = errs.filter((e, i) => {
      const reps = rows[i].reps;
      return reps > 0 && Math.abs(e) <= reps * 0.10;
    }).length;
    return [
      a.name,
      mean(errs).toFixed(1),
      median(errs).toFixed(1),
      mean(abs).toFixed(1),
      `${within1}/${errs.length}`,
      `${within2}/${errs.length}`,
      `${within10}/${errs.length}`,
    ];
  });
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...formatted.map(row => row[i].length))
  );
  const fmtRow = row => row.map((c, i) => c.padEnd(widths[i])).join(' │ ');
  const sep = widths.map(w => '─'.repeat(w)).join('─┼─');
  console.log(fmtRow(headers));
  console.log(sep);
  for (const row of formatted) console.log(fmtRow(row));
}

function printCsv(rows, algorithms, args) {
  const trimCol = args?.autoTrim;
  const headers = [
    'source', 'code', 'day', 'reps', 'duration_ms', 'sample_count', 'hz',
    ...(trimCol ? ['trim'] : []),
    ...algorithms.flatMap(a => [a.name, a.name + '_err']),
  ];
  console.log(headers.join(','));
  for (const r of rows) {
    const cells = [
      r.source, r.code, r.day, r.reps, r.durationMs, r.sampleCount, r.hz,
      ...(trimCol ? [r.trimmed ?? ''] : []),
      ...algorithms.flatMap(a => [r[a.name], r[a.name + '_err']]),
    ];
    console.log(cells.map(c => typeof c === 'string' && c.includes(',') ? `"${c}"` : c).join(','));
  }
}

function short(s) {
  if (!s) return '';
  return s.length > 16 ? s.slice(0, 14) + '…' : s;
}

function formatErr(e) {
  if (!Number.isFinite(e)) return '?';
  if (e === 0) return '·';
  return (e > 0 ? '+' : '') + e;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
