// Public, unauthenticated job board APIs. These are the origin of most postings
// that later appear on LinkedIn and Indeed, so they are fresher and cleaner.

const UA = { 'User-Agent': 'jarvis-job-agent/1.0 (personal job search)' };

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

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

// ---------- Greenhouse ----------
// token from job-boards.greenhouse.io/<token>
export async function greenhouse(token) {
  const d = await getJSON(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`
  );
  return (d.jobs || []).map((j) =>
    norm({
      source: 'greenhouse',
      externalId: j.id,
      company: token,
      title: j.title,
      location: j.location?.name,
      url: j.absolute_url,
      description: Buffer.from(j.content || '', 'base64').toString('utf8').slice(0, 20000),
      postedAt: j.updated_at,
    })
  );
}

// ---------- Lever ----------
export async function lever(token) {
  const d = await getJSON(`https://api.lever.co/v0/postings/${token}?mode=json`);
  return (d || []).map((j) =>
    norm({
      source: 'lever',
      externalId: j.id,
      company: token,
      title: j.text,
      location: j.categories?.location,
      url: j.hostedUrl,
      description: j.descriptionPlain || j.description,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    })
  );
}

// ---------- Ashby ----------
export async function ashby(token) {
  const d = await getJSON(
    `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`
  );
  return (d.jobs || []).map((j) =>
    norm({
      source: 'ashby',
      externalId: j.id,
      company: d.name || token,
      title: j.title,
      location: j.location,
      url: j.jobUrl,
      description: j.descriptionPlain || j.descriptionHtml,
      postedAt: j.publishedAt,
      compRaw: j.compensation?.summary || null,
    })
  );
}

// ---------- Workday ----------
// host like "sec.wd3.myworkdayjobs.com", site like "Samsung_Careers"
export async function workday(host, tenant, site) {
  const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 20, offset: 0, searchText: '', appliedFacets: {} }),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const d = await res.json();
  return (d.jobPostings || []).map((j) =>
    norm({
      source: 'workday',
      externalId: j.bulletFields?.[0] || j.externalPath,
      company: tenant,
      title: j.title,
      location: j.locationsText,
      url: `https://${host}${j.externalPath}`,
      description: j.title,
      postedAt: j.postedOn,
    })
  );
}

// ---------- runner ----------
export async function collectATS(watchlist) {
  const out = [];
  const tasks = [];

  for (const t of watchlist.greenhouse || []) tasks.push(['greenhouse', t, greenhouse(t)]);
  for (const t of watchlist.lever || []) tasks.push(['lever', t, lever(t)]);
  for (const t of watchlist.ashby || []) tasks.push(['ashby', t, ashby(t)]);
  for (const w of watchlist.workday || [])
    tasks.push(['workday', w.tenant, workday(w.host, w.tenant, w.site)]);

  const settled = await Promise.allSettled(tasks.map((t) => t[2]));
  settled.forEach((r, i) => {
    const [src, token] = tasks[i];
    if (r.status === 'fulfilled') out.push(...r.value);
    else console.warn(`  [skip] ${src}/${token}: ${r.reason.message}`);
  });

  return out;
}

