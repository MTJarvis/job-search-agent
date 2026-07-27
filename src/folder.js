import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUTPUT_DIR || 'output';

const slug = (s) =>
  (s || '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);

export function createFolder(job) {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(OUT, `${date}_${slug(job.company)}_${slug(job.title)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// 00_BRIEF.md - the thing you read first. Title, scope, comp, location, then
// the honest read: fit, level, what to lead with, what is genuinely missing.
// ---------------------------------------------------------------------------

export function writeBrief(dir, { job, score, audit, plan, files }) {
  const gaps = [...new Set([...(score.realGaps || []), ...(plan?.honestGaps || [])])];
  const flags = (audit?.flags || []).filter((f) => f.severity === 'block');
  const warns = (audit?.flags || []).filter((f) => f.severity !== 'block');

  const md = `# ${job.company} - ${job.title}

**Fit ${score.score}/100 · ${String(score.recommend).toUpperCase()} · ${score.level}**

## The role

| | |
|---|---|
| **Title** | ${job.title} |
| **Company** | ${job.company} |
| **Location** | ${job.location} |
| **Arrangement** | ${score.locationRead || 'not stated'} |
| **Compensation** | ${score.compRead || job.compRaw || 'not posted'} |
| **Reports to** | ${score.reportsTo || 'not stated in posting'} |
| **Source** | ${job.source} |
| **Posting** | ${job.url} |
| **Found** | ${new Date().toISOString().slice(0, 10)} |

## Scope

${score.scope || score.whyOrWhyNot || 'See posting.'}

## Read

${score.whyOrWhyNot || ''}

**Lead with:** ${score.positioning || 'not determined'}

## Honest gaps

${gaps.length ? gaps.map((g) => `- ${g}`).join('\n') : '- None identified against the posting.'}

## Before you send

${flags.length ? flags.map((f) => `- **BLOCKED:** ${f.text}${f.where ? ` (${f.where})` : ''}`).join('\n') : '- Fabrication audit clean.'}
${warns.length ? '\n' + warns.map((f) => `- Check: ${f.text}`).join('\n') : ''}
${plan?.claimsToVerify?.length ? '\n' + plan.claimsToVerify.map((c) => `- Verify: ${c}`).join('\n') : ''}
- Confirm the comp band early if it is unposted.
- Confirm the location arrangement before committing to relocation.

## Files

${(files || []).map((f) => `- \`${path.basename(f)}\``).join('\n')}

## Next steps

- [ ] Review resume and cover letter
- [ ] Verify the hiring manager address (see 01_CONTACT.md)
- [ ] Send the outreach email (draft is in Outlook and in 02_EMAIL.md)
- [ ] Submit the application at the posting link
- [ ] Log to MJarvis_Master_Job_Tracker_2026.xlsx
`;

  const p = path.join(dir, '00_BRIEF.md');
  fs.writeFileSync(p, md);
  return p;
}

// ---------------------------------------------------------------------------
// 01_CONTACT.md
// ---------------------------------------------------------------------------

export function writeContact(dir, { job, contact, address }) {
  const p1 = contact?.primary || {};
  const md = `# Hiring manager - ${job.company}

## Primary

| | |
|---|---|
| **Name** | ${p1.name || 'Not established'} |
| **Title** | ${p1.title || ''} |
| **Email** | ${address?.address || 'not resolved'} |
| **Verification** | ${address?.confidence || 'none'}${address?.status ? ` (${address.status}${address.score != null ? `, score ${address.score}` : ''})` : ''} |
| **Confidence** | ${p1.confidence || 'low'} |

**Evidence:** ${p1.evidence || 'none'}

**Background worth knowing:** ${p1.background || 'none found'}

## Alternates

${(contact?.alternates || []).length
  ? contact.alternates.map((a) => `- **${a.name}**, ${a.title}. ${a.why || ''}`).join('\n')
  : '- None identified.'}

## Email pattern

${contact?.emailPatternNotes || 'Not determined.'}

## Cautions

${contact?.cautions || 'None.'}

---

${address?.confidence !== 'verified'
  ? '> **This address was inferred, not verified.** Run it through Hunter.io before sending, and watch for a bounce.'
  : '> Address verified.'}
`;

  const p = path.join(dir, '01_CONTACT.md');
  fs.writeFileSync(p, md);
  return p;
}

// ---------------------------------------------------------------------------
// 02_EMAIL.md
// ---------------------------------------------------------------------------

export function writeEmail(dir, { email, address, contact, draftId }) {
  const md = `# Outreach email

**To:** ${contact?.primary?.name || ''} <${address?.address || 'unresolved'}>
**Subject:** ${email.subject}
**Outlook draft:** ${draftId ? 'saved to Drafts' : 'not created'}
**Attachment:** tailored resume PDF

---

${email.body}

---

_No compensation mentioned. No em or en dashes in the body. Verify the address before sending._
`;

  const p = path.join(dir, '02_EMAIL.md');
  fs.writeFileSync(p, md);
  return p;
}

export function writePosting(dir, job) {
  const p = path.join(dir, '03_POSTING.txt');
  fs.writeFileSync(p, `${job.company} - ${job.title}\n${job.location}\n${job.url}\n\n${job.description}`);
  return p;
}

// One index across every folder, so you can scan the week at a glance.
export function writeIndex(items) {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = items
    .sort((a, b) => b.score.score - a.score.score)
    .map((it) =>
      `| ${it.score.score} | ${it.job.company} | ${it.job.title} | ${it.score.compRead || 'n/a'} | ${it.job.location} | ${it.contact?.primary?.name || 'none'} | \`${path.basename(it.dir)}\` |`
    );

  const md = `# Job agent - ${new Date().toISOString().slice(0, 10)}

${items.length} roles cleared screening.

| Fit | Company | Role | Comp | Location | Contact | Folder |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`;

  const p = path.join(OUT, `INDEX_${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(p, md);
  return p;
}
