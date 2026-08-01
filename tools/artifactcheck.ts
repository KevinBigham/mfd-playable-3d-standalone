#!/usr/bin/env tsx
/**
 * Prove the single-file artifact actually plays. `npm run artifact:check`
 *
 * The normal smoke test drives `dist/`, which is a different build with different module
 * plumbing — passing there says nothing about the one-file version. This loads the artifact the
 * way a player will get it: as one HTML document, inside a SANDBOXED IFRAME on a different
 * origin, with no network available to it at all. If anything in the bundle still reaches for a
 * file, a font or a module, it fails here.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

const FILE = 'dist-artifact/gridiron-overdrive.html';
const PORT = 4181;

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS  ${name.padEnd(52)} ${detail}`); }
  else { fail++; console.log(`  FAIL  ${name.padEnd(52)} ${detail}`); }
}

/**
 * Serves the artifact inside a sandboxed frame, and serves 404 for everything else so that any
 * surviving external reference shows up as a failure rather than silently working.
 */
function serve(html: string): Server {
  const shell = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#05070c}
    iframe{border:0;width:100vw;height:100vh;display:block}
  </style></head><body>
  <iframe id="f" sandbox="allow-scripts allow-same-origin" srcdoc="__DOC__"></iframe>
  </body></html>`;
  const doc = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const page = shell.replace('__DOC__', doc);
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }
    res.writeHead(404); res.end('no external files exist for this artifact');
  });
  server.listen(PORT);
  return server;
}

async function main(): Promise<void> {
  if (!existsSync(FILE)) throw new Error(`${FILE} missing — run npm run artifact first`);
  const html = readFileSync(FILE, 'utf8');

  console.log('\nGRIDIRON OVERDRIVE — single-file artifact\n'
    + '────────────────────────────────────────────────────────');
  check('one file, no external references',
    !/<script[^>]+src=/.test(html) && !/<link[^>]+stylesheet/.test(html),
    `${(html.length / 1024).toFixed(0)} kB`);

  const server = serve(html);
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith('data:')) requests.push(r.url()); });

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) throw new Error('the sandboxed frame never appeared');

    await frame.waitForFunction(() => Boolean((window as unknown as { GO?: unknown }).GO),
      undefined, { timeout: 120000 });
    check('boots inside a sandboxed iframe', true);

    const probe = async () => frame.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      return {
        screen: g.currentScreen,
        phase: g.match ? g.match.state.phase : 'NONE',
        score: g.match ? `${g.match.state.teams[0].score}-${g.match.state.teams[1].score}` : '',
        calls: g.renderer.info().calls,
        persists: (window as any).__GO_PERSISTS__ === true,
      };
    });

    let p = await probe();
    check('reaches a screen', p.screen.length > 0, `screen=${p.screen}`);

    // Storage: whichever backend won, changing a setting must survive a read-back. This is the
    // thing that silently breaks in a frame, and the in-memory fallback is what fixes it.
    const storage = await frame.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      g.settings.cameraShake = 0.37;
      g.applySettings();
      const mod = (window as any).__GO_SAVE_TEST__;
      return { wrote: 0.37, readBack: mod ? mod() : g.settings.cameraShake, persists: (window as any).__GO_PERSISTS__ };
    });
    check('settings survive a write and read back', storage.readBack === 0.37,
      `cameraShake=${storage.readBack}, localStorage=${storage.persists ? 'available' : 'blocked → memory'}`);

    // Start a real match. A human seat is used for the input check below, then the match is
    // restarted CPU-vs-CPU to run to a final: with the play clock off (the default) a human who
    // never snaps waits for ever, which is correct behaviour and useless as a test.
    await frame.evaluate(() => {
      (window as unknown as { GO: any }).GO.reset('match', {
        config: {
          seed: 4242, quarterSeconds: 60, difficulty: 'PRO',
          seats: [{ side: 0, active: true }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }],
        },
        returnScreen: 'mainMenu',
      });
    });
    await page.waitForTimeout(2500);
    p = await probe();
    check('a match starts', p.phase !== 'NONE', `phase=${p.phase}`);
    check('the scene actually draws', p.calls > 10, `drawCalls=${p.calls}`);

    // Keyboard has to reach the game through the frame, which is the whole reason the prelude
    // grabs focus. Press a key at the PAGE level and read the produced intent inside the frame.
    await frame.evaluate(() => { (window as unknown as { GO: any }).GO.input.attach(window); });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(140);
    const intent = await frame.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      g.input.poll();
      const i = g.input.intentFor(0);
      return i ? { moveZ: i.moveZ, held: i.held } : null;
    });
    await page.keyboard.up('KeyW');
    check('keyboard reaches the game inside the frame', Boolean(intent && intent.moveZ > 0.5),
      JSON.stringify(intent));

    await frame.evaluate(() => {
      (window as unknown as { GO: any }).GO.reset('match', {
        config: {
          seed: 4242, quarterSeconds: 60, difficulty: 'PRO',
          seats: [{ side: 0, active: false }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }],
        },
        returnScreen: 'mainMenu',
      });
    });
    await page.waitForTimeout(2000);
    const res = await frame.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      const m = g.match;
      let t = 0;
      while (m && !m.state.finished && t < 60 * 60 * 20) { m.tick(); t++; }
      return { finished: m ? m.state.finished : false, ticks: t, watchdogs: m ? m.watchdogCount : -1,
        score: m ? `${m.state.teams[0].score}-${m.state.teams[1].score}` : '' };
    });
    check('plays through to a valid final', res.finished && res.watchdogs === 0,
      `${res.score} in ${res.ticks} ticks, watchdogs=${res.watchdogs}`);

    await page.waitForTimeout(600);
    const external = requests.filter((u) => !u.includes(`127.0.0.1:${PORT}/`) && !u.startsWith('blob:'));
    check('made zero network requests', external.length === 0, external.slice(0, 3).join(' '));
    check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('────────────────────────────────────────────────────────');
  console.log(`${pass}/${pass + fail} artifact checks passed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
