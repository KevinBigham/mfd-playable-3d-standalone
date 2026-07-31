import './ui/styles.css';
import { Game } from './app/Game.ts';
import {
  TitleScreen, MainMenuScreen, QuickPlayScreen, PauseScreen, SettingsScreen,
  ControlsScreen, FinalScreen, CreditsScreen,
} from './ui/screens/menus.ts';
import { MatchScreen } from './ui/screens/matchScreen.ts';
import { TournamentScreen } from './ui/screens/tournament.ts';
import { SeasonScreen } from './ui/screens/season.ts';
import { TEAMS, getStadium } from './data/index.ts';

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;
  const bootEl = document.getElementById('boot');

  const game = new Game(canvas, uiRoot);

  // Attract-mode environment behind the menus.
  const home = TEAMS[0];
  const away = TEAMS[1];
  game.renderer.loadMatch(home, away, getStadium(home.stadium), {
    weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1,
  });

  for (const s of [
    new TitleScreen(game), new MainMenuScreen(game), new QuickPlayScreen(game),
    new MatchScreen(game), new PauseScreen(game), new SettingsScreen(game),
    new ControlsScreen(game), new FinalScreen(game), new CreditsScreen(),
    new TournamentScreen(game), new SeasonScreen(game),
  ]) game.register(s);

  game.go('title');
  game.start();

  if (bootEl) {
    bootEl.classList.add('hide');
    setTimeout(() => bootEl.remove(), 500);
  }

  (window as unknown as { GO: Game }).GO = game;
  window.addEventListener('error', (e) => console.error('[GO]', e.message));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
