#!/usr/bin/env node
/**
 * OpenClaw に日本語 locale を追加してビルドし、control-ui-ja にコピーする。
 * 実行前に: Node 22+, pnpm がインストールされていること。
 * 使い方: リポジトリルートで
 *   node superclaw-setup/scripts/prepare-control-ui-ja.js
 * または superclaw-setup から
 *   node scripts/prepare-control-ui-ja.js
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const OPENCLAW_PR_JA = path.join(REPO_ROOT, 'docs', 'openclaw-pr-ja');
const CONTROL_UI_JA = path.join(path.dirname(__dirname), 'control-ui-ja');
const BUILD_DIR = path.join(REPO_ROOT, '.openclaw-ja-build');

function run(cmd, opts = {}) {
  console.log('$', cmd);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function patchFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    if (!content.includes(from)) {
      console.warn('Warning: pattern not found in', filePath);
      continue;
    }
    content = content.replace(from, to);
  }
  fs.writeFileSync(filePath, content);
}

function main() {
  console.log('SuperClaw: 日本語 Control UI をビルドして control-ui-ja にコピーします…\n');

  if (!fs.existsSync(path.join(OPENCLAW_PR_JA, 'locales', 'ja.ts'))) {
    console.error('Error: docs/openclaw-pr-ja/locales/ja.ts が見つかりません。');
    process.exit(1);
  }

  if (fs.existsSync(BUILD_DIR)) {
    console.log('既存の .openclaw-ja-build を使用します。');
  } else {
    console.log('OpenClaw を clone しています…');
    run(`git clone --depth 1 https://github.com/openclaw/openclaw.git "${BUILD_DIR}"`, { cwd: REPO_ROOT });
  }

  const ui = path.join(BUILD_DIR, 'ui');
  const localesDir = path.join(ui, 'src', 'i18n', 'locales');
  const libDir = path.join(ui, 'src', 'i18n', 'lib');

  console.log('\nja.ts をコピーしています…');
  fs.mkdirSync(localesDir, { recursive: true });
  fs.copyFileSync(path.join(OPENCLAW_PR_JA, 'locales', 'ja.ts'), path.join(localesDir, 'ja.ts'));

  console.log('types.ts を修正しています…');
  patchFile(path.join(libDir, 'types.ts'), [
    ['export type Locale = "en" | "zh-CN" | "zh-TW" | "pt-BR" | "de" | "es";', 'export type Locale = "en" | "zh-CN" | "zh-TW" | "pt-BR" | "de" | "es" | "ja";'],
  ]);

  console.log('registry.ts を修正しています…');
  const registryPath = path.join(libDir, 'registry.ts');
  patchFile(registryPath, [
    ['const LAZY_LOCALES: readonly LazyLocale[] = ["zh-CN", "zh-TW", "pt-BR", "de", "es"];', 'const LAZY_LOCALES: readonly LazyLocale[] = ["zh-CN", "zh-TW", "pt-BR", "de", "es", "ja"];'],
    [
      '  if (navLang.startsWith("es")) {\n    return "es";\n  }\n  return DEFAULT_LOCALE;',
      '  if (navLang.startsWith("es")) {\n    return "es";\n  }\n  if (navLang.startsWith("ja")) {\n    return "ja";\n  }\n  return DEFAULT_LOCALE;',
    ],
  ]);
  let reg = fs.readFileSync(registryPath, 'utf8');
  if (!reg.includes('loader: () => import("../locales/ja.ts")')) {
    reg = reg.replace(
      /  es: \{\n    exportName: "es",\n    loader: \(\) => import\("\.\.\/locales\/es\.ts"\),\n  \},/,
      '  es: {\n    exportName: "es",\n    loader: () => import("../locales/es.ts"),\n  },\n  ja: {\n    exportName: "ja",\n    loader: () => import("../locales/ja.ts"),\n  },'
    );
    fs.writeFileSync(registryPath, reg);
  }

  console.log('en.ts に languages.ja を追加しています…');
  const enPath = path.join(localesDir, 'en.ts');
  let enContent = fs.readFileSync(enPath, 'utf8');
  if (!enContent.includes('ja: "日本語"')) {
    enContent = enContent.replace(
      /es: "Español \(Spanish\)",\s*\n\s*\},\s*\n\s*cron:/,
      'es: "Español (Spanish)",\n  ja: "日本語",\n },\n cron:'
    );
    fs.writeFileSync(enPath, enContent);
  }

  // SuperClaw 向け：ツールバー（サイドバーメニュー）の順序・構成。
  // SUPERCLAW_NAV_ORDER=1 → Chat・Skill・Agent・Cron・Channel の順、データ系は後ろ。
  // SUPERCLAW_NAV_SKILL_ONLY=1 → チャットとスキルのみ。SUPERCLAW_SIMPLE_NAV=1 → 簡易メニュー。
  const navPath = path.join(ui, 'src', 'ui', 'navigation.ts');
  let navContent = fs.readFileSync(navPath, 'utf8');
  const navOrder = process.env.SUPERCLAW_NAV_ORDER === '1';
  const skillOnly = process.env.SUPERCLAW_NAV_SKILL_ONLY === '1';
  const simpleNav = process.env.SUPERCLAW_SIMPLE_NAV === '1';
  if (navOrder) {
    const groups = `// SuperClaw：ユーザー向け順（チャット→スキル→エージェント→クロン→チャンネル）、データ系は後ろ
export const TAB_GROUPS = [
  { label: "chat", tabs: ["chat"] },
  { label: "agent", tabs: ["skills", "agents", "nodes"] },
  { label: "control", tabs: ["cron", "channels", "overview", "sessions", "instances", "usage"] },
  { label: "settings", tabs: ["config", "debug", "logs"] },
] as const;`;
    navContent = navContent.replace(
      /export const TAB_GROUPS = \[[\s\S]*?\] as const;/,
      groups
    );
    fs.writeFileSync(navPath, navContent);
    console.log('SUPERCLAW_NAV_ORDER=1: メニューをチャット・スキル・エージェント・クロン・チャンネルの順にしました。');
  } else if (skillOnly) {
    const groups = `// SuperClaw：ツールバーはチャットとスキルのみ
export const TAB_GROUPS = [
  { label: "chat", tabs: ["chat"] },
  { label: "agent", tabs: ["skills"] },
] as const;`;
    navContent = navContent.replace(
      /export const TAB_GROUPS = \[[\s\S]*?\] as const;/,
      groups
    );
    fs.writeFileSync(navPath, navContent);
    console.log('SUPERCLAW_NAV_SKILL_ONLY=1: サイドバーをチャット・スキルのみにしました。');
  } else if (simpleNav) {
    const simpleGroups = `// SuperClaw 簡易メニュー：よく使う項目のみ（チャット・スキル・概要・セッション・設定）
export const TAB_GROUPS = [
  { label: "chat", tabs: ["chat"] },
  { label: "control", tabs: ["overview", "sessions", "channels"] },
  { label: "agent", tabs: ["agents", "skills"] },
  { label: "settings", tabs: ["config"] },
] as const;`;
    navContent = navContent.replace(
      /export const TAB_GROUPS = \[[\s\S]*?\] as const;/,
      simpleGroups
    );
    fs.writeFileSync(navPath, navContent);
    console.log('SUPERCLAW_SIMPLE_NAV=1: メニューを簡略化しました（チャット・概要・セッション・チャンネル・エージェント・スキル・設定）。');
  }

  console.log('\nOpenClaw UI をビルドしています（pnpm install & pnpm ui:build）…');
  run('npx pnpm install', { cwd: BUILD_DIR });
  run('npx pnpm ui:build', { cwd: BUILD_DIR });

  const distControlUi = path.join(BUILD_DIR, 'dist', 'control-ui');
  if (!fs.existsSync(path.join(distControlUi, 'index.html'))) {
    console.error('Error: ビルド成果物に index.html がありません。');
    process.exit(1);
  }

  console.log('\ncontrol-ui-ja にコピーしています…');
  const dest = CONTROL_UI_JA;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(distControlUi, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(distControlUi, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      if (fs.existsSync(destPath)) run(`rm -rf "${destPath}"`);
      run(`cp -R "${srcPath}" "${destPath}"`);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // SuperClaw 品牌：标题改为 SuperClaw，并复制应用图标到 assets 供注入使用
  const indexPath = path.join(dest, 'index.html');
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  indexHtml = indexHtml.replace(/<title>.*?<\/title>/, '<title>SuperClaw</title>');
  if (!indexHtml.includes('superclaw-patch.js')) {
    indexHtml = indexHtml.replace('</body>', '    <script src="./superclaw-patch.js"></script>\n  </body>');
  }
  fs.writeFileSync(indexPath, indexHtml);
  const patchSrc = path.join(path.dirname(CONTROL_UI_JA), 'scripts', 'superclaw-patch.js');
  if (fs.existsSync(patchSrc)) {
    fs.copyFileSync(patchSrc, path.join(dest, 'superclaw-patch.js'));
    console.log('SuperClaw ダッシュボードパッチ（毛玻璃・スキルマーケット）をコピーしました。');
  }
  const avatarDir = path.join(dest, 'avatar');
  if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
  const avatarPlaceholder = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  fs.writeFileSync(path.join(avatarDir, 'main'), avatarPlaceholder);
  const openclawDir = path.join(dest, '__openclaw');
  if (!fs.existsSync(openclawDir)) fs.mkdirSync(openclawDir, { recursive: true });
  const controlUiConfig = JSON.stringify({ basePath: '', assistantName: 'Assistant', assistantAvatar: null, assistantAgentId: null, serverVersion: null });
  fs.writeFileSync(path.join(openclawDir, 'control-ui-config.json'), controlUiConfig, 'utf8');
  const iconSrc = path.join(path.dirname(CONTROL_UI_JA), 'build', 'icons', 'icon-512.png');
  const assetsDir = path.join(dest, 'assets');
  if (fs.existsSync(iconSrc) && fs.existsSync(assetsDir)) {
    fs.copyFileSync(iconSrc, path.join(assetsDir, 'superclaw-icon.png'));
    console.log('SuperClaw アイコンを control-ui-ja/assets にコピーしました。');
  }

  console.log('\n完了。control-ui-ja に日本語 UI が入りました。');
  console.log('次に npm run dist または npm run dist:mac:arm64 でパッケージしてください。');
}

main();
