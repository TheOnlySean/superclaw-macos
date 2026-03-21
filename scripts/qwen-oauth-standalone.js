#!/usr/bin/env node
/**
 * Qwen OAuth (device code flow) in a standalone Node process. Opens the
 * verification URL in the system browser. Writes credential to
 * OPENCLAW_AGENT_DIR/auth-profiles.json.
 * Usage:
 *   OPENCLAW_AGENT_DIR=/path/to/agent node scripts/qwen-oauth-standalone.js
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const agentDir = process.env.OPENCLAW_AGENT_DIR || path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw', 'agents', 'main', 'agent');

const QWEN_DEVICE_CODE_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/device/code';
const QWEN_TOKEN_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/token';
const QWEN_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_SCOPE = 'openid profile email model.completion';
const QWEN_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_MS = 600000;

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function openUrl(url) {
  if (process.platform === 'darwin') {
    require('child_process').spawnSync('open', [url], { stdio: 'inherit' });
  } else if (process.platform === 'win32') {
    require('child_process').spawnSync('start', [url], { shell: true, stdio: 'inherit' });
  } else {
    require('child_process').spawnSync('xdg-open', [url], { stdio: 'inherit' });
  }
}

async function main() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = pkceChallenge(verifier);

  const deviceRes = await fetch(QWEN_DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: QWEN_CLIENT_ID,
      scope: QWEN_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  });
  if (!deviceRes.ok) {
    const text = await deviceRes.text();
    throw new Error(`Device code request failed: ${deviceRes.status} ${text}`);
  }
  const device = await deviceRes.json();
  if (!device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error('Invalid device code response');
  }

  const url = device.verification_uri_complete || `${device.verification_uri}?user_code=${encodeURIComponent(device.user_code)}`;
  console.log('Opening browser for Qwen sign-in. User code:', device.user_code);
  openUrl(url);

  const intervalMs = (device.interval && device.interval > 0 ? device.interval : 2) * 1000;
  const deadline = Date.now() + (device.expires_in || 900) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const tokenRes = await fetch(QWEN_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: QWEN_GRANT_TYPE,
        client_id: QWEN_CLIENT_ID,
        device_code: device.device_code,
        code_verifier: verifier,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      const expires = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined;
      fs.mkdirSync(agentDir, { recursive: true });
      const authPath = path.join(agentDir, 'auth-profiles.json');
      let store = { version: 1, profiles: {} };
      if (fs.existsSync(authPath)) {
        try {
          store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
          if (!store.profiles) store.profiles = {};
        } catch (_) {}
      }
      const profileId = 'qwen-portal:default';
      store.profiles[profileId] = {
        type: 'oauth',
        provider: 'qwen-portal',
        access: tokenData.access_token,
        refresh: tokenData.refresh_token,
        expires,
      };
      fs.writeFileSync(authPath, JSON.stringify(store, null, 2), 'utf8');
      console.log('Auth profile saved:', profileId);
      return;
    }
    const err = tokenData.error || '';
    if (err === 'authorization_pending' || err === 'slow_down') continue;
    if (err === 'expired_token') throw new Error('Device code expired. Please try again.');
    throw new Error(tokenData.error_description || err || 'Token request failed');
  }
  throw new Error('Timed out waiting for sign-in. Please try again.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
