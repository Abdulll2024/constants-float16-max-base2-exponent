/* DSH Console — 工具脚本 verify-sidebar.mjs
 * Copyright 2026 liwei (易智瑞西安) <liwei@geoscene.cn>
 * SPDX-License-Identifier: Apache-2.0
 *
 * 依据 Apache License 2.0 授权使用与分发；许可证全文见项目根目录 LICENSE，摘要见 NOTICE。
 */
/* 侧栏行为回归 + 滚动条外观取证（CDP 真机）。
 *
 * 为什么需要：2026-10-03 用户报「点最底下的菜单后侧栏弹回顶部」。
 *   根因是 renderNav() 把高亮类 `class="on"` 织进了缓存 HTML —— 换页必换字符串
 *   → `#side` 整块 innerHTML 被重建 → scrollTop 归零。这类「DOM 重建吞掉滚动位置」
 *   的回归，静态审计与沙盒渲染都看不出来，只能真机点一遍。
 *   顺带把滚动条外观（半透明细胶囊）也截下来存档：改样式没法用断言表达，得看图。
 *
 * 用法：node tools/verify-sidebar.mjs
 *   依赖：控制台在 127.0.0.1:3081（可用 CONSOLE_PORT 覆盖）运行；本机 Edge。
 *         若 DSH 令牌过期导致前端 boot 不完整，可配 tools/mock-dsh.mjs 顶上（见该文件说明）。
 *   产出：截图写到系统临时目录 dsh-verify-sidebar/（不进仓库），控制台打印 PASS/FAIL。
 *   退出码：0 = 两个用例都过；1 = 有失败（可直接接进 CI/发版门禁）。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const PORT = String(process.env.CONSOLE_PORT || 3081);
const BASE = 'http://127.0.0.1:' + PORT;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 msedge.exe —— 无法验证'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DP = 9337;                                   // 与其他 tools/*.mjs 的调试端口错开，避免撞车
const OUT = path.join(os.tmpdir(), 'dsh-verify-sidebar');
fs.mkdirSync(OUT, { recursive: true });

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + DP, '--window-size=1600,760',   // 不用 --hide-scrollbars：就是要看滚动条
  '--user-data-dir=' + path.join(os.tmpdir(), 'dsh-verify-side-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

let ws, msgId = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });

try {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch('http://127.0.0.1:' + DP + '/json')).json()).find(t => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('Edge 没起来（CDP 端口无 page 目标）');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  };
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL ERR: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async file => {
    const cdp = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(cdp.data, 'base64'));
  };
  /* 用 mock 后端时 boot 的启动 IIFE 可能在 render() 之前卡住（缺接口不报错、只是不往下走），
     手动补一次渲染。接真 DSH 时它本来就是已渲染状态，重渲染一次也无害。 */
  const forceRender = () => ev('try { render(); } catch (e) {}');

  /* ---- 用例①：滚到底 → 点最后一个菜单 → scrollTop 不应归零 ---- */
  await send('Page.navigate', { url: BASE + '/#/home' });
  await sleep(5000);
  await forceRender();
  const probe = await ev(`(() => {
    const s = document.getElementById('side');
    if (!s) return { err: 'no #side' };
    return { items: s.querySelectorAll('a').length, scrollH: s.scrollHeight, clientH: s.clientHeight };
  })()`);
  console.log('侧栏探测:', JSON.stringify(probe));
  if (!probe.items) throw new Error('侧栏没渲染出来（控制台未 boot？见文件头说明）');
  if (probe.scrollH <= probe.clientH) console.log('注意：侧栏在此窗口高度下不滚动（scrollH<=clientH），跳顶问题无从复现——改用更矮窗口重跑');

  const r1 = await ev(`(() => {
    const s = document.getElementById('side');
    s.scrollTop = 999999;
    const before = s.scrollTop;
    const links = [...s.querySelectorAll('a')];
    const last = links[links.length - 1];
    const target = { href: last.getAttribute('href'), text: last.textContent.trim() };
    last.click();
    return { before, target };
  })()`);
  console.log('点击前 scrollTop=', r1.before, ' 点击目标=', JSON.stringify(r1.target));
  await sleep(3000);   // 等 hashchange + render 完整跑完
  const r2 = await ev(`(() => {
    const s = document.getElementById('side');
    const on = s.querySelector('a.on');
    return { after: s.scrollTop, hash: location.hash, activeText: on ? on.textContent.trim() : '(无)' };
  })()`);
  console.log('点击后 scrollTop=', r2.after, ' hash=', r2.hash, ' 高亮=', r2.activeText);
  const kept = Math.abs(r2.after - r1.before) <= 2;
  const correct = r2.hash.replace(/\/$/, '') === r1.target.href.replace(/\/$/, '');
  console.log(kept ? 'PASS 滚动位置保持' : 'FAIL 滚动位置丢了（跳顶）', '|', correct ? 'PASS 路由正确' : 'FAIL 路由不符');
  if (!kept || !correct) process.exitCode = 1;
  await shot(path.join(OUT, 'sidebar-after-click-dark.png'));

  /* ---- 用例②：滚动条外观 —— 长页面（深/浅各一张） ---- */
  // mock 不是正经 DSH，启动会弹「连接 DSH 主机」——点「暂后」关掉，别挡截图
  const dismiss = () => ev(`(() => { const b = document.getElementById('dsh-cancel'); if (b) b.click(); return 1; })()`);
  await dismiss();
  await sleep(500);
  await send('Page.navigate', { url: BASE + '/#/knowledge' });
  await sleep(5000);
  await forceRender();
  await dismiss();
  const long1 = await ev(`(() => {
    const c = document.getElementById('content');
    return { scrollH: c.scrollHeight, clientH: c.clientHeight };
  })()`);
  console.log('knowledge 内容区可滚动:', JSON.stringify(long1));
  // 截图前把文档主题钉住（render 重绘会拉回偏好，所以每次截图前各钉一次）
  const pin = t => ev(`document.documentElement.setAttribute('data-theme','${t}'); document.documentElement.style.colorScheme='${t}'; 1`);
  for (const theme of ['dark', 'light']) {
    await pin(theme);
    await ev(`document.getElementById('content').scrollTop = 300; 1`);
    await sleep(600);
    await shot(path.join(OUT, 'scrollbar-' + theme + '.png'));
  }
  console.log('截图目录:', OUT);
  console.log('DONE');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
