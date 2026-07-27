// Test an ATS board token before you add it to config/companies.json.
//
//   node scripts/check-token.js greenhouse ramp
//   node scripts/check-token.js lever fluidstack
//   node scripts/check-token.js ashby gen-digital
//   node scripts/check-token.js all ramp        # try every ATS
//
// Prints how many reqs came back and a sample, so a typo is obvious.

import { greenhouse, lever, ashby } from '../src/sources/ats.js';

const ADAPTERS = { greenhouse, lever, ashby };

const [, , which, token] = process.argv;
if (!which || !token) {
  console.log('usage: node scripts/check-token.js <greenhouse|lever|ashby|all> <token>');
  process.exit(1);
}

const targets = which === 'all' ? Object.keys(ADAPTERS) : [which];

for (const name of targets) {
  const fn = ADAPTERS[name];
  if (!fn) { console.log(`unknown ats: ${name}`); continue; }
  try {
    const jobs = await fn(token);
    console.log(`\n${name}/${token}: ${jobs.length} postings`);
    jobs.slice(0, 5).forEach((j) =>
      console.log(`  - ${j.title}  [${j.location}]${j.compRaw ? '  ' + j.compRaw : ''}`)
    );
    if (jobs.length) {
      console.log(`\n  add to config/companies.json under "${name}": "${token}"`);
    }
  } catch (e) {
    console.log(`${name}/${token}: ${e.message}`);
  }
}
