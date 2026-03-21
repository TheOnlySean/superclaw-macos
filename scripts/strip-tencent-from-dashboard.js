#!/usr/bin/env node
/**
 * 从 dashboard-renderer 的构建产物中移除所有腾讯/QQ/微信相关逻辑：
 * - 禁用 beacon 上报（reportDirect/reportAsync/reportConservation 改为 no-op）
 * - 将所有腾讯/QQ 相关 URL 置空，避免任何请求发往腾讯服务器
 * SuperClaw 与腾讯无关联，不进行登录、验证或数据上报。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'dashboard-renderer', 'assets');
if (!fs.existsSync(assetsDir)) {
  console.log('strip-tencent-from-dashboard: no dashboard-renderer/assets, skip');
  process.exit(0);
}

const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
let patched = 0;

// 腾讯/QQ 相关 URL 全部置空；beacon 通过 stub 禁用，构造函数允许空 baseUrl 见下方
const urlReplacements = [
  ['https://pcmgrmonitor.3g.qq.com/test/datareport', ''],
  ['https://pcmgrmonitor.3g.qq.com/datareport', ''],
  ['https://jprx.sparta.html5.qq.com/', ''],
  ['https://security-test.guanjia.qq.com/login', ''],
  ['https://jprx.sparta.html5.qq.com/aizone/v1', ''],
  ['wss://jprx.sparta.html5.qq.com/agentwss', ''],
  ['https://jprx.m.qq.com/', ''],
  ['https://security.guanjia.qq.com/login', ''],
  ['https://mmgrcalltoken.3g.qq.com/aizone/v1', ''],
  ['wss://mmgrcalltoken.3g.qq.com/agentwss', ''],
];

// 允许空 baseUrl，避免置空 beaconUrl 后构造函数抛错（上报已 stub，不会真正请求）
function allowEmptyBaseUrl(content) {
  return content.replace(
    /if\(!n\.baseUrl\)throw new Error\("\[ClientAction\] baseUrl 必須項目です，上層から報告先URLを渡してください"\);/g,
    'if(!n.baseUrl)n.baseUrl="/";'
  );
}

// 禁用上报：在 reportDirect/reportAsync/reportConservation 方法体开头插入 return，不再发请求
function stubReportMethods(content) {
  let s = content;
  s = allowEmptyBaseUrl(s);
  // Dt.reportDirect / Mt.reportDirect
  s = s.replace(
    /reportDirect\(n,t,o\)\{const r=this\.buildPayload/g,
    'reportDirect(n,t,o){return;const r=this.buildPayload'
  );
  // Dt.reportAsync
  s = s.replace(
    /reportAsync\(n,t,o\)\{const r=this\.buildPayload\(n,t,o\);try\{const i=await fetch\(this\.baseUrl,\{headers:\{\"Content-Type\":\"application\/json\"\},method:\"POST\",body:JSON\.stringify\(r\),mode:\"cors\"\}\)/g,
    'reportAsync(n,t,o){return Promise.resolve(!1);const r=this.buildPayload(n,t,o);try{const i=await fetch(this.baseUrl,{headers:{"Content-Type":"application/json"},method:"POST",body:JSON.stringify(r),mode:"cors"})'
  );
  // Mt.reportAsync (body:r)
  s = s.replace(
    /reportAsync\(n,t,o\)\{const r=this\.buildPayload\(n,t,o\);try\{const i=await fetch\(this\.baseUrl,\{method:\"POST\",headers:\{\"Content-Type\":\"application\/json\"\},body:r\}\)/g,
    'reportAsync(n,t,o){return Promise.resolve(!1);const r=this.buildPayload(n,t,o);try{const i=await fetch(this.baseUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:r})'
  );
  // reportConservation (sendBeacon)
  s = s.replace(
    /reportConservation\(n,t,o\)\{const r=this\.buildPayload\(n,t,o\);navigator\.sendBeacon\(this\.baseUrl,JSON\.stringify\(r\)\)\}/g,
    'reportConservation(n,t,o){return;const r=this.buildPayload(n,t,o);navigator.sendBeacon(this.baseUrl,JSON.stringify(r))}'
  );
  return s;
}

for (const f of jsFiles) {
  const filePath = path.join(assetsDir, f);
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;

  for (const [from, to] of urlReplacements) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
    }
  }
  // 路由/文案：不再出现微信/WeChat 登录
  if (content.includes('WeChatログイン')) {
    content = content.split('WeChatログイン - SuperClaw').join('SuperClaw');
  }
  // 完全移除 /wx-login 路由：产品内不存在微信登录功能，不保留该 path
  if (content.includes('path:"/wx-login"')) {
    content = content.replace(
      /,\{path:"\/wx-login",redirect:"\/chat",name:"WXLogin",meta:\{title:"[^"]*"\}\}/g,
      ''
    );
  }
  // 禁止显示微信登录弹窗（requireLogin 时不再弹出 WeChat 扫码）
  if (content.includes('Pe.value=!0')) {
    content = content.replace(/\bPe\.value=!0\b/g, 'Pe.value=!1');
  }
  content = stubReportMethods(content);

  if (content !== orig) {
    fs.writeFileSync(filePath, content, 'utf8');
    patched++;
  }
}

if (patched > 0) {
  console.log('strip-tencent-from-dashboard: patched', patched, 'JS file(s); no requests to Tencent/QQ/WeChat.');
}
