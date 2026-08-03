import { Action, type ActionName } from './actions.ts';

export interface KeyboardBinding { [code: string]: ActionName }

/** Player 1: left hand WASD + Shift, right hand UIO (pass targets) / JKL (moves) + Space. */
export const KEYBOARD_P1: KeyboardBinding = {
  KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT',
  ShiftLeft: 'TURBO',
  Space: 'ACTION',
  KeyJ: 'JUMP', KeyK: 'DIVE', KeyL: 'SPECIAL',
  KeyU: 'TARGET_L', KeyI: 'TARGET_M', KeyO: 'TARGET_R',
  KeyN: 'LOB', KeyQ: 'AUDIBLE', KeyE: 'MOTION',
  Tab: 'PAGE', KeyH: 'HIDE_PLAY',
  Escape: 'PAUSE', Backspace: 'BACK',
};

/** Player 2 on the same keyboard: arrows + numpad. */
export const KEYBOARD_P2: KeyboardBinding = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  ShiftRight: 'TURBO',
  Numpad0: 'ACTION', NumpadEnter: 'ACTION',
  Numpad1: 'JUMP', Numpad2: 'DIVE', Numpad3: 'SPECIAL',
  Numpad4: 'TARGET_L', Numpad5: 'TARGET_M', Numpad6: 'TARGET_R',
  Numpad7: 'LOB', Numpad8: 'AUDIBLE', Numpad9: 'MOTION',
  NumpadAdd: 'PAGE', NumpadSubtract: 'HIDE_PLAY',
};

/** Standard Gamepad API button index → action. */
export const GAMEPAD_BUTTONS: Record<number, ActionName> = {
  0: 'ACTION',      // A / cross
  1: 'JUMP',        // B / circle
  2: 'DIVE',        // X / square
  3: 'SPECIAL',     // Y / triangle
  4: 'LOB',         // LB
  5: 'TURBO',       // RB
  6: 'AUDIBLE',     // LT
  7: 'TURBO',       // RT
  8: 'HIDE_PLAY',   // back/select
  9: 'PAUSE',       // start
  10: 'MOTION',     // L3
  11: 'PAGE',       // R3
  12: 'TARGET_M',   // dpad up
  13: 'DOWN',       // dpad down
  14: 'TARGET_L',   // dpad left
  15: 'TARGET_R',   // dpad right
};

/** Menu navigation reads these regardless of gameplay bindings. */
export const GAMEPAD_MENU: Record<number, ActionName> = {
  0: 'ACTION', 1: 'BACK', 9: 'PAUSE',
  12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT',
  4: 'PAGE', 5: 'PAGE',
};

export const ACTION_BY_NAME: Record<ActionName, number> = Action as unknown as Record<ActionName, number>;

export function cloneBinding(b: KeyboardBinding): KeyboardBinding { return { ...b }; }
