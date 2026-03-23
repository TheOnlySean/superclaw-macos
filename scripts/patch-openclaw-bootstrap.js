/**
 * openclaw.mjs は `./dist/entry.js` を相対 import するが、
 * macOS App Translocation や .app 名にスペースがあると解決に失敗することがある。
 * import.meta.url からの絶対パス（file: URL）で entry を読み込むよう差し替える。
 * 冪等：既にパッチ済みなら何もしない。
 */
const fs = require('fs');

const MARKER = 'openclawRoot = dirname(fileURLToPath(import.meta.url))';

function patchOpenclawMjs(mjsPath) {
  if (!fs.existsSync(mjsPath)) {
    console.warn('[patch-openclaw-bootstrap] skip, missing:', mjsPath);
    return false;
  }
  let src = fs.readFileSync(mjsPath, 'utf8');
  if (src.includes(MARKER)) {
    return false;
  }

  const importBlock = `import module from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
`;

  const shebangImport = /^#!\/usr\/bin\/env node\n\nimport module from "node:module";\n\n/;
  const shebangImportTight = /^#!\/usr\/bin\/env node\nimport module from "node:module";\n\n/;
  const plainImport = /^import module from "node:module";\n\n/;
  const plainImportTight = /^import module from "node:module";\n/;

  if (shebangImport.test(src)) {
    src = src.replace(shebangImport, `#!/usr/bin/env node\n\n${importBlock}\n`);
  } else if (shebangImportTight.test(src)) {
    src = src.replace(shebangImportTight, `#!/usr/bin/env node\n\n${importBlock}\n`);
  } else if (plainImport.test(src)) {
    src = src.replace(plainImport, `${importBlock}\n`);
  } else if (plainImportTight.test(src)) {
    src = src.replace(plainImportTight, `${importBlock}\n`);
  } else {
    console.warn('[patch-openclaw-bootstrap] unexpected header, skip:', mjsPath);
    return false;
  }

  const oldTail = `if (await tryImport("./dist/entry.js")) {
  // OK
} else if (await tryImport("./dist/entry.mjs")) {
  // OK
} else {
  throw new Error("openclaw: missing dist/entry.(m)js (build output).");
}`;

  const newTail = `const openclawRoot = dirname(fileURLToPath(import.meta.url));
const entryJsPath = join(openclawRoot, "dist", "entry.js");
const entryMjsPath = join(openclawRoot, "dist", "entry.mjs");
if (await tryImport(pathToFileURL(entryJsPath).href)) {
  // OK
} else if (await tryImport(pathToFileURL(entryMjsPath).href)) {
  // OK
} else {
  throw new Error(
    "openclaw: missing dist/entry.(m)js (build output). dir=" + openclawRoot,
  );
}`;

  if (!src.includes(oldTail)) {
    console.warn('[patch-openclaw-bootstrap] entry block not found, skip:', mjsPath);
    return false;
  }

  src = src.replace(oldTail, newTail);
  fs.writeFileSync(mjsPath, src, 'utf8');
  console.log('[patch-openclaw-bootstrap] patched', mjsPath);
  return true;
}

module.exports = { patchOpenclawMjs };
