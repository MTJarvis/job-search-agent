// Broad discovery across ALL employers, not just the watchlist.
//
// Adzuna indexes most US job boards and has a genuinely free API tier
// (register at developer.adzuna.com, ~250 calls/day, no card).
// SerpApi's Google Jobs endpoint is the paid alternative with better coverage.
//
// Strategy: search by ROLE not by company. Every talent-leadership title you
// would consider, run as its own query. Companies you have never heard of
// surface here, which is the point.

const UA = { 'User-Agent': 'jarvis-job-agent/1.0 (personal job search)' };

export const DEFAULT_QUERIES = [
  'head of talent acquisition',
  'director of talent acquisition',
  'vp talent acquisition',
  'head of recruiting',
  'director of recruiting',
  'vp of recruiting',
  'global head of talent',
  'head of talent',
  'director talent acquisition',
  'senior director talent acquisition',
  'head of people',
  'director of recruitment',
  'talent acquisition leader',
  'head of global recruiting',
];

function norm(o) {
  return {
    source: o.source,
    externalId: String(o.externalId),
    company: o.company,
    title: o.title,
    location: o.location || 'Not specified',
    url: o.url,
    description: (o.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    postedAt: o.postedAt || null,
    compRaw: o.compRaw || null,
  };
}

// ---------------------------------------------------------------------------
// Adzuna. Free tier. developer.adzuna.com
// ---------------------------------------------------------------------------
export async function adzuna(query, { page = 1, maxDaysOld = 3 } = {}) {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];

  const url =
    `https://api.adzuna.com/v1/api/jobs/us/search/${page}` +
    `?app_id=${id}&app_key=${key}` +
    `&results_per_page=50` +
    `&what_phrase=${encodeURIComponent(query)}` +
    `&max_days_old=${maxDaysOld}` +
    `&content-type=application/json`;

  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`adzuna ${res.status}`);
  const d = await res.json();

  return (d.results || []).map((j) =>
    norm({
      source: 'adzuna',
      externalId: j.id,
      company: j.company?.display_name || 'Unknown',
      title: j.title?.replace(/<[^>]+>/g, ''),
      location: j.location?.display_name,
      url: j.redirect_url,
      description: j.description,
      postedAt: j.created,
      compRaw:
        j.salary_min && j.salary_max
          ? `$${Math.round(j.salary_min).toLocaleString()} to $${Math.round(j.salary_max).toLocaleString()}`
          : null,
    })
  );
}

// ---------------------------------------------------------------------------
// SerpApi Google Jobs. Paid, better coverage and fresher.
// ---------------------------------------------------------------------------
export async function serpapiJobs(query, { location = 'United States' } = {}) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];

  const url =
    `https://serpapi.com/search.json?engine=google_jobs` +
    `&q=${encodeURIComponent(query)}` +
    `&location=${encodeURIComponent(location)}` +
    `&chips=date_posted:week` +
    `&api_key=${key}`;

  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`serpapi ${res.status}`);
  const d = await res.json();

  return (d.jobs_results || []).map((j) =>
    norm({
      source: 'serpapi',
      externalId: j.job_id,
      company: j.company_name,
      title: j.title,
      location: j.location,
      url: j.share_link || j.apply_options?.[0]?.link,
      description: j.description,
      postedAt: j.detected_extensions?.posted_at,
      compRaw: j.detected_extensions?.salary || null,
    })
  );
}

// ---------------------------------------------------------------------------
export async function collectBroad(queries = DEFAULT_QUERIES) {
  const out = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const q of queries) {
    if (process.env.ADZUNA_APP_ID) {
      try { out.push(...(await adzuna(q))); }
      catch (e) { console.warn(`  [skip] adzuna:${q}: ${e.message}`); }
      await sleep(1500);
    }
    if (process.env.SERPAPI_KEY) {
      try { out.push(...(await serpapiJobs(q))); }
      catch (e) { console.warn(`  [skip] serpapi:${q}: ${e.message}`); }
      await sleep(500);
    }
  }

  if (!process.env.ADZUNA_APP_ID && !process.env.SERPAPI_KEY) {
    console.warn('  [broad] no aggregator keys set, skipping broad discovery');
    return [];
  }

  const seen = new Set();
  return out.filter((j) => {
    const k = `${(j.company || '').toLowerCase()}|${(j.title || '').toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

