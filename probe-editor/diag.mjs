import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port = 5199;
const url = `http://127.0.0.1:${port}/probe-editor/index.html`;
const server = spawn('./node_modules/.bin/vite', ['--port', String(port), '--strictPort'], { stdio: ['ignore','pipe','pipe'] });
server.stdout.on('data', d => process.stdout.write('[vite] ' + d));
server.stderr.on('data', d => process.stderr.write('[viteerr] ' + d));
for (let i=0;i<60;i++){ try { const r = await fetch(url); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,300)); }
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage();
page.on('console', m => console.log('[console.' + m.type() + ']', m.text().slice(0,400)));
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,500)));
page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
console.log('GO present?', await page.evaluate(() => typeof window.GO));
await browser.close(); server.kill('SIGTERM');
