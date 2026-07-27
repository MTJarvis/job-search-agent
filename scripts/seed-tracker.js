// Seed the dedupe store from your existing tracker so the agent never
// re-surfaces a role you have already worked.
//
//   node scripts/seed-tracker.js ~/Downloads/MJarvis_Master_Job_Tracker_2026.xlsx
//
// Reads the xlsx directly. Company is column B, Role column C, Location column D.

import { execFileSync } from 'node:child_process';
import * as store from '../src/store.js';

const file = process.argv[2];
if (!file) {
  console.log('usage: node scripts/seed-tracker.js <path to tracker.xlsx>');
  process.exit(1);
}

const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb['Master Tracker']
out = []
for i, row in enumerate(ws.iter_rows(min_row=2, max_col=6, values_only=True)):
    company, role, loc, comp, status = row[1], row[2], row[3], row[4], row[5]
    if not company or not role:
        continue
    out.append({'company': str(company), 'title': str(role),
                'location': str(loc or ''), 'status': str(status or '')})
print(json.dumps(out))
`;

const rows = JSON.parse(execFileSync('python', ['-c', py, file]).toString());

let n = 0;
for (const r of rows) {
  store.record(
    { source: 'tracker', company: r.company, title: r.title, location: r.location, url: '' },
    { state: 'seeded', payload: { trackerStatus: r.status } }
  );
  n++;
}

console.log(`seeded ${n} rows from the tracker`);
console.table(store.stats());

