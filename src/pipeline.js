import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';

import { collectATS } from './sources/ats.js';
import { collectBroad } from './sources/aggregator.js';
import { hardGate, scoreJob } from './score.js';
import { buildPlan, auditPlan, buildCoverLetter, loadBaseline } from './tailor.js';
import { renderResume, renderCoverLetter, toPDF, dashCheck, pageCount } from './render.js';
import { findHiringManager, resolveAddress, draftEmail } from './contact.js';
import { createDraft, createDigest } from './outlook.js';
import * as folder from './folder.js';
import * as store from './store.js';
import { checkAgainstHistory, describe as describeMatch } from './match.js';

const profile = JSON.parse(fs.readFileSync('config/profile.json', 'utf8'));
const watchlist = JSON.parse(fs.readFileSync('config/companies.json', 'utf8'));

const PURSUE_THRESHOLD = Number(process.env.PURSUE_THRESHOLD || 70);

// Staged testing flags. Run these in order the first time.
const DRY = process.argv.includes('--dry');            // discover + gate only
const SCORE_ONLY = process.argv.includes('--score-only'); // + LLM scoring, no build
const NO_OUTLOOK = process.argv.includes('--no-outlook'); // build folders, skip Graph
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);

async function processRole(job, score, baseline) {
  const dir = folder.createFolder(job);
  const files = [];
  console.log(`\n> ${job.company} - ${job.title} (${score.score})`);
  console.log(`  ${dir}`);

  // --- resume ---------------------------------------------------------------
  const plan = await buildPlan(job, profile, baseline, score.positioning);
  const audit = await auditPlan(plan, baseline, profile);
  if (!audit.clean) {
    console.log(`  audit: ${audit.flags.map((f) => `${f.severity}/${f.text}`).join(' | ')}`);
  }

  const co = job.company.replace(/[^\w]/g, '');
  const cvDocx = path.join(dir, `MJarvis_CV_2026_${co}.docx`);
  await renderResume(plan, cvDocx, /remote/i.test(job.location) ? null : 'Open to Relocation');

  const dash = dashCheck(cvDocx);
  if (!dash.clean) console.log(`  WARNING: ${dash.count} dash characters survived in the resume`);

  const cvPdf = toPDF(cvDocx);
  const pages = pageCount(cvPdf);
  if (pages && pages > 2) console.log(`  WARNING: resume is ${pages} pages, trim before sending`);
  files.push(cvDocx, cvPdf);

  // --- cover letter ---------------------------------------------------------
  const letter = await buildCoverLetter(job, plan, score.positioning);
  const clDocx = path.join(dir, `MJarvis_CoverLetter_${co}_2026.docx`);
  await renderCoverLetter(letter, clDocx);
  const clDash = dashCheck(clDocx);
  if (!clDash.clean) console.log(`  WARNING: ${clDash.count} dash characters in the cover letter`);
  files.push(clDocx, toPDF(clDocx));

  // --- hiring manager -------------------------------------------------------
  const contact = await findHiringManager(job, score.reportsTo);
  let address = null;
  let email = null;
  let draftId = null;

  if (contact.primary?.name && contact.primary.confidence !== 'low') {
    const domain =
      contact.emailDomain ||
      job.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
    address = await resolveAddress(contact.primary.name, domain);
    email = await draftEmail(job, contact.primary, profile, score.positioning);

    try {
      if (NO_OUTLOOK) throw new Error('skipped by --no-outlook');
      const d = await createDraft({
        to: address.address,
        toName: contact.primary.name,
        subject: email.subject,
        body: email.body,
        attachments: [cvPdf],
      });
      draftId = d.id;
      console.log(`  Outlook draft saved -> ${address.address} (${address.confidence})`);
    } catch (e) {
      console.warn(`  [outlook] ${e.message}`);
    }
  } else {
    console.log('  hiring manager not established, no email drafted');
  }

  // --- folder artifacts -----------------------------------------------------
  folder.writeBrief(dir, { job, score, audit, plan, files });
  folder.writeContact(dir, { job, contact, address });
  if (email) folder.writeEmail(dir, { email, address, contact, draftId });
  folder.writePosting(dir, job);

  store.record(job, {
    score: score.score,
    recommend: score.recommend,
    state: 'packaged',
    payload: { score, audit, contact, address, dir, draftId },
  });

  return { job, score, audit, contact, address, dir, files };
}

