// One-time: get a Microsoft Graph refresh token for your mailbox.
//
//   node scripts/ms-auth.js
//
// Opens a local listener on :3000, sends you to the Microsoft consent page,
// captures the code, exchanges it, and prints MS_REFRESH_TOKEN for your .env.
// Refresh tokens for personal accounts last 90 days of inactivity; daily runs
// keep it alive indefinitely.

import 'dotenv/config';
import http from 'node:http';

const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const TENANT = process.env.MS_TENANT_ID || 'consumers';
const REDIRECT = 'http://localhost:3000/callback';
const SCOPE = 'offline_access Mail.ReadWrite Mail.Send User.Read';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set MS_CLIENT_ID and MS_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const authUrl =
  `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&response_mode=query` +
  `&scope=${encodeURIComponent(SCOPE)}`;

console.log('\nOpen this in a browser and sign in:\n');
console.log(authUrl);
console.log('\nWaiting on localhost:3000 ...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  if (url.pathname !== '/callback') { res.end(); return; }

  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error_description');
  if (err) {
    res.end(`Error: ${err}`);
    console.error(err);
    process.exit(1);
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
    code,
    scope: SCOPE,
  });

  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', body,
  });
  const d = await r.json();

  if (!d.refresh_token) {
    res.end('Token exchange failed, see terminal.');
    console.error(d);
    process.exit(1);
  }

  res.end('Done. Copy the refresh token from your terminal and close this tab.');
  console.log('\nAdd this line to .env:\n');
  console.log(`MS_REFRESH_TOKEN=${d.refresh_token}\n`);
  server.close();
  process.exit(0);
});

server.listen(3000);
