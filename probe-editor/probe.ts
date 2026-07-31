import '../src/ui/styles.css';
import { Game } from '../src/app/Game.ts';
import {
  TitleScreen, MainMenuScreen, QuickPlayScreen, PauseScreen, SettingsScreen,
  ControlsScreen, FinalScreen, CreditsScreen,
} from '../src/ui/screens/menus.ts';
import { MatchScreen } from '../src/ui/screens/matchScreen.ts';
import { PracticeScreen } from '../src/ui/screens/practice.ts';
import { PlayEditorScreen } from '../src/ui/screens/playEditor.ts';
import { TEAMS, getStadium } from '../src/data/index.ts';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
const game = new Game(canvas, uiRoot);
const home = TEAMS[0]; const away = TEAMS[1];
game.renderer.loadMatch(home, away, getStadium(home.stadium),
  { weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1 });
for (const s of [
  new TitleScreen(game), new MainMenuScreen(game), new QuickPlayScreen(game),
  new MatchScreen(game), new PauseScreen(game), new SettingsScreen(game),
  new ControlsScreen(game), new FinalScreen(game), new CreditsScreen(),
  new PracticeScreen(game), new PlayEditorScreen(game),
]) game.register(s);
game.go('title');
game.start();
(window as unknown as { GO: Game }).GO = game;
