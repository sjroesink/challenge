import Database from 'better-sqlite3';
const db = new Database('data/challenge.db', { readonly: true });
const rows = db.prepare(`
  SELECT code, day, recorded_at, duration_ms, sample_count,
         analyzed_pushups, analyzed_sets
  FROM motion_recordings
  ORDER BY recorded_at DESC
`).all();
console.log(JSON.stringify(rows, null, 2));
