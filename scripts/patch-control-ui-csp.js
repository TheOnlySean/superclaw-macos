/**
 * 对 openclaw 的 dist/*.js 放宽 Control UI 的 CSP，避免 Dashboard 载入页被拦（base-uri、inline script、connect-src）。
 * 被 bundle-openclaw.js 与 afterPack 钩子共用。
 */
const fs = require('fs');
const path = require('path');

function patchControlUiCsp(openclawDir) {
  const distDir = path.join(openclawDir, 'dist');
  if (!fs.existsSync(distDir)) return;
  const cspOld = [
    '"base-uri \'none\'"',
    '"script-src \'self\'"',
    '"connect-src \'self\' ws: wss:"',
  ];
  const cspNew = [
    '"base-uri \'self\'"',
    '"script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'"',
    '"connect-src \'self\' ws: wss: https:"',
  ];
  for (const name of fs.readdirSync(distDir)) {
    if (!name.endsWith('.js')) continue;
    const full = path.join(distDir, name);
    let code = fs.readFileSync(full, 'utf8');
    if (!code.includes("base-uri 'none'")) continue;
    let changed = false;
    for (let i = 0; i < cspOld.length; i++) {
      if (code.includes(cspOld[i])) {
        code = code.split(cspOld[i]).join(cspNew[i]);
        changed = true;
      }
    }
    // 正则后备：应对不同引号/格式（如 minify 后或新版本 openclaw）
    if (code.includes("base-uri 'none'")) {
      code = code.replace(/"base-uri\s+'none'"/g, '"base-uri \'self\'"');
      code = code.replace(/'base-uri\s+'none''/g, "'base-uri 'self''");
      changed = true;
    }
    if (code.includes("script-src 'self'") && !code.includes("'unsafe-inline'")) {
      code = code.replace(/"script-src\s+'self'"/g, '"script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'"');
      changed = true;
    }
    if (code.includes("connect-src 'self' ws: wss:") && !code.includes("wss: https:")) {
      code = code.replace(/"connect-src\s+'self'\s+ws:\s*wss:"/g, '"connect-src \'self\' ws: wss: https:"');
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(full, code);
      console.log('Patched', name, ': relaxed Control UI CSP for SuperClaw dashboard');
    }
  }
}

module.exports = { patchControlUiCsp };
