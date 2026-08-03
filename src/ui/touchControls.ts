import type { Match } from '../rules/match.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { IntentSource, TouchContribution } from '../input/manager.ts';
import { Action } from '../input/actions.ts';
import { el, coarsePointer } from './uiKit.ts';
import { clamp } from '../core/math.ts';

/**
 * Playing this game with two thumbs.
 *
 * The whole layer is one `IntentSource`: it converts gestures into the same action bitmask a
 * keyboard produces and hands it to `InputManager`, which merges it into seat 0. Nothing below
 * `src/ui` learns that a touch screen exists — `playRunner.ts` sees a `PlayerIntent` and cannot
 * tell which device filled it in. That is the entire reason the aim channel was split out first.
 *
 * Three ideas carry the design:
 *
 *  1. **The left thumb is analogue, the right thumb is discrete.** Steering wants a continuous
 *     vector, so it gets a floating stick that appears under wherever the thumb lands. Every
 *     other verb is a decision, so it gets a tap, a swipe or a drag — never a button to hunt for.
 *  2. **Badges live on the receivers, not in a row.** A fixed row of three buttons teaches you
 *     nothing; a badge over the actual player makes the read and the input the same act, and it
 *     is why `projectToScreen` exists. This is the one thing that makes a phone version teach
 *     football rather than hide it.
 *  3. **Placement is a drag, and it is the skill.** Tapping a badge throws it. Dragging off the
 *     badge and releasing throws it *somewhere* — away from the defender, back to the sideline,
 *     up the seam. That is the aim channel, and it is the difference between a game you mash and
 *     a game you get better at.
 */

type Mode = 'OFF' | 'SNAP' | 'QB' | 'CARRY' | 'FREE';

/** Radius of the stick in CSS pixels. Full deflection at the ring, turbo past it. */
const STICK_R = 54;
const TURBO_R = STICK_R * 1.34;
/** A drag this far from the touch-down point is a swipe, not a tap. */
const SWIPE_MIN = 26;
/** Longer than this without a swipe is a hold, not a tap. */
const TAP_MAX_MS = 260;
/** A badge drag shorter than this places nothing — it is a tap that wobbled. */
const PLACE_MIN = 16;
/** Drag distance at which placement saturates. `throwTo` clamps the vector at length 1. */
const PLACE_FULL = 96;

interface Touch {
  id: number;
  role: 'STICK' | 'SURFACE' | 'BADGE';
  x0: number; y0: number;
  x: number; y: number;
  t0: number;
  /** Badge slot 0..2 for BADGE, otherwise -1. */
  slot: number;
  /** A swipe already fired for this pointer; ignore the rest of the drag. */
  spent: boolean;
  moved: number;
}

interface Badge {
  root: HTMLElement;
  num: HTMLElement;
  ring: HTMLElement;
  arrow: HTMLElement;
  visible: boolean;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

function buzz(ms: number): void {
  const nav = navigator as Navigator & { vibrate?: (p: number) => boolean };
  try { nav.vibrate?.(ms); } catch { /* not supported, and not important */ }
}

export class TouchControls implements IntentSource {
  readonly root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private badges: Badge[] = [];
  private snapBtn: HTMLElement;
  private lobBtn: HTMLElement;
  private pauseBtn: HTMLElement;
  private coach: HTMLElement;
  private gate: HTMLElement;
  private gated = false;
  /** Raised while live play is impossible because the phone is upright. */
  onGate: ((blocked: boolean) => void) | null = null;

  private touches = new Map<number, Touch>();
  private mode: Mode = 'OFF';
  private enabled = false;
  /** Armed by the LOB button, spent by the next throw. A thumb cannot hold a modifier. */
  private lobArmed = false;

  /** Actions that must appear held for exactly one poll so an edge is produced. */
  private latch = 0;
  private aimX: number | null = null;
  private aimZ: number | null = null;
  /** Move vector forced for one poll, so a juke has the lateral component the sim requires. */
  private forceMove: { x: number; z: number } | null = null;

  private moveX = 0;
  private moveZ = 0;

  /** Screen-space basis for world +X and +Z at the ball, refreshed every frame. */
  private bx = { x: 1, y: 0 };
  private bz = { x: 0, y: -1 };

  private disposers: Array<() => void> = [];
  onPause: (() => void) | null = null;

  /**
   * Whether this machine should have a touch pad at all.
   *
   * A coarse primary pointer settles it for a phone or a tablet. A laptop with a touchscreen
   * reports a fine pointer and would never qualify, so the first genuine finger on the glass
   * turns it on as well — but a mouse never does, which is the part that matters: putting a SNAP
   * button and three receiver badges on top of a desktop keyboard game would be a regression for
   * every existing player.
   */
  private available = coarsePointer();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'tc-root');
    this.root.style.display = 'none';

