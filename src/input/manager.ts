import type { PlayerIntent } from '../core/types.ts';
import { Action, type ActionName } from './actions.ts';
import { applyDeadzone } from './buffer.ts';
import {
  KEYBOARD_P1, KEYBOARD_P2, GAMEPAD_BUTTONS, GAMEPAD_MENU, ACTION_BY_NAME,
  type KeyboardBinding,
} from './bindings.ts';

export type DeviceKind = 'KEYBOARD_1' | 'KEYBOARD_2' | 'GAMEPAD';

export interface SeatDevice {
  kind: DeviceKind;
  /** Gamepad index when kind === 'GAMEPAD'. */
  padIndex: number;
  connected: boolean;
}

const DEADZONE = 0.22;

/**
 * `navigator.getGamepads()` THROWS a SecurityError when the gamepad feature is disabled by a
 * permissions policy — which is what an embedded page normally gets. Testing that the method
 * exists is not enough; the throw happens on the CALL. Uncaught, it killed boot inside an
 * artifact frame, because the input manager is constructed before the first frame is drawn.
 *
 * One failure is enough to stop asking: this runs every frame, and an exception per frame is
 * both slow and unreadable in a console.
 */
let gamepadsDenied = false;

function safeGetGamepads(): ReadonlyArray<Gamepad | null> {
  if (gamepadsDenied) return EMPTY_PADS;
  try {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) { gamepadsDenied = true; return EMPTY_PADS; }
    return navigator.getGamepads();
  } catch {
    gamepadsDenied = true;
    return EMPTY_PADS;
  }
}

const EMPTY_PADS: ReadonlyArray<Gamepad | null> = [];

/** True when this page is not allowed to see controllers at all. */
export function gamepadsBlocked(): boolean { return gamepadsDenied; }

function blank(): PlayerIntent { return { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 }; }

/**
 * Polls keyboard + gamepads once per frame and produces one PlayerIntent per seat.
 * Sim never sees a key code. Rebinding is just a different KeyboardBinding.
 */
export class InputManager {
  private keys = new Set<string>();
  private bindings: [KeyboardBinding, KeyboardBinding] = [{ ...KEYBOARD_P1 }, { ...KEYBOARD_P2 }];
  private seats: SeatDevice[] = [
    { kind: 'KEYBOARD_1', padIndex: -1, connected: true },
    { kind: 'GAMEPAD', padIndex: 0, connected: false },
    { kind: 'GAMEPAD', padIndex: 1, connected: false },
    { kind: 'GAMEPAD', padIndex: 2, connected: false },
  ];
  private intents: PlayerIntent[] = [blank(), blank(), blank(), blank()];
  private prevHeld = [0, 0, 0, 0];
  /** Edge-triggered menu actions, drained by UI each frame. */
  private menuEdges = [0, 0, 0, 0];
  private prevMenuHeld = [0, 0, 0, 0];
  private disposers: Array<() => void> = [];
  /** Anything at all pressed this frame (used to unlock audio). */
  anyActivity = false;
  /** Keys that saw a keydown since the last poll, whether or not they are still down. */
  private tapped = new Set<string>();
  onGamepadChange: ((pads: number[]) => void) | null = null;

