// Turn a list of company names into ATS board tokens, automatically.
//
//   node scripts/discover-tokens.js companies.txt        (one name per line)
//   node scripts/discover-tokens.js --from-db            (companies the aggregator surfaced)
//
// Generates candidate tokens from each name, tests all three ATS platforms,
// and appends every hit to config/companies.json. This is how the watchlist
// grows past a hand-curated list without you looking anything up.

import fs from 'node:fs';
import { greenhouse, lever, ashby } from '../src/sources/ats.js';

const CONFIG = 'config/companies.json';

function tokenCandidates(name) {
  const base = name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|technologies|technology|labs|software|systems)\b/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim();

  const words = base.split(/\s+/).filter(Boolean);
  const set = new Set([
    words.join(''),        // gendigital
    words.join('-'),       // gen-digital
    words[0],              // gen
    base.replace(/\s+/g, ''),
  ]);
  return [...set].filter((t) => t && t.length >= 2);
}

const ADAPTERS = [['greenhouse', greenhouse], ['lever', lever], ['ashby', ashby]];

async function probe(name) {
  for (const token of tokenCandidates(name)) {
    for (const [ats, fn] of ADAPTERS) {
      try {
        const jobs = await fn(token);
        if (jobs.length) return { name, ats, token, count: jobs.length };
      } catch { /* 404 is the normal case, keep going */ }
    }
  }
  return null;
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
  catch { return { greenhouse: [], lever: [], ashby: [], workday: [] }; }
}

function saveConfig(cfg) {
  for (const k of ['greenhouse', 'lever', 'ashby']) {
    cfg[k] = [...new Set(cfg[k] || [])].sort();
  }
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
}

async function main() {
  const arg = process.argv[2];
  let names = [];

  if (arg === '--from-db') {
    const store = await import('../src/store.js');
    const rows = store.default
      .prepare("SELECT DISTINCT company FROM jobs WHERE source IN ('adzuna','serpapi')")
      .all();
    names = rows.map((r) => r.company).filter(Boolean);
    console.log(`${names.length} companies seen by the aggregator`);
  } else if (arg) {
    names = fs.readFileSync(arg, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  } else {
    console.log('usage: node scripts/discover-tokens.js <file.txt> | --from-db');
    process.exit(1);
  }

  const cfg = loadConfig();
  const known = new Set([...(cfg.greenhouse || []), ...(cfg.lever || []), ...(cfg.ashby || [])]);

  let found = 0;
  for (const [i, name] of names.entries()) {
    process.stdout.write(`[${i + 1}/${names.length}] ${name.padEnd(34).slice(0, 34)} `);
    const hit = await probe(name);
    if (!hit) { console.log('no board found'); continue; }
    if (known.has(hit.token)) { console.log(`already tracked (${hit.ats})`); continue; }

    cfg[hit.ats] = cfg[hit.ats] || [];
    cfg[hit.ats].push(hit.token);
    known.add(hit.token);
    found++;
    console.log(`${hit.ats}/${hit.token} (${hit.count} postings)  ADDED`);

    if (found % 10 === 0) saveConfig(cfg);
  }

  saveConfig(cfg);
  console.log(`\n${found} new boards added. Watchlist now: ` +
    `${(cfg.greenhouse||[]).length} greenhouse, ${(cfg.lever||[]).length} lever, ${(cfg.ashby||[]).length} ashby`);
}

main().catch((e) => { console.error(e); process.exit(1); });
