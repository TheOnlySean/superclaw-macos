#!/usr/bin/env node
/**
 * Run OpenAI Codex OAuth in a standalone Node process so we can open the browser
 * with the system "open" command (no TTY required). Writes credential to
 * OPENCLAW_AGENT_DIR/auth-profiles.json. Usage:
 *   OPENCLAW_ROOT=/path/to/openclaw OPENCLAW_AGENT_DIR=/path/to/agent node scripts/codex-oauth-standalone.js
 */
require('http'); // Ensure node:http is loaded so openai-codex's dynamic import resolves before startLocalOAuthServer
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const openclawRoot = process.env.OPENCLAW_ROOT;
const agentDir = process.env.OPENCLAW_AGENT_DIR || path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw', 'agents', 'main', 'agent');

function err(msg) {
  const s = msg + '\n';
  process.stderr.write(s);
}

if (!openclawRoot || !fs.existsSync(openclawRoot)) {
  err('OPENCLAW_ROOT must point to the openclaw bundle directory. Got: ' + (openclawRoot || '(empty)'));
  process.exit(1);
}

async function main() {
  const codexPath = path.join(openclawRoot, 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'utils', 'oauth', 'openai-codex.js');
  if (!fs.existsSync(codexPath)) {
    err('OpenAI Codex OAuth module not found at: ' + codexPath);
    process.exit(1);
  }

  const openViaMainProcess = process.env.SUPERCLAW_OPEN_AUTH_VIA_STDOUT === '1';

  function openUrl(url) {
    if (openViaMainProcess) {
      process.stdout.write('OPEN_AUTH_URL:' + url + '\n');
      return;
    }
    if (process.platform === 'darwin') {
      require('child_process').spawnSync('open', [url], { stdio: 'inherit' });
    } else if (process.platform === 'win32') {
      require('child_process').spawnSync('start', [url], { shell: true, stdio: 'inherit' });
    } else {
      require('child_process').spawnSync('xdg-open', [url], { stdio: 'inherit' });
    }
  }

  const codex = await import(pathToFileURL(codexPath).href);
  await new Promise((r) => setTimeout(r, 150)); // Let openai-codex's node:http import resolve so callback server can bind
  const creds = await codex.loginOpenAICodex({
    onAuth: ({ url }) => {
      console.log('Opening browser:', url);
      openUrl(url);
    },
    onPrompt: () =>
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Sign-in timed out. Complete login in the browser within 10 minutes and try again.')), 600000)
      ),
  });

  fs.mkdirSync(agentDir, { recursive: true });
  const authPath = path.join(agentDir, 'auth-profiles.json');
  let store = { version: 1, profiles: {} };
  if (fs.existsSync(authPath)) {
    try {
      store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (!store.profiles) store.profiles = {};
    } catch (_) {}
  }
  const profileId = 'openai-codex:default';
  store.profiles[profileId] = {
    type: 'oauth',
    provider: 'openai-codex',
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
    accountId: creds.accountId,
  };
  fs.writeFileSync(authPath, JSON.stringify(store, null, 2), 'utf8');
  console.log('Auth profile saved:', profileId);
}

main().catch((e) => {
  const msg = e && (e.message || String(e));
  const stack = e && e.stack;
  err(msg || 'Unknown error');
  if (stack && stack !== msg) err(stack);
  process.exit(1);
});
