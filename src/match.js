import db from './store.js';

const LEGAL_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|gmbh|sa|nv|ab|pte|pty)\b/g;

export function normCompany(s) {
  return (s || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, '').trim();
}

const STOPWORDS = new Set(['of','the','and','a','an','for','to','in','at','on','with','global','senior','sr','jr','us','usa','remote','hybrid']);

export function titleTokens(s) {
  return new Set((s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOPWORDS.has(w)));
}

export function titleSimilarity(a, b) {
  const A = titleTokens(a); const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const smaller = Math.min(A.size, B.size);
  if (shared === smaller && smaller >= 2) return 1;
  return shared / (A.size + B.size - shared);
}

const SIM_BLOCK = 0.55;

export function checkAgainstHistory(job) {
  const target = normCompany(job.company);
  if (!target) return { verdict: 'clear' };
  const rows = db.prepare('SELECT company, title, location, state, first_seen FROM jobs').all();
  const sameCompany = rows.filter((r) => {
    const c = normCompany(r.company);
    if (!c) return false;
    return c === target || c.includes(target) || target.includes(c);
  });
  if (!sameCompany.length) return { verdict: 'clear' };
  let best = null;
  for (const r of sameCompany) {
    const sim = titleSimilarity(job.title, r.title);
    if (!best || sim > best.similarity) best = { match: r, similarity: sim };
  }
  if (best.similarity >= SIM_BLOCK) return { verdict: 'duplicate', match: best.match, similarity: best.similarity };
  return { verdict: 'same-company', matches: sameCompany, best };
}

export function describe(result) {
  if (result.verdict === 'duplicate') {
    const m = result.match;
    return `already worked: "${m.title}" (${m.state}${m.first_seen ? ', ' + m.first_seen.slice(0, 10) : ''}), similarity ${(result.similarity * 100).toFixed(0)}%`;
  }
  if (result.verdict === 'same-company') {
    const titles = result.matches.slice(0, 3).map((m) => `"${m.title}" (${m.state})`).join(', ');
    return `company already in pipeline: ${titles}${result.matches.length > 3 ? ` +${result.matches.length - 3} more` : ''}`;
  }
  return 'no history';
}
