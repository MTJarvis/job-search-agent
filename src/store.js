import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const db = new DatabaseSync('agent.db');
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  fingerprint TEXT PRIMARY KEY,
  source      TEXT,
  company     TEXT,
  title       TEXT,
  location    TEXT,
  url         TEXT,
  first_seen  TEXT,
  score       INTEGER,
  recommend   TEXT,
  state       TEXT,
  payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_company ON jobs(company);
`);

export function fingerprint(job) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return crypto.createHash('sha1')
    .update(`${norm(job.company)}|${norm(job.title)}|${norm(job.location).slice(0, 20)}`)
    .digest('hex');
}

const selStmt = db.prepare('SELECT 1 AS hit FROM jobs WHERE fingerprint = ?');

export function isNew(job) {
  return selStmt.get(fingerprint(job)) === undefined;
}

const insStmt = db.prepare(`
  INSERT INTO jobs
    (fingerprint, source, company, title, location, url, first_seen, score, recommend, state, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(fingerprint) DO UPDATE SET
    score = excluded.score,
    recommend = excluded.recommend,
    state = excluded.state,
    payload = excluded.payload
`);

export function record(job, fields = {}) {
  const fp = fingerprint(job);
  insStmt.run(
    fp,
    job.source ?? null,
    job.company ?? null,
    job.title ?? null,
    job.location ?? null,
    job.url ?? null,
    new Date().toISOString(),
    fields.score ?? null,
    fields.recommend ?? null,
    fields.state ?? 'seen',
    JSON.stringify(fields.payload ?? {})
  );
  return fp;
}

const stateStmt = db.prepare('UPDATE jobs SET state = ? WHERE fingerprint = ?');
export function setState(fp, state) {
  stateStmt.run(state, fp);
}

export function queued() {
  return db.prepare("SELECT * FROM jobs WHERE state = 'queued' ORDER BY score DESC").all();
}

export function packaged() {
  return db.prepare("SELECT * FROM jobs WHERE state = 'packaged' ORDER BY score DESC").all();
}

export function stats() {
  return db.prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').all();
}

export function seedFromTracker(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) throw new Error(`not found: ${xlsxPath}`);
  const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb['Master Tracker']
out = []
for row in ws.iter_rows(min_row=2, max_col=6, values_only=True):
    company, role, loc, comp, status = row[1], row[2], row[3], row[4], row[5]
    if not company or not role:
        continue
    out.append({'company': str(company), 'title': str(role),
                'location': str(loc or ''), 'status': str(status or '')})
print(json.dumps(out))
`;
  const rows = JSON.parse(execFileSync('python', ['-c', py, xlsxPath]).toString());
  for (const r of rows) {
    record(
      { source: 'tracker', company: r.company, title: r.title, location: r.location, url: '' },
      { state: 'seeded', payload: { trackerStatus: r.status } }
    );
  }
  return rows.length;
}

export default db;

