import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 400)));
  p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 600)));
  await p.goto('http://127.0.0.1:4180/', { waitUntil: 'load' });
  await p.waitForTimeout(9000);
  console.log('GO?', await p.evaluate(() => typeof (window as any).GO));
  await b.close();
})();
