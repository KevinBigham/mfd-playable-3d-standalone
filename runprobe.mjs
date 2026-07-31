import { chromium } from 'playwright';
const b = await chromium.launch({
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox']
});
const p = await b.newPage();
const logs = [];
p.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${e.stack||''}`));
await p.goto('http://localhost:5178/src/render/env/__probe.html', { waitUntil: 'load' });
try { await p.waitForFunction(() => document.title === 'PROBE-DONE', { timeout: 180000 }); }
catch(e){ console.log('TIMEOUT waiting for probe'); }
const res = await p.evaluate(() => window.__probe || null);
console.log('=== CONSOLE ===');
console.log(logs.slice(0,80).join('\n'));
console.log('=== RESULT ===');
console.log(JSON.stringify(res, null, 1));
await b.close();
