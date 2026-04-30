import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'node:fs';

const code = process.argv[2];
const day = process.argv[3] ? Number(process.argv[3]) : null;

const db = new Database('data/challenge.db', { readonly: true });

let row;
if (code && day != null) {
  row = db.prepare(`
    SELECT * FROM motion_recordings WHERE code = ? AND day = ?
  `).get(code, day);
} else {
  row = db.prepare(`
    SELECT * FROM motion_recordings ORDER BY recorded_at DESC LIMIT 1
  `).get();
}

if (!row) {
  console.error('No recording found.');
  process.exit(1);
}

mkdirSync('recordings', { recursive: true });
const out = {
  code: row.code,
  day: row.day,
  recordedAt: row.recorded_at,
  durationMs: row.duration_ms,
  sampleCount: row.sample_count,
  analyzedPushups: row.analyzed_pushups,
  analyzedSets: row.analyzed_sets,
  analysisMeta: row.analysis_meta ? JSON.parse(row.analysis_meta) : null,
  raw: JSON.parse(row.raw_data),
};

const fname = `recordings/${row.code}_day${row.day}_${row.recorded_at.replace(/[:.]/g, '-')}.json`;
writeFileSync(fname, JSON.stringify(out, null, 2));
console.log(`Wrote ${fname} (${out.sampleCount} samples, ${out.durationMs}ms)`);
