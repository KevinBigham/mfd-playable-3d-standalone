import './ui/styles.css';
import { Game } from './app/Game.ts';
import {
  TitleScreen, MainMenuScreen, QuickPlayScreen, PauseScreen, SettingsScreen,
  ControlsScreen, FinalScreen, CreditsScreen,
} from './ui/screens/menus.ts';
import { MatchScreen } from './ui/screens/matchScreen.ts';
import { MobileHomeScreen } from './ui/screens/mobileHome.ts';
import { DriveResultsScreen } from './ui/screens/driveResults.ts';
import { ChallengeEntryScreen } from './ui/screens/challengeEntry.ts';
import { DrillsScreen } from './ui/screens/drillsScreen.ts';
import { TournamentScreen } from './ui/screens/tournament.ts';
import { SeasonScreen } from './ui/screens/season.ts';
import { PracticeScreen } from './ui/screens/practice.ts';
import { PlayEditorScreen } from './ui/screens/playEditor.ts';
import { TEAMS, getStadium } from './data/index.ts';
import { flag } from './app/featureFlags.ts';
import { PersistenceV2 } from './persistence/persistenceV2.ts';
import { attachV2Sink, primeCache } from './persistence/save.ts';

async function bootPersistence(): Promise<void> {
  if (!flag('persistenceV2')) return;
  try {
    const p2 = new PersistenceV2();
    await p2.init();
    const r = await p2.load();
    if (r.payload) primeCache(r.payload);
    if (r.recovered) console.warn('[save] newest revision was corrupt; restored last known good');
    // Settled writes flow through as checksummed revisions; fire-and-forget by design.
    attachV2Sink((payload) => { void p2.write(payload); });
  } catch { /* v2 is an upgrade, never a boot blocker */ }
}

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;
  const bootEl = document.getElementById('boot');

  const game = new Game(canvas, uiRoot);

  for (const s of [
    new TitleScreen(game), new MainMenuScreen(game), new QuickPlayScreen(game),
    new MatchScreen(game), new PauseScreen(game), new SettingsScreen(game),
    new ControlsScreen(game), new FinalScreen(game), new CreditsScreen(),
    new TournamentScreen(game), new SeasonScreen(game), new PracticeScreen(game),
    new PlayEditorScreen(game),
    new MobileHomeScreen(game), new DriveResultsScreen(game), new ChallengeEntryScreen(game),
    new DrillsScreen(game),
  ]) game.register(s);

  game.go('title');
  game.start();

  if (bootEl) {
    bootEl.classList.add('hide');
    setTimeout(() => bootEl.remove(), 500);
  }

  /**
   * The attract-mode stadium, built AFTER the title exists.
   *
   * It used to run before the screens were registered, and building it is one long synchronous
   * block — mostly shader compilation, measured at about a second on a fast GPU and twelve on a
   * slow one. Nothing painted and no listener existed for the whole of it, so a phone player who
   * tapped during the freeze had the tap silently dropped and had to work out that they should
   * tap again.
   *
   * Moving it here does not make the block shorter. It makes it happen behind a title screen
   * that is already listening, so the tap is queued by the browser and answered the moment the
   * thread comes back. `requestIdleCallback` gives the first frame a chance to present first,
   * with a timeout so a busy machine still gets its stadium promptly.
   */
  const home = TEAMS[0];
  const away = TEAMS[1];
  const attract = (): void => {
    game.renderer.loadMatch(home, away, getStadium(home.stadium), {
      weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1,
    });
  };
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(attract, { timeout: 1500 });
  else setTimeout(attract, 32);

  (window as unknown as { GO: Game }).GO = game;
  window.addEventListener('error', (e) => console.error('[GO]', e.message));
}

// Hosted PWA path only: the one-file artifact stays portable with no service-worker
// assumptions, and file:// cannot register one anyway.
function registerServiceWorker(): void {
  try {
    const isArtifact = !!(window as unknown as { __GO_ARTIFACT__?: boolean }).__GO_ARTIFACT__;
    if (isArtifact || location.protocol === 'file:' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is optional */ });
  } catch { /* never a boot blocker */ }
}

const start = (): void => { registerServiceWorker(); void bootPersistence().then(boot); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