    this.stick = el('div', 'tc-stick');
    this.knob = el('div', 'tc-knob');
    this.stick.appendChild(this.knob);

    for (let i = 0; i < 3; i++) {
      const root = el('div', 'tc-badge');
      const ring = el('div', 'tc-badge-ring');
      const num = el('div', 'tc-badge-num', '');
      const arrow = el('div', 'tc-badge-arrow');
      root.append(ring, num, arrow);
      root.dataset.slot = String(i);
      this.badges.push({ root, num, ring, arrow, visible: false });
      this.root.appendChild(root);
    }

    this.snapBtn = el('div', 'tc-snap', 'SNAP');
    this.lobBtn = el('div', 'tc-lob', 'LOB');
    this.pauseBtn = el('div', 'tc-pause', '❚❚');
    this.coach = el('div', 'tc-coach', '');

    this.root.append(this.stick, this.snapBtn, this.lobBtn, this.pauseBtn, this.coach);
    parent.appendChild(this.root);

    // Sits outside the pad's own root: it has to be visible precisely when the pad is not.
    this.gate = el('div');
    this.gate.id = 'rotate-gate';
    const phone = el('div', 'phone');
    this.gate.append(phone, el('div', 'cap', 'TURN IT SIDEWAYS'),
      el('div', 'sub', 'The field is 53 yards wide and the camera looks down its length. '
        + 'There is no way to show that, and put two thumbs somewhere useful, in portrait.'));
    parent.appendChild(this.gate);

