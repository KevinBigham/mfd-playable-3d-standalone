#!/usr/bin/env tsx
/**
 * Fold the whole game into ONE self-contained HTML file. `npm run artifact`
 *
 * The output has no network dependencies of any kind: no module imports, no stylesheet link, no
 * fonts, no images. Open it from a disk, a chat attachment or a sandboxed iframe and it plays.
 *
 * Three things have to be handled that a normal build does not care about:
 *
 *  1. **One script.** Two inlined `<script type="module">` blocks cannot resolve an import
 *     specifier between them, so the artifact build emits a single chunk (see
 *     `vite.artifact.config.ts`) and it goes in whole.
 *  2. **Focus.** A game inside an iframe receives no keystrokes until something in that document
 *     has focus, and nothing takes focus on its own. A prelude claims it on load and on any
 *     pointer press, so the first thing a player does — click — is also the thing that makes the
 *     keyboard work.
 *  3. **Storage.** Sandboxed frames can throw on `localStorage` access. The save layer already
 *     falls back to memory (see `storageKind()`), so nothing here has to fake an API; the prelude
 *     only reports which backend won, so the page can say so.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'dist-artifact';
const OUT_FILE = join(OUT_DIR, 'gridiron-overdrive.html');

/**
 * The same bytes, second home. `docs/index.html` is what GitHub Pages serves, so this is the
 * playable link. It is written by the build rather than copied by hand for one reason: a Pages
 * site that silently serves last week's game is worse than no Pages site, and a copy step a
 * human has to remember will eventually be forgotten.
 */
const PAGES_FILE = join('docs', 'index.html');

/** Injected before the game. Everything here is about surviving an iframe. */
const PRELUDE = `
(function () {
  // Keystrokes only reach a framed document once something in it has focus, and nothing takes
  // focus by itself. Claim it on load and on every pointer press.
  var grab = function () { try { window.focus(); } catch (e) {} };
  window.addEventListener('load', grab);
  window.addEventListener('pointerdown', grab, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) grab(); });
  grab();

  // Arrow keys and space scroll the page by default, which fights the game for the same inputs.
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'Tab' || e.code.indexOf('Arrow') === 0) e.preventDefault();
  }, { passive: false });

  // A frame with no storage access throws on the property itself, so the probe has to be a real
  // write. The game handles the answer; this only decides what the hint says.
  // Tells the game it is embedded, which starts it one graphics tier down.
  window.__GO_ARTIFACT__ = true;

  var persists = false;
  try { localStorage.setItem('go.probe', '1'); localStorage.removeItem('go.probe'); persists = true; } catch (e) {}
  window.__GO_PERSISTS__ = persists;

  window.addEventListener('DOMContentLoaded', function () {
    var hint = document.getElementById('artifact-hint');
    if (!hint) return;
    // A finger cannot press W. Telling a phone to use WASD is worse than telling it nothing,
    // and pretending the game is playable by touch would be worse still — the title takes a tap
    // now, but there is no touch input source behind it yet. Say so.
    var coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (coarse) {
      var line = hint.querySelector('span');
      if (line) line.innerHTML = 'tap to browse the menus · <b>gameplay needs a keyboard '
        + 'or controller</b> — touch controls are not in yet';
    }
    if (!persists) {
      var note = document.createElement('span');
      note.className = 'hint-note';
      note.textContent = 'progress is kept for this session only';
      hint.appendChild(note);
    }
    var hide = function () { hint.classList.add('gone'); };
    window.addEventListener('pointerdown', hide, { once: true });
    window.addEventListener('keydown', hide, { once: true });
    setTimeout(hide, 14000);
  });
})();
`;

/** Styling for the one piece of chrome the artifact adds. */
const HINT_CSS = `
#artifact-hint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:40;
  display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;
  padding:8px 16px;border-radius:999px;background:rgba(10,13,20,.82);
  border:1px solid rgba(255,210,63,.34);backdrop-filter:blur(6px);
  font:600 12px/1 system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;
  color:#ffd23f;pointer-events:none;transition:opacity .5s ease;text-align:center}
#artifact-hint.gone{opacity:0}
#artifact-hint b{color:#fff;font-weight:700}
#artifact-hint .hint-note{color:#9fb0c8;letter-spacing:.05em;text-transform:none;font-weight:500}
`;

const HINT_HTML = `
    <div id="artifact-hint">
      <span>click once, then <b>W A S D</b> move · <b>SPACE</b> pass/select · <b>SHIFT</b> turbo ·
      <b>J</b> jump · <b>K</b> dive · <b>L</b> spin · <b>ESC</b> back</span>
    </div>`;

function main(): void {
  rmSync(OUT_DIR, { recursive: true, force: true });
  console.log('building the single-chunk bundle…');
  execFileSync('npx', ['vite', 'build', '--config', 'vite.artifact.config.ts', '--logLevel', 'error'],
    { stdio: 'inherit' });

  const htmlPath = join(OUT_DIR, 'index.html');
  if (!existsSync(htmlPath)) throw new Error(`no ${htmlPath}; did the build fail?`);
  let html = readFileSync(htmlPath, 'utf8');

  // Pull in the one script and the one stylesheet, then delete their tags.
  const scriptRef = /<script[^>]*src="([^"]+)"[^>]*><\/script>/;
  const cssRef = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/;

  const sm = html.match(scriptRef);
  if (!sm) throw new Error('no module script found in the built html');
  const js = readFileSync(join(OUT_DIR, sm[1].replace(/^\.?\//, '')), 'utf8');

  let css = '';
  const cm = html.match(cssRef);
  if (cm) {
    css = readFileSync(join(OUT_DIR, cm[1].replace(/^\.?\//, '')), 'utf8');
    html = html.replace(cssRef, '');
  }

  // `</script>` anywhere inside the payload would close the tag early.
  const safeJs = js.replace(/<\/script/gi, '<\\/script');

  html = html
    .replace(scriptRef, '')
    .replace('</head>', `  <style>${css}\n${HINT_CSS}</style>\n  <script>${PRELUDE}</script>\n</head>`)
    .replace('</body>', `${HINT_HTML}\n    <script>${safeJs}</script>\n  </body>`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, html, 'utf8');

  mkdirSync('docs', { recursive: true });
  writeFileSync(PAGES_FILE, html, 'utf8');
  // Pages runs Jekyll unless told not to, and Jekyll drops anything starting with an underscore.
  writeFileSync(join('docs', '.nojekyll'), '', 'utf8');

  const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
  console.log(`\n${OUT_FILE}`);
  console.log(`  javascript   ${kb(js.length)}`);
  console.log(`  css          ${kb(css.length)}`);
  console.log(`  total        ${kb(html.length)}`);
  if (/src=["']\.?\//.test(html) || /href=["']\.?\/[^"']*\.(js|css)/.test(html)) {
    throw new Error('the artifact still references an external file');
  }
  console.log('  self-contained: no external script, stylesheet, font or image reference.');
  console.log(`  ${PAGES_FILE}   same bytes — this is what the Pages link serves.`);
}

main();
