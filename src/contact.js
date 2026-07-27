import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Who does this role report to?
// Uses web search rather than scraping LinkedIn. Public leadership pages, press
// releases, SEC filings, and newsroom posts are the reliable sources anyway:
// a CHRO announcement names the person and the scope in one paragraph.
// ---------------------------------------------------------------------------

const RESEARCH_PROMPT = `Identify the most likely hiring manager for this role.

Company: {{COMPANY}}
Role: {{TITLE}}
Posting says it reports to: {{REPORTS_TO}}

Search for the company's current leadership. Prefer the company's own leadership
page, press releases, and SEC filings over aggregator sites, which go stale.

Return ONLY JSON:
{
  "primary": {
    "name": "...", "title": "...", "confidence": "high|medium|low",
    "evidence": "<source and what it said>",
    "background": "<one line: anything that changes how to write to them>"
  },
  "alternates": [{"name":"...","title":"...","why":"..."}],
  "emailPatternNotes": "<the company's dominant pattern and the reported rate>",
  "cautions": "<e.g. role may report to an undiscovered VP given headcount>"
}

If you cannot establish the person with reasonable confidence, say so in
confidence rather than guessing a name.`;

export async function findHiringManager(job, reportsTo) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: RESEARCH_PROMPT
        .replace('{{COMPANY}}', job.company)
        .replace('{{TITLE}}', job.title)
        .replace('{{REPORTS_TO}}', reportsTo || 'not stated'),
    }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  });

  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { primary: { confidence: 'low', evidence: 'research parse failure' }, alternates: [] };
  }
}

// ---------------------------------------------------------------------------
// Candidate addresses, ranked, then verified. Never send to an unverified guess.
// ---------------------------------------------------------------------------

export function candidateAddresses(name, domain) {
  const [first, ...rest] = name.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
  const last = rest[rest.length - 1] || '';
  if (!first || !last) return [];
  return [
    `${first}.${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}@${domain}`,
    `${first}${last}@${domain}`,
    `${first}_${last}@${domain}`,
  ];
}

export async function verifyEmail(address) {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { address, status: 'unverified', score: null };
  const res = await fetch(
    `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(address)}&api_key=${key}`
  );
  if (!res.ok) return { address, status: 'unverified', score: null };
  const d = await res.json();
  return { address, status: d.data?.status, score: d.data?.score };
}

export async function resolveAddress(name, domain) {
  for (const addr of candidateAddresses(name, domain)) {
    const v = await verifyEmail(addr);
    if (v.status === 'valid' || (v.score ?? 0) >= 80) return { ...v, confidence: 'verified' };
  }
  const fallback = candidateAddresses(name, domain)[0];
  return { address: fallback, status: 'unverified', confidence: 'guess' };
}

// ---------------------------------------------------------------------------
// The outreach email itself.
// ---------------------------------------------------------------------------

const EMAIL_PROMPT = `Write a first-touch outreach email from a senior TA executive
to the person a role reports to.

TO: {{NAME}}, {{TITLE}} at {{COMPANY}}
THEIR BACKGROUND: {{BACKGROUND}}
ROLE: {{ROLE_TITLE}}
WHAT THE ROLE ASKS FOR: {{JD_SUMMARY}}
CANDIDATE PROOF POINTS: {{PROOF}}
POSITIONING: {{POSITIONING}}

Structure:
1. Open on the company's specific strategic moment mapped to the role's core ask.
   Not generic admiration. Not congratulations on anything older than six months.
2. Concrete proof with real metrics, chosen to match what this role actually needs.
3. One sentence on availability.

Rules:
- Peer to peer. This is one senior operator writing to another.
- No compensation, ever.
- ZERO em dashes and ZERO en dashes in the body. The subject line may contain one.
- Under 250 words.
- Do not restate the resume. Give them a reason to open it.

Return ONLY JSON: {"subject": "...", "body": "..."}`;

export async function draftEmail(job, person, profile, positioning, jdSummary) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: EMAIL_PROMPT
        .replace('{{NAME}}', person.name || 'there')
        .replace('{{TITLE}}', person.title || '')
        .replace('{{COMPANY}}', job.company)
        .replace('{{BACKGROUND}}', person.background || 'unknown')
        .replace('{{ROLE_TITLE}}', job.title)
        .replace('{{JD_SUMMARY}}', job.description.slice(0, 4000))
        .replace('{{PROOF}}', profile.coreProofPoints.join('; '))
        .replace('{{POSITIONING}}', positioning || ''),
    }],
  });

  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const out = JSON.parse(text.replace(/```json|```/g, '').trim());
  out.body = out.body.replace(/[\u2014\u2013]/g, ', ');
  return out;
}