    this.attach();
  }

  // ── pointer plumbing ──────────────────────────────────────────────────
  //
  // One listener set on the root rather than per-control. A game surface has to answer "which
  // finger is this and what was it doing" — that is per-pointer state, and once you are keeping
  // it anyway, per-element handlers only add ways for a finger to be double-counted.

  private attach(): void {
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    // Losing the page mid-play must not leave turbo welded on. `pointercancel` covers the browser
    // stealing the gesture (a scroll, a system edge swipe); `visibilitychange` covers a phone
    // call arriving while a thumb is down.
    const blur = () => this.releaseAll();
    // Listened for on the window, in capture, because until the pad is available it is
    // display:none and can never see a pointer of its own.
    const sniff = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        this.available = true;
        window.removeEventListener('pointerdown', sniff, true);
      }
    };
    window.addEventListener('pointerdown', sniff, true);
    this.disposers.push(() => window.removeEventListener('pointerdown', sniff, true));
    this.root.addEventListener('pointerdown', down);
    this.root.addEventListener('pointermove', move);
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
    this.root.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', blur);
    this.disposers.push(() => {
      this.root.removeEventListener('pointerdown', down);
      this.root.removeEventListener('pointermove', move);
      this.root.removeEventListener('pointerup', up);
      this.root.removeEventListener('pointercancel', up);
      this.root.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', blur);
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.releaseAll();
    this.root.remove();
    this.gate.remove();
  }

  private releaseAll(): void {
    this.touches.clear();
    this.moveX = 0; this.moveZ = 0;
    this.stick.classList.remove('on');
    this.knob.style.transform = 'translate(-50%,-50%)';
    for (const b of this.badges) b.root.classList.remove('press');
    this.hideArrows();
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    const target = e.target as HTMLElement;
    if (target === this.pauseBtn) { this.onPause?.(); return; }
    if (target === this.lobBtn) {
      this.lobArmed = !this.lobArmed;
      this.lobBtn.classList.toggle('armed', this.lobArmed);
      buzz(8);
      return;
    }
    if (target === this.snapBtn) {
      this.latch |= Action.ACTION;
      this.snapBtn.classList.add('press');
      buzz(12);
      return;
    }

    const badgeRoot = target.closest?.('.tc-badge') as HTMLElement | null;
    const slot = badgeRoot ? Number(badgeRoot.dataset.slot) : -1;
    const role: Touch['role'] = slot >= 0 ? 'BADGE'
      : e.clientX < window.innerWidth * 0.46 ? 'STICK' : 'SURFACE';

    // A second finger in the stick zone while the first is already steering is a mis-grab, not a
    // second stick. Ignore it rather than letting it fight the one that is working.
    if (role === 'STICK') {
      for (const t of this.touches.values()) if (t.role === 'STICK') return;
    }

    const t: Touch = {
      id: e.pointerId, role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      t0: now(), slot, spent: false, moved: 0,
    };
    this.touches.set(e.pointerId, t);
    // Capture keeps a thumb that slides off the stick zone still steering, instead of the
    // gesture silently transferring to whatever it slid over. Throws for a pointer the browser
    // no longer knows about, which a fast lift genuinely produces.
    try { this.root.setPointerCapture(e.pointerId); } catch { /* nothing to capture */ }

    if (role === 'STICK') {
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('on');
    } else if (role === 'BADGE') {
      this.badges[slot].root.classList.add('press');
      buzz(6);
    }
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    const dx = t.x - t.x0, dy = t.y - t.y0;
    t.moved = Math.max(t.moved, Math.hypot(dx, dy));

    if (t.role === 'STICK') {
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      this.stick.classList.toggle('turbo', d > TURBO_R);
      const mag = Math.min(d / STICK_R, 1);
      if (d < 6) { this.moveX = 0; this.moveZ = 0; }
      else {
        const w = this.screenToWorld(dx / d, dy / d);
        this.moveX = w.x * mag; this.moveZ = w.z * mag;
      }
      return;
    }

    if (t.role === 'BADGE') {
      this.paintAim(t);
      return;
    }

    // SURFACE: fire the swipe the instant it is unambiguous. Waiting for the finger to lift
    // makes a hurdle land after the defender does.
    if (!t.spent && t.moved > SWIPE_MIN) {
      this.fireSwipe(dx, dy);
      t.spent = true;
    }
  }

  private onUp(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    try { this.root.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    const held = now() - t.t0;

    if (t.role === 'STICK') {
      this.moveX = 0; this.moveZ = 0;
      this.stick.classList.remove('on', 'turbo');
      this.knob.style.transform = 'translate(-50%,-50%)';
      return;
    }

    if (t.role === 'BADGE') {
      this.badges[t.slot].root.classList.remove('press');
      this.hideArrows();
      this.throwTo(t);
      return;
    }

    this.snapBtn.classList.remove('press');
    if (!t.spent && held < TAP_MAX_MS && t.moved < SWIPE_MIN) this.fireTap();
  }

  // ── gesture meaning ───────────────────────────────────────────────────

  /** The throw. Direction and distance of the drag become the placement vector. */
  private throwTo(t: Touch): void {
    const bit = [Action.TARGET_L, Action.TARGET_M, Action.TARGET_R][t.slot];
    const dx = t.x - t.x0, dy = t.y - t.y0;
    const d = Math.hypot(dx, dy);
    if (d > PLACE_MIN) {
      const mag = Math.min((d - PLACE_MIN) / (PLACE_FULL - PLACE_MIN), 1);
      const w = this.screenToWorld(dx / d, dy / d);
      this.aimX = w.x * mag; this.aimZ = w.z * mag;
    } else {
      this.aimX = 0; this.aimZ = 0;
    }
    this.latch |= bit;
    if (this.lobArmed) {
      this.latch |= Action.LOB;
      this.lobArmed = false;
      this.lobBtn.classList.remove('armed');
    }
    buzz(14);
  }

  private fireSwipe(dx: number, dy: number): void {
    const horizontal = Math.abs(dx) > Math.abs(dy);
    if (this.mode === 'CARRY') {
      if (horizontal) {
        // The sim measures a juke as lateral motion relative to facing, so the gesture has to
        // supply a move vector as well as the bit — the stick may be pushed straight ahead.
        const w = this.screenToWorld(Math.sign(dx), 0);
        this.forceMove = { x: w.x, z: w.z };
        this.latch |= Action.JUKE;
      } else if (dy < 0) this.latch |= Action.JUMP;
      else this.latch |= Action.DIVE;
    } else if (this.mode === 'FREE') {
      if (horizontal) this.latch |= Action.SPECIAL;
      else if (dy < 0) this.latch |= Action.JUMP;
      else this.latch |= Action.DIVE;
    } else if (this.mode === 'QB') {
      // Nothing: a stray swipe must not throw the ball away.
      return;
    }
    buzz(10);
  }

  private fireTap(): void {
    if (this.mode === 'CARRY') this.latch |= Action.SPECIAL;
    else this.latch |= Action.ACTION;
    buzz(8);
  }

  // ── screen ⇄ world ────────────────────────────────────────────────────

  /**
   * Turn a screen direction into a world direction.
   *
   * Solved from a basis measured off the live camera rather than assumed, because the camera
   * yaws with the play and swaps ends at the change of possession. Hardcoding "screen right is
   * world +X" is right for one drive and backwards for the next, and a placement control that
   * inverts halfway through a game is worse than no placement control.
   */
  private screenToWorld(sx: number, sy: number): { x: number; z: number } {
    const det = this.bx.x * this.bz.y - this.bx.y * this.bz.x;
    if (Math.abs(det) < 1e-6) return { x: sx, z: -sy };
    const x = (sx * this.bz.y - sy * this.bz.x) / det;
    const z = (sy * this.bx.x - sx * this.bx.y) / det;
    const m = Math.hypot(x, z);
    return m > 1e-6 ? { x: x / m, z: z / m } : { x: 0, z: 0 };
  }

  // ── per-frame ─────────────────────────────────────────────────────────

  /** Called once a frame with the live match, or null when there is nothing to control. */
  sync(match: Match | null, renderer: GameRenderer, active: boolean): void {
    // A down should not be lost to the two seconds it takes to rotate a phone, so the gate both
    // covers the screen and tells the caller to stop the clock.
    // Deliberately not gated on `active`: `active` is false *because* this gate paused the game,
    // so keying off it would hide the gate, unpause, re-show it, and oscillate every frame.
    const blocked = this.available && !!match && window.innerHeight > window.innerWidth;
    if (blocked !== this.gated) {
      this.gated = blocked;
      this.gate.classList.toggle('show', blocked);
      if (blocked) this.releaseAll();
      this.onGate?.(blocked);
    }

    const mode = this.available && active && match && !blocked ? this.modeFor(match) : 'OFF';
    if (mode !== this.mode) this.setMode(mode);
    this.enabled = mode !== 'OFF';
    if (!this.enabled || !match) return;

    const w = match.world;
    const me = this.controlled(match);

    // Refresh the projection basis at the player, where the throw actually happens.
    const ox = me ? me.x : 0, oz = me ? me.z : w.losZ;
    const p0 = renderer.projectToScreen(ox, 1, oz, { x: 0, y: 0, behind: false });
    const px = renderer.projectToScreen(ox + 5, 1, oz, { x: 0, y: 0, behind: false });
    const pz = renderer.projectToScreen(ox, 1, oz + 5, { x: 0, y: 0, behind: false });
    this.bx = { x: px.x - p0.x, y: px.y - p0.y };
    this.bz = { x: pz.x - p0.x, y: pz.y - p0.y };
    const bxm = Math.hypot(this.bx.x, this.bx.y) || 1;
    const bzm = Math.hypot(this.bz.x, this.bz.y) || 1;
    this.bx = { x: this.bx.x / bxm, y: this.bx.y / bxm };
    this.bz = { x: this.bz.x / bzm, y: this.bz.y / bzm };

    if (this.mode === 'QB') this.paintBadges(match, renderer);
    else this.hideBadges();
  }

  private controlled(m: Match) {
    for (const a of m.world.athletes) if (a.controlledBySeat === 0) return a;
    return null;
  }

  private modeFor(m: Match): Mode {
    if (m.state.finished) return 'OFF';
    const phase = m.phase;
    // Play select owns the screen during PLAY_CALL, and the conversion prompt owns CONVERSION_CALL.
    if (phase === 'PLAY_CALL' || phase === 'CONVERSION_CALL') return 'OFF';
    const me = this.controlled(m);
    if (!me) return 'OFF';
    if (phase === 'PRE_SNAP') return m.isHuman(m.state.possession) && me.hasBall ? 'SNAP' : 'OFF';
    const w = m.world;
    if (w.playPhase !== 'LIVE') return 'OFF';
    if (!me.hasBall) return 'FREE';
    const past = (me.z - w.losZ) * (me.side === 0 ? 1 : -1) > 0.8;
    if (me.id === w.qbId && !past && !w.passThrown) return 'QB';
    return 'CARRY';
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.root.style.display = mode === 'OFF' ? 'none' : 'block';
    this.snapBtn.style.display = mode === 'SNAP' ? 'flex' : 'none';
    this.lobBtn.style.display = mode === 'QB' ? 'flex' : 'none';
    if (mode === 'OFF') this.releaseAll();
    if (mode !== 'QB') {
      this.lobArmed = false;
      this.lobBtn.classList.remove('armed');
      this.hideBadges();
    }
    // Restart the fade rather than toggling a class: the grammar changes at the snap and again
    // at the catch, and a player who has just been handed a new verb set should be told once,
    // every time, without a legend sitting permanently over the field.
    this.coach.textContent = COACH[mode];
    this.coach.classList.remove('show');
    void this.coach.offsetWidth;
    if (COACH[mode]) this.coach.classList.add('show');
  }

  private paintBadges(m: Match, renderer: GameRenderer): void {
    const w = m.world;
    const out = { x: 0, y: 0, behind: false };
    const vw = window.innerWidth, vh = window.innerHeight;
    for (let i = 0; i < 3; i++) {
      const id = w.passTargets[i];
      const b = this.badges[i];
      const a = id >= 0 ? w.athletes[id] : null;
      if (!a || a.move === 'DOWN') { this.setBadgeVisible(b, false); continue; }
      // Helmet height. This is a control, not decoration — a thumb has to land on the receiver,
      // so it tracks the crown (2.05–2.12, see PROP in athleteRig.ts) rather than a fixed guess.
      renderer.projectToScreen(a.x, 2.10, a.z, out);
      // Behind the camera projects to a mirrored point on the far side of the screen, which
      // would put a badge on the wrong receiver. Hide it instead.
      if (out.behind) { this.setBadgeVisible(b, false); continue; }
      const x = clamp(out.x, 34, vw - 34);
      const y = clamp(out.y, 74, vh - 96);
      b.root.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`;
      b.num.textContent = String(a.def.number);
      this.setBadgeVisible(b, true);
    }
  }

  private setBadgeVisible(b: Badge, v: boolean): void {
    if (b.visible === v) return;
    b.visible = v;
    b.root.classList.toggle('on', v);
  }

  private hideBadges(): void { for (const b of this.badges) this.setBadgeVisible(b, false); }

  private hideArrows(): void {
    for (const b of this.badges) { b.arrow.style.opacity = '0'; b.arrow.style.width = '0px'; }
  }

  /** The live placement readout while a badge is being dragged. */
  private paintAim(t: Touch): void {
    const b = this.badges[t.slot];
    const dx = t.x - t.x0, dy = t.y - t.y0;
    const d = Math.hypot(dx, dy);
    if (d < PLACE_MIN) { b.arrow.style.opacity = '0'; b.arrow.style.width = '0px'; return; }
    const len = Math.min(d, PLACE_FULL);
    b.arrow.style.opacity = '1';
    b.arrow.style.width = `${len}px`;
    b.arrow.style.transform = `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`;
  }

  // ── IntentSource ──────────────────────────────────────────────────────

  read(): TouchContribution | null {
    const held = this.latch | this.sustained();
    const moving = this.moveX !== 0 || this.moveZ !== 0;
    const fm = this.forceMove;
    if (!held && !moving && !fm && this.aimX === null) return null;
    const c: TouchContribution = {
      moveX: fm ? fm.x : this.moveX,
      moveZ: fm ? fm.z : this.moveZ,
      aimX: this.aimX, aimZ: this.aimZ,
      held,
    };
    // One poll is one edge. Everything latched is consumed here, which is what turns a tap into
    // a `pressed` bit next frame and a `released` bit the frame after.
    this.latch = 0;
    this.forceMove = null;
    this.aimX = null; this.aimZ = null;
    return c;
  }

  /** Actions that are true for as long as a finger is where it is. */
  private sustained(): number {
    let m = 0;
    if (this.stick.classList.contains('turbo')) m |= Action.TURBO;
    // A finger parked on the surface without swiping is two hands on the football. It is the one
    // carrier verb that is a state rather than an event, so it is the one bound to a hold.
    if (this.mode === 'CARRY') {
      const t = now();
      for (const p of this.touches.values()) {
        if (p.role === 'SURFACE' && !p.spent && p.moved < SWIPE_MIN && t - p.t0 > TAP_MAX_MS) {
          m |= Action.PROTECT;
          break;
        }
      }
    }
    return m;
  }
}

/**
 * The whole manual, four lines long, each shown at the moment it becomes true.
 *
 * Nobody reads a control screen on a phone. They read one line, once, while looking at the thing
 * it describes — so the grammar is taught at every transition rather than listed up front, and
 * the left thumb is only explained on the snap, where there is nothing else to think about.
 */
const COACH: Record<Mode, string> = {
  OFF: '',
  SNAP: 'LEFT THUMB RUNS · PUSH PAST THE RING FOR TURBO · TAP SNAP TO HIKE IT',
  QB: 'TAP A BADGE TO THROW · DRAG OFF IT TO PLACE THE BALL',
  CARRY: 'SWIPE ⇠⇢ JUKE · ⇡ HURDLE · ⇣ DIVE · TAP SPIN · HOLD TO PROTECT',
  FREE: 'TAP TO SWITCH · SWIPE ⇡ TACKLE · ⇣ DIVE',
};
