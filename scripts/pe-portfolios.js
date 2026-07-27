// Harvest portfolio company names from PE firm websites, then resolve them to
// ATS board tokens. This is the targeted answer to "I want PE-backed roles."
//
//   node scripts/pe-portfolios.js              use the built-in firm list
//   node scripts/pe-portfolios.js --list       show the firms without fetching
//
// Writes config/pe-companies.txt, which you then feed to discover-tokens.js.
//
// PE firms publish their portfolios publicly as marketing. This reads those
// pages, which is the same thing a browser does when you visit them.

import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-6';
const OUT = 'config/pe-companies.txt';

// Firms with heavy software / tech-enabled services portfolios, which is where
// TA-leadership roles at your level actually sit.
const FIRMS = [
  'Thoma Bravo', 'Vista Equity Partners', 'Insight Partners', 'Francisco Partners',
  'Silver Lake', 'TA Associates', 'Summit Partners', 'General Atlantic',
  'Hg Capital', 'Bain Capital Tech Opportunities', 'KKR technology portfolio',
  'Warburg Pincus technology', 'Advent International technology',
  'Clearlake Capital', 'Marlin Equity Partners', 'Genstar Capital',
  'Accel-KKR', 'Level Equity', 'Susquehanna Growth Equity', 'PSG Equity',
  'Great Hill Partners', 'Spectrum Equity', 'Riverside Partners',
  'Sverica', 'Frontier Growth', 'Mainsail Partners', 'Serent Capital',
];

async function portfolioFor(firm) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Find the current portfolio companies for ${firm}. Use their official
portfolio page. Focus on software, SaaS, healthcare technology, legal technology,
fintech, and tech-enabled services companies with roughly 200 to 5000 employees,
which are the ones large enough to hire a Head or Director of Talent Acquisition.

Return ONLY a JSON array of company names, no other text and no markdown fences.
Example: ["Company One","Company Two"]

If you cannot find the portfolio page, return [].`,
    }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  });

  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    const arr = JSON.parse(text.replace(/```json|```/g, '').trim());
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function main() {
  if (process.argv.includes('--list')) {
    FIRMS.forEach((f) => console.log(' -', f));
    return;
  }

  const all = new Set();
  // resume from a previous run if it was interrupted
  if (fs.existsSync(OUT)) {
    fs.readFileSync(OUT, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).forEach((c) => all.add(c));
    console.log(`resuming with ${all.size} already collected\n`);
  }

  for (const [i, firm] of FIRMS.entries()) {
    process.stdout.write(`[${i + 1}/${FIRMS.length}] ${firm.padEnd(38)} `);
    try {
      const companies = await portfolioFor(firm);
      companies.forEach((c) => all.add(c));
      console.log(`${companies.length} companies`);
    } catch (e) {
      console.log(`failed: ${e.message}`);
    }
    fs.writeFileSync(OUT, [...all].sort().join('\n'));
  }

  console.log(`\n${all.size} unique companies written to ${OUT}`);
  console.log(`\nNext:  node scripts/discover-tokens.js ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
