/* DSH Console — 工具脚本 mock-dsh.mjs
 * Copyright 2026 liwei (易智瑞西安) <liwei@geoscene.cn>
 * SPDX-License-Identifier: Apache-2.0
 *
 * 依据 Apache License 2.0 授权使用与分发；许可证全文见项目根目录 LICENSE，摘要见 NOTICE。
 */
/* 最小 mock DSH 后端 —— 给「只想验前端、拿不到真 DSH」的场景兜底。
 *
 * 为什么需要：控制台是 DSH 的前端 + 反向代理，boot 走不通就只剩一个空壳页面
 *   （侧栏/内容区都是空的），任何纯前端的回归（如 tools/verify-sidebar.mjs）都跑不起来。
 *   而 DSH web 的访问令牌带会话鉴权、过期后必须重开 `dsh web` 取新地址 ——
 *   在做前端改动时为了跑一次回归去打扰真服务不值得，所以给一个「够 boot 用」的假后端。
 *
 * 用法：
 *   终端 A：node tools/mock-dsh.mjs 3095
 *   终端 B：DSH_ORIGIN=http://127.0.0.1:3095 node server.cjs      # PowerShell: $env:DSH_ORIGIN=...
 *   终端 C：node tools/verify-sidebar.mjs
 *
 * 覆盖范围（只够前端 boot，**不是** DSH 模拟器）：
 *   · GET  /            → 200，过控制台启动时的「这地址像不像 DSH」健康检查
 *   · POST /api/<任意>  → { type:'server-response', result:{ ok:true, value } }，信封与真 DSH 一致
 *   · session/list、session/modelCatalog、settings/describe 给最小可渲染的形状，
 *     其余端点一律 value:{}。
 * 已知边界：WS /api/remote.mux 不握手 → 实时流降级（前端会自己重连，不影响静态渲染）；
 *   页面里依赖真实数据的加载器会显示空态/加载态。**因此页面级断言不适用于本 mock**：
 *   tools/render-all.mjs 对它会报几处假红（llm 列表 .map、主题 revision 往返等数据形状问题）。
 */
import http from 'http';

const PORT = Number(process.argv[2] || 3095);
const VALUE = {
  'session/list': { items: [{ sessionId: 'mock-1', title: 'Mock 会话一', origin: 'local', updatedAt: new Date().toISOString() }] },
  'session/modelCatalog': { default: { provider: 'mock', model: 'mock-model', reasoningEffort: 'medium' }, groups: [], routableProviders: ['mock'], failures: [] },
  'settings/describe': {},
};

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let rpcId = '', method = req.url.slice(5);
      try { const j = JSON.parse(body); rpcId = j.rpcId || ''; method = j.method || method; } catch {}
      const value = VALUE[method] !== undefined ? VALUE[method] : {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }));
    });
    return;
  }
  if (req.method === 'GET') {          // 控制台启动时的健康检查：GET / 要 200 且像 DSH
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: 'dsh', mock: true }));
    return;
  }
  res.writeHead(404).end('mock: not found');
}).listen(PORT, '127.0.0.1', () => console.log('mock DSH on http://127.0.0.1:' + PORT));
