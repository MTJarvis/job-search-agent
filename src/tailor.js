import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-6';

// The model never writes the .docx. It produces a structured PLAN, which the
// deterministic builder renders. That split is what keeps formatting stable
// and makes the fabrication check possible before anything reaches a page.

const PLAN_PROMPT = `Reframe a baseline resume for a specific role. Reframe only.
Every fact in the output must trace to the baseline. You may re-order, re-weight,
re-word, promote a buried item, and drop irrelevant items. You may NOT add an
employer, a metric, a tool, a certification, a domain, or a date that is not in
the baseline.

BASELINE RESUME
{{BASELINE}}

NOT HELD - never claim these under any framing
{{NOTHELD}}

TARGET ROLE
{{COMPANY}} - {{TITLE}} - {{LOCATION}}
{{DESCRIPTION}}

POSITIONING DIRECTION
{{POSITIONING}}

STYLE RULES
- Zero em dashes and zero en dashes anywhere. Use "to" in date ranges.
- Two pages maximum. One page for a cover letter.
- Mirror the posting's own vocabulary where the baseline supports it honestly.

Respond with ONLY JSON, no fences:
{
  "tagline": "<one line under the name, or null>",
  "summary": "<4-6 sentences, no dashes>",
  "competencies": [{"label": "...", "text": "..."}],
  "roles": [
    {"title": "...", "company": "...", "dates": "...", "context": "...",
     "bullets": ["..."]}
  ],
  "earlier": ["..."],
  "certifications": ["..."],
  "leadWith": "<what this build leads with and why, one sentence>",
  "honestGaps": ["<what the JD asks for that is genuinely absent>"],
  "claimsToVerify": ["<any statement a reviewer should sanity check before sending>"]
}`;

export async function buildPlan(job, profile, baselineText, positioning) {
  const prompt = PLAN_PROMPT
    .replace('{{BASELINE}}', baselineText)
    .replace('{{NOTHELD}}', JSON.stringify(profile.notHeld, null, 2))
    .replace('{{COMPANY}}', job.company)
    .replace('{{TITLE}}', job.title)
    .replace('{{LOCATION}}', job.location)
    .replace('{{DESCRIPTION}}', job.description.slice(0, 12000))
    .replace('{{POSITIONING}}', positioning || 'use your judgment');

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const plan = JSON.parse(text.replace(/```json|```/g, '').trim());
  return plan;
}

// ---------------------------------------------------------------------------
// Fabrication guard. Second model call, adversarial framing, cheap insurance.
// Anything it flags blocks the auto-apply path and surfaces in the digest.
// ---------------------------------------------------------------------------

export async function auditPlan(plan, baselineText, profile) {
  const prompt = `Compare a tailored resume draft against the baseline it came from.
Your only job is to catch claims the baseline does not support.

BASELINE
${baselineText}

NEVER-CLAIM LIST
${JSON.stringify(profile.notHeld)}

DRAFT
${JSON.stringify(plan, null, 2)}

Flag: invented metrics, inflated numbers, employers or dates that do not match,
tools or certifications not in the baseline, domain experience implied but not held,
and any em dash or en dash characters.

Respond with ONLY JSON:
{"clean": true|false, "flags": [{"severity":"block"|"warn","text":"...","where":"..."}]}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { clean: false, flags: [{ severity: 'block', text: 'audit parse failure' }] };
  }
}


export function loadBaseline(p = 'config/baseline_cv.txt') {
  return fs.readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Cover letter. Separate call so the resume plan stays clean, and so a bad
// letter does not invalidate a good resume.
// ---------------------------------------------------------------------------

const LETTER_PROMPT = `Write a one page cover letter for a senior Talent Acquisition executive.

TARGET
{{COMPANY}} - {{TITLE}}
{{DESCRIPTION}}

RESUME PLAN ALREADY BUILT FOR THIS ROLE
{{PLAN}}

POSITIONING
{{POSITIONING}}

HONEST GAPS - name the most material one plainly near the end rather than hiding it
{{GAPS}}

Rules:
- Do not restate the resume. Give a reason to read it.
- Open on something specific to this company and this moment, not generic admiration.
- Four to six paragraphs, one page.
- ZERO em dashes and ZERO en dashes.
- No compensation.

Return ONLY JSON: {"salutation": "...", "paragraphs": ["...", "..."]}`;

export async function buildCoverLetter(job, plan, positioning) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: LETTER_PROMPT
        .replace('{{COMPANY}}', job.company)
        .replace('{{TITLE}}', job.title)
        .replace('{{DESCRIPTION}}', job.description.slice(0, 8000))
        .replace('{{PLAN}}', JSON.stringify({ summary: plan.summary, roles: plan.roles?.slice(0, 2) }))
        .replace('{{POSITIONING}}', positioning || '')
        .replace('{{GAPS}}', JSON.stringify(plan.honestGaps || [])),
    }],
  });
  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const out = JSON.parse(text.replace(/```json|```/g, '').trim());
  out.paragraphs = (out.paragraphs || []).map((p) => p.replace(/[\u2014\u2013]/g, ', '));
  return out;
}
