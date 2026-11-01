#!/usr/bin/env node
// The credentials of dev/cws-publish.mjs, without pasting a secret anywhere.
//
//   node dev/cws-auth.mjs CLIENT_JSON PUBLISHER_ID
//
// CLIENT_JSON is the file Google Cloud offers to download for an OAuth
// client of the type "Desktop app" (client_secret_….json). The script
// listens on a loopback port, prints the address of Google's consent page,
// and once the developer account has allowed the Chrome Web Store scope
// there, exchanges the code for a refresh token and writes
// ~/.config/kepuli-tv/cws.json (mode 600) for dev/cws-publish.mjs. Neither
// the client secret nor the token is typed into a form or shown here.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const CONFIG_DIR = join(homedir(), '.config', 'kepuli-tv');
const CONFIG = join(CONFIG_DIR, 'cws.json');
const WAIT_MS = 10 * 60 * 1000;

const [clientFile, publisherId] = process.argv.slice(2);
if (!clientFile || !publisherId) {
  console.error('usage: node dev/cws-auth.mjs CLIENT_JSON PUBLISHER_ID');
  process.exit(1);
}
const json = JSON.parse(readFileSync(clientFile, 'utf8'));
const client = json.installed || json.web;
if (!client || !client.client_id || !client.client_secret) {
  console.error(`${clientFile} is not an OAuth client file`);
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirect = `http://127.0.0.1:${server.address().port}`;
const consent = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent', state,
})}`;
console.log(`Open this address and allow access:\n${consent}\n`);

const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no answer within ten minutes')), WAIT_MS);
  server.on('request', (req, res) => {
    const url = new URL(req.url, redirect);
    if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
    const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Kepuli-TV: access granted. You can close this tab.' : `Kepuli-TV: ${url.searchParams.get('error') || 'no code'}`);
    clearTimeout(timer);
    if (ok) resolve(url.searchParams.get('code'));
    else reject(new Error(url.searchParams.get('error') || 'the answer carried no code'));
  });
}).finally(() => server.close());

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code, client_id: client.client_id, client_secret: client.client_secret,
    redirect_uri: redirect, grant_type: 'authorization_code',
  }),
});
const token = await res.json();
if (!res.ok || !token.refresh_token) {
  console.error(`the token exchange failed (${res.status}): ${token.error_description || token.error || 'no refresh token returned'}`);
  process.exit(1);
}
mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
writeFileSync(CONFIG, `${JSON.stringify({
  clientId: client.client_id, clientSecret: client.client_secret, refreshToken: token.refresh_token, publisherId,
}, null, 2)}\n`, { mode: 0o600 });
chmodSync(CONFIG, 0o600);
console.log(`Written ${CONFIG}. Check it with: node dev/cws-publish.mjs check`);
