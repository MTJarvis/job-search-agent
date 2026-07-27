import fs from 'node:fs';
import path from 'node:path';

// Microsoft Graph: create a draft in the mailbox, attach the tailored resume,
// leave it unsent. You review and hit send.
//
// Azure app registration, one time:
//   1. portal.azure.com > App registrations > New registration
//   2. Redirect URI: http://localhost:3000/callback  (type: Web)
//   3. API permissions > Microsoft Graph > Delegated > Mail.ReadWrite
//   4. Certificates & secrets > New client secret
//
// A personal outlook.com account uses tenant "consumers".

const GRAPH = 'https://graph.microsoft.com/v1.0';
let cachedToken = null;
let tokenExpiry = 0;

export async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const tenant = process.env.MS_TENANT_ID || 'consumers';
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'refresh_token',
    refresh_token: process.env.MS_REFRESH_TOKEN,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    { method: 'POST', body }
  );
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);

  const d = await res.json();
  cachedToken = d.access_token;
  tokenExpiry = Date.now() + d.expires_in * 1000;
  return cachedToken;
}

async function graph(method, url, body, token) {
  const res = await fetch(`${GRAPH}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export async function createDraft({ to, subject, body, attachments = [], toName }) {
  const token = await getToken();

  const draft = await graph('POST', '/me/messages', {
    subject,
    body: { contentType: 'Text', content: body },
    toRecipients: [{ emailAddress: { address: to, name: toName || undefined } }],
  }, token);

  for (const filePath of attachments) {
    const buf = fs.readFileSync(filePath);
    if (buf.length > 3 * 1024 * 1024) {
      console.warn(`  [attach] ${path.basename(filePath)} exceeds simple-upload size, skipping`);
      continue;
    }
    await graph('POST', `/me/messages/${draft.id}/attachments`, {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: path.basename(filePath),
      contentBytes: buf.toString('base64'),
    }, token);
  }

  return { id: draft.id, webLink: draft.webLink };
}

// Optional: a single daily digest email to yourself with everything queued.
export async function createDigest(items) {
  const lines = items.map((it, i) => {
    const s = it.score;
    return [
      `${i + 1}. ${it.job.company} - ${it.job.title}`,
      `   Score ${s.score}/100 (${s.recommend}) | ${s.level} | ${s.compRead}`,
      `   ${s.locationRead}`,
      `   Lead with: ${s.positioning}`,
      s.realGaps?.length ? `   Gaps: ${s.realGaps.join('; ')}` : null,
      it.audit && !it.audit.clean
        ? `   REVIEW: ${it.audit.flags.map((f) => f.text).join(' | ')}`
        : null,
      it.contact?.primary?.name
        ? `   Contact: ${it.contact.primary.name}, ${it.contact.primary.title} (${it.address?.confidence})`
        : `   Contact: not established`,
      `   ${it.job.url}`,
      `   Approve: ${it.approveUrl || 'n/a'}`,
      '',
    ].filter(Boolean).join('\n');
  });

  return createDraft({
    to: process.env.MS_USER,
    subject: `Job agent: ${items.length} new for review`,
    body: `${items.length} roles cleared screening today.\n\n${lines.join('\n')}`,
  });
}
