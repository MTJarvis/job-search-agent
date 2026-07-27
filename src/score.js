import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Stage 1: deterministic gates. Free, instant, kills most of the volume.
// Never send a posting to the model that a regex can reject.
// ---------------------------------------------------------------------------

const COMP_RE = /\$\s?(\d{2,3})[,.]?(\d{3})?\s?(?:k|K)?\b(?:\s?(?:-|to|â€“)\s?\$?\s?(\d{2,3})[,.]?(\d{3})?\s?(?:k|K)?)?/g;

export function parseCompBand(text) {
  if (!text) return null;
  const nums = [];
  let m;
  while ((m = COMP_RE.exec(text)) !== null) {
    for (const [a, b] of [[m[1], m[2]], [m[3], m[4]]]) {
      if (!a) continue;
      let v = parseInt(a, 10);
      v = b ? parseInt(a + b, 10) : v * 1000;
      if (v >= 50000 && v <= 900000) nums.push(v);
    }
  }
  if (!nums.length) return null;
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

export function hardGate(job, profile) {
  const g = profile.hardGates;
  const title = (job.title || '').toLowerCase();
  const loc = (job.location || '').toLowerCase();
  const text = `${job.title} ${job.description} ${job.compRaw || ''}`;

  for (const p of g.excludeTitlePatterns) {
    if (title.includes(p)) return { pass: false, reason: `title pattern: ${p}` };
  }

  const talentWords = ['talent', 'recruit', 'recruiting', 'recruitment', 'people', 'human resources', 'staffing', 'hiring', 'workforce', 'hr '];
  if (!talentWords.some((w) => title.includes(w))) {
    return { pass: false, reason: 'not a talent function role' };
  }

  if (!g.minSeniority.some((s) => title.includes(s))) {
    return { pass: false, reason: 'below target seniority' };
  }

  const band = parseCompBand(text);
  if (band && band.high < g.compFloorBase) {
    return { pass: false, reason: `band tops at $${band.high.toLocaleString()}` };
  }
  if (!band && !g.allowUnpostedComp) {
    return { pass: false, reason: 'no comp posted' };
  }

  const remote = /remote/.test(loc) || /remote/i.test(job.description.slice(0, 1200));
  const locOK =
    (g.acceptableLocations.remoteUS && remote) ||
    g.acceptableLocations.cities.some((c) => loc.includes(c.toLowerCase())) ||
    g.acceptableLocations.states.some((s) => new RegExp(`\\b${s}\\b`, 'i').test(job.location)) ||
    g.acceptableLocations.relocationOpen;
  if (!locOK) return { pass: false, reason: `location: ${job.location}` };

  if (g.requireNoSponsorship && /sponsorship (is )?(not )?available/i.test(job.description)) {
    // informational only, does not block
  }

  return { pass: true, band };
}

// ---------------------------------------------------------------------------
// Stage 2: LLM fit scoring. Only runs on postings that cleared the gates.
// Returns strict JSON so the pipeline can branch on it.
// ---------------------------------------------------------------------------

const SCORE_PROMPT = `You are screening job postings for a senior Talent Acquisition executive.

CANDIDATE PROFILE
{{PROFILE}}

POSTING
Company: {{COMPANY}}
Title: {{TITLE}}
Location: {{LOCATION}}
Compensation (if stated): {{COMP}}

{{DESCRIPTION}}

Assess fit honestly. Do not inflate. A mediocre match scored as strong wastes the
candidate's time, which is the thing this system exists to protect.

Respond with ONLY a JSON object, no preamble and no markdown fences:
{
  "score": <0-100>,
  "recommend": "pursue" | "consider" | "skip",
  "level": "at-level" | "step-down" | "stretch-up",
  "positioning": "<one sentence: which of the candidate's angles should lead>",
  "realGaps": ["<honest gaps, things the JD requires that the candidate does not hold>"],
  "compRead": "<clears floor | below floor | unposted, with the numbers if stated>",
  "locationRead": "<remote | commutable | relocation required, and to where>",
  "whyOrWhyNot": "<two sentences max>"
}

Score above 70 only when the candidate could credibly be a finalist.
Anything requiring a credential or domain listed as not held caps at 55.`;

export async function scoreJob(job, profile) {
  const prompt = SCORE_PROMPT
    .replace('{{PROFILE}}', JSON.stringify({
      coreProofPoints: profile.coreProofPoints,
      softSignals: profile.softSignals,
      notHeld: profile.notHeld,
      compFloorBase: profile.hardGates.compFloorBase,
    }, null, 2))
    .replace('{{COMPANY}}', job.company)
    .replace('{{TITLE}}', job.title)
    .replace('{{LOCATION}}', job.location)
    .replace('{{COMP}}', job.compRaw || 'not posted')
    .replace('{{DESCRIPTION}}', job.description.slice(0, 12000));

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { score: 0, recommend: 'skip', whyOrWhyNot: 'scoring parse failure', realGaps: [] };
  }
}