  attach(target: Window = window): void {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      // Latch it as well. A key that is pressed AND released between two polls never appears in
      // `keys` when a poll finally runs, so without this a quick tap simply does not exist —
      // and the slower the frame, the more often that happens. It is the kind of bug that
      // reads as "the game ignored me", and it gets worse exactly when the machine is busy.
      this.tapped.add(e.code);
      this.anyActivity = true;
    };
    const up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
    const blur = () => { this.keys.clear(); this.tapped.clear(); };
    const padConnect = () => { this.refreshPads(); };
    target.addEventListener('keydown', down as EventListener);
    target.addEventListener('keyup', up as EventListener);
    target.addEventListener('blur', blur);
    target.addEventListener('gamepadconnected', padConnect);
    target.addEventListener('gamepaddisconnected', padConnect);
    this.disposers.push(() => {
      target.removeEventListener('keydown', down as EventListener);
      target.removeEventListener('keyup', up as EventListener);
      target.removeEventListener('blur', blur);
      target.removeEventListener('gamepadconnected', padConnect);
      target.removeEventListener('gamepaddisconnected', padConnect);
    });
    this.refreshPads();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.keys.clear();
    this.tapped.clear();
  }

  setBinding(seat: 0 | 1, b: KeyboardBinding): void { this.bindings[seat] = { ...b }; }
  getBinding(seat: 0 | 1): KeyboardBinding { return { ...this.bindings[seat] }; }

  setSeatDevice(seat: number, dev: SeatDevice): void { this.seats[seat] = dev; }
  getSeatDevice(seat: number): SeatDevice { return this.seats[seat]; }

  connectedPads(): number[] {
    const out: number[] = [];
    const pads = safeGetGamepads();
    for (let i = 0; i < pads.length; i++) if (pads[i]) out.push(i);
    return out;
  }

  refreshPads(): void {
    const pads = this.connectedPads();
    for (const s of this.seats) if (s.kind === 'GAMEPAD') s.connected = pads.includes(s.padIndex);
    if (this.onGamepadChange) this.onGamepadChange(pads);
  }

  /** Auto-assign: seat 0 keyboard, seats 1..3 to connected pads in order. */
  autoAssign(): void {
    const pads = this.connectedPads();
    this.seats[0] = pads.length > 0
      ? { kind: 'GAMEPAD', padIndex: pads[0], connected: true }
      : { kind: 'KEYBOARD_1', padIndex: -1, connected: true };
    for (let i = 1; i < 4; i++) {
      const p = pads[i];
      this.seats[i] = p !== undefined
        ? { kind: 'GAMEPAD', padIndex: p, connected: true }
        : { kind: i === 1 ? 'KEYBOARD_2' : 'GAMEPAD', padIndex: -1, connected: false };
    }
  }

  poll(): void {
    const pads = safeGetGamepads();
    for (let seat = 0; seat < 4; seat++) {
      const dev = this.seats[seat];
      const it = this.intents[seat];
      const prev = this.prevHeld[seat];
      let held = 0; let mx = 0; let mz = 0; let menuHeld = 0;

      if (dev.kind === 'KEYBOARD_1' || dev.kind === 'KEYBOARD_2') {
        const b = this.bindings[dev.kind === 'KEYBOARD_1' ? 0 : 1];
        for (const code of this.keys) {
          const name = b[code] as ActionName | undefined;
          if (!name) continue;
          held |= ACTION_BY_NAME[name];
        }
        // A tap that began and ended inside this frame counts as held for exactly this frame,
        // so it produces one press edge now and one release edge next poll.
        for (const code of this.tapped) {
          const name = b[code] as ActionName | undefined;
          if (!name) continue;
          held |= ACTION_BY_NAME[name];
        }
        if (held & Action.UP) mz += 1;
        if (held & Action.DOWN) mz -= 1;
        if (held & Action.LEFT) mx -= 1;
        if (held & Action.RIGHT) mx += 1;
        menuHeld = held & (Action.UP | Action.DOWN | Action.LEFT | Action.RIGHT | Action.ACTION | Action.BACK | Action.PAUSE | Action.PAGE);
      } else if (dev.padIndex >= 0) {
        const pad = pads[dev.padIndex];
        if (pad) {
          dev.connected = true;
          // Radial, not per-axis: thresholding each axis separately carves a square hole out of
          // a round stick, so the same physical deflection produced a different speed on the
          // diagonals than on the cardinals.
          const ax0 = pad.axes[0] ?? 0, ax1 = pad.axes[1] ?? 0;
          const st = applyDeadzone(ax0, ax1);
          mx = st.x; mz = -st.y;
          for (let bi = 0; bi < pad.buttons.length; bi++) {
            const btn = pad.buttons[bi];
            if (!btn || !(btn.pressed || btn.value > 0.4)) continue;
            const name = GAMEPAD_BUTTONS[bi];
            if (name) held |= ACTION_BY_NAME[name];
            const menuName = GAMEPAD_MENU[bi];
            if (menuName) menuHeld |= ACTION_BY_NAME[menuName];
          }
          // Dpad also drives menus/movement when the stick is idle.
          if (mx === 0 && (held & Action.TARGET_L)) mx = -1;
          if (mx === 0 && (held & Action.TARGET_R)) mx = 1;
          if (mz === 0 && (held & Action.TARGET_M)) mz = 1;
          if (mz === 0 && (held & Action.DOWN)) mz = -1;
          if (Math.abs(ax1) > 0.6) menuHeld |= ax1 < 0 ? Action.UP : Action.DOWN;
          if (Math.abs(ax0) > 0.6) menuHeld |= ax0 < 0 ? Action.LEFT : Action.RIGHT;
          if (held || Math.abs(mx) > 0 || Math.abs(mz) > 0) this.anyActivity = true;
        } else {
          dev.connected = false;
        }
      }

      const mag = Math.hypot(mx, mz);
      if (mag > 1) { mx /= mag; mz /= mag; }
      it.moveX = mx; it.moveZ = mz;
      it.held = held;
      it.pressed = held & ~prev;
      it.released = prev & ~held;
      this.prevHeld[seat] = held;
      this.menuEdges[seat] = menuHeld & ~this.prevMenuHeld[seat];
      this.prevMenuHeld[seat] = menuHeld;
      if (held) this.anyActivity = true;
    }
    this.tapped.clear();
  }

  intentFor(seat: number): PlayerIntent | null {
    const dev = this.seats[seat];
    if (!dev) return null;
    if (dev.kind === 'GAMEPAD' && !dev.connected) return null;
    return this.intents[seat];
  }

  /** Edge-triggered menu input for any seat (menus accept all devices). */
  menuPressed(action: number): boolean {
    for (let i = 0; i < 4; i++) if (this.menuEdges[i] & action) return true;
    return false;
  }
  menuPressedBySeat(seat: number, action: number): boolean {
    return (this.menuEdges[seat] & action) !== 0;
  }
  clearEdges(): void { for (let i = 0; i < 4; i++) this.menuEdges[i] = 0; }
}

export { Action };
