/** Shared Playwright harness: build once, serve, drive the real game in Chromium. */
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page, type ConsoleMessage } from 'playwright';

export interface Harness {
  browser: Browser;
  page: Page;
  errors: string[];
  warnings: string[];
  close(): Promise<void>;
}

function waitForPort(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url, { method: 'GET' });
        if (r.ok || r.status === 404) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error(`server did not start: ${url}`));
      setTimeout(tick, 350);
    };
    tick();
  });
}

let server: ChildProcess | null = null;

export async function startServer(port = 4173): Promise<string> {
  const url = `http://127.0.0.1:${port}/`;
  server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  server.stdout?.on('data', () => { /* quiet */ });
  server.stderr?.on('data', (d: Buffer) => {
    const t = d.toString();
    if (t.includes('error')) process.stderr.write(`[vite] ${t}`);
  });
  await waitForPort(url);
  return url;
}

export function stopServer(): void {
  if (server) { server.kill('SIGTERM'); server = null; }
}

export async function launch(url: string, opts: { width?: number; height?: number } = {}): Promise<Harness> {
  const browser = await chromium.launch({
    args: [
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
      '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
      '--enable-webgl', '--use-angle=swiftshader',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 720 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    else if (m.type() === 'warning') warnings.push(t);
  });
  page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => (window as unknown as { GO?: unknown }).GO !== undefined, { timeout: 60000 });
  return {
    browser, page, errors, warnings,
    async close() { await browser.close(); },
  };
}

/** Press a game key for one frame. */
export async function tap(page: Page, code: string, holdMs = 90): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(code);
  await page.waitForTimeout(90);
}

export async function screenshot(page: Page, path: string): Promise<void> {
  await page.screenshot({ path, type: 'png' });
}

/** Drive the game from the title screen into a live human-vs-CPU match. */
export async function enterQuickMatch(page: Page, opts: { quarterSeconds?: number } = {}): Promise<void> {
  await page.evaluate((qs) => {
    const g = (window as unknown as { GO: { reset(n: string, p?: unknown): void; settings: Record<string, unknown> } }).GO;
    g.settings.quarterSeconds = qs ?? 60;
    g.reset('match', {
      config: {
        seed: 20260731,
        quarterSeconds: qs ?? 60,
        difficulty: 'PRO',
        seats: [
          { side: 0, active: true }, { side: 1, active: false },
          { side: 0, active: false }, { side: 1, active: false },
        ],
        mode: 'QUICKPLAY',
      },
      returnScreen: 'mainMenu',
    });
  }, opts.quarterSeconds);
  await page.waitForTimeout(1200);
}

export interface GameProbe {
  phase: string;
  quarter: number;
  clock: number;
  home: number;
  away: number;
  down: number;
  losZ: number;
  ballKind: string;
  screen: string;
  calls: number;
  triangles: number;
}

export async function probe(page: Page): Promise<GameProbe> {
  return page.evaluate(() => {
    const g = (window as unknown as { GO: any }).GO;
    const m = g.match;
    const info = g.renderer.info();
    return {
      phase: m ? m.state.phase : 'NONE',
      quarter: m ? m.state.quarter : 0,
      clock: m ? m.state.clockTicks : 0,
      home: m ? m.state.teams[0].score : 0,
      away: m ? m.state.teams[1].score : 0,
      down: m ? m.state.down : 0,
      losZ: m ? m.state.losZ : 0,
      ballKind: m ? m.world.ball.state.kind : 'none',
      screen: g.currentScreen,
      calls: info.calls,
      triangles: info.triangles,
    };
  });
}