async function run() {
  const started = Date.now();
  console.log(`\n=== run ${new Date().toISOString()} ===`);

  const [fromATS, fromBroad] = await Promise.all([
    collectATS(watchlist),
    process.env.BROAD_DISCOVERY === 'false' ? Promise.resolve([]) : collectBroad(),
  ]);

  // ATS entries win on collision: richer descriptions and canonical apply URLs.
  const byKey = new Map();
  for (const j of [...fromBroad, ...fromATS]) {
    byKey.set(`${(j.company || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(j.title || '').toLowerCase()}`, j);
  }
  const raw = [...byKey.values()];
  console.log(`discovered ${raw.length}  (watchlist ${fromATS.length}, broad ${fromBroad.length})`);

  const fresh = raw.filter(store.isNew);
  console.log(`new       ${fresh.length}`);

  const gated = [];
  for (const job of fresh) {
    const g = hardGate(job, profile);
    if (!g.pass) {
      store.record(job, { state: 'rejected', payload: { reason: g.reason } });
      continue;
    }
    job.compRaw = job.compRaw || (g.band ? `$${g.band.low.toLocaleString()} to $${g.band.high.toLocaleString()}` : null);
    gated.push(job);
  }
  console.log(`gated     ${gated.length}`);

  // Cross-check every survivor against the tracker and prior runs. The exact
  // fingerprint misses re-worded duplicates, so this is fuzzy on company + title.
  const survivors = [];
  let dupes = 0;
  for (const job of gated) {
    const hist = checkAgainstHistory(job);
    if (hist.verdict === 'duplicate') {
      dupes++;
      console.log(`  [dupe] ${job.company} | ${job.title} -> ${describeMatch(hist)}`);
      store.record(job, { state: 'duplicate', payload: { match: hist.match, similarity: hist.similarity } });
      continue;
    }
    if (hist.verdict === 'same-company') {
      job.historyNote = describeMatch(hist);
      console.log(`  [note] ${job.company} | ${job.title} -> ${job.historyNote}`);
    }
    survivors.push(job);
  }
  if (dupes) console.log(`dupes     ${dupes} already worked, skipped`);
  console.log(`to score  ${survivors.length}`);

  if (DRY) {
    console.log('\n--dry: stopping after gates. Sample of what cleared:\n');
    survivors.slice(0, 15).forEach((j) =>
      console.log(`  ${j.company} | ${j.title} | ${j.location} | ${j.compRaw || 'comp not posted'}`)
    );
    console.log(`\n${survivors.length} would go to scoring.`);
    return;
  }

  const scored = [];
  for (const job of survivors) {
    try {
      const s = await scoreJob(job, profile);
      if (s.score >= PURSUE_THRESHOLD && s.recommend !== 'skip') {
        scored.push({ job, score: s });
      } else {
        store.record(job, { score: s.score, recommend: s.recommend, state: 'scored', payload: { score: s } });
      }
    } catch (e) {
      console.warn(`  [score fail] ${job.company}: ${e.message}`);
    }
  }
  console.log(`pursue    ${scored.length}`);

  if (SCORE_ONLY) {
    console.log('\n--score-only: stopping before build.\n');
    scored.forEach(({ job, score }) =>
      console.log(`  ${score.score}  ${job.company} | ${job.title}\n      ${score.whyOrWhyNot}`)
    );
    return;
  }

  if (!scored.length) {
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return;
  }

  const baseline = loadBaseline();
  const items = [];
  const batch = LIMIT ? scored.slice(0, LIMIT) : scored;
  for (const { job, score } of batch) {
    try {
      items.push(await processRole(job, score, baseline));
    } catch (e) {
      console.warn(`  [package fail] ${job.company}: ${e.message}`);
    }
  }

  if (items.length) {
    const idx = folder.writeIndex(items);
    console.log(`\nindex: ${idx}`);
    try {
      await createDigest(items.map((i) => ({ ...i, approveUrl: i.dir })));
    } catch (e) {
      console.warn(`[digest] ${e.message}`);
    }
  }

  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.table(store.stats());
}

const mode = process.argv[2];
if (mode === '--once' || DRY || SCORE_ONLY) {
  run().catch((e) => { console.error(e); process.exit(1); });
} else if (mode === '--schedule') {
  console.log('scheduled: 06:00 daily America/Chicago');
  cron.schedule('0 6 * * *', () => run().catch(console.error), { timezone: 'America/Chicago' });
} else {
  console.log('usage: node src/pipeline.js --once | --schedule');
}
