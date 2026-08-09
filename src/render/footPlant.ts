import type { FootPoint } from './footSlip.ts';

export interface FootLockState {
  foot: -1 | 0 | 1;
  holding: boolean;
  weight: number;
  pendingFoot: -1 | 0 | 1;
  groundedFrames: number;
  anchor: FootPoint;
}

export interface FootLockInput {
  /** Locomotion is valid for tracking/holding a stance foot. */
  eligible: boolean;
  /** A hard turn currently wants a lock. Grounded history may be collected before this becomes true. */
  acquire: boolean;
  candidate: -1 | 0 | 1;
  candidatePoint: FootPoint;
  candidateGrounded: boolean;
  anyGrounded: boolean;
  activeGrounded: boolean;
  activePoint: FootPoint;
  activeReach: number;
  dt: number;
}

// Reaches 93% in three 60 Hz presentation frames: quick enough to grip, still visibly blended.
const LOCK_RATE = 52;
const RELEASE_REACH = 0.26;

export function makeFootLockState(): FootLockState {
  return {
    foot: -1, holding: false, weight: 0, pendingFoot: -1, groundedFrames: 0,
    anchor: { x: 0, y: 0, z: 0 },
  };
}

export function resetFootLock(state: FootLockState): void {
  state.foot = -1;
  state.holding = false;
  state.weight = 0;
  state.pendingFoot = -1;
  state.groundedFrames = 0;
}

/** Advance the deterministic presentation-only acquire/hold/release state machine. */
export function updateFootLock(state: FootLockState, input: FootLockInput): FootLockState {
  const dt = Math.max(0, input.dt);
  const blend = 1 - Math.exp(-LOCK_RATE * dt);

  const trackCandidate = (): void => {
    if (!input.eligible || !input.candidateGrounded || input.candidate === -1 || input.candidate === state.foot) {
      state.pendingFoot = -1;
      state.groundedFrames = 0;
    } else if (state.pendingFoot === input.candidate) state.groundedFrames++;
    else {
      state.pendingFoot = input.candidate;
      state.groundedFrames = 1;
    }
  };

  const acquirePending = (): boolean => {
    if (!input.acquire || state.pendingFoot === -1 || state.groundedFrames < 2) return false;
    state.foot = state.pendingFoot;
    state.holding = true;
    state.weight = Math.max(state.weight, blend);
    // Lock where the contact is when its two-frame proof completes. Pulling a foot retroactively
    // to frame one's point can create a visible snap after a collision or abrupt authored turn.
    state.anchor.x = input.candidatePoint.x;
    state.anchor.y = input.candidatePoint.y;
    state.anchor.z = input.candidatePoint.z;
    state.pendingFoot = -1;
    state.groundedFrames = 0;
    return true;
  };

  if (state.holding) {
    trackCandidate();
    if (!input.eligible || !input.anyGrounded || !input.activeGrounded || input.activeReach > RELEASE_REACH) {
      // A next stance foot that has genuinely been down for two frames may take ownership only
      // after the current lock becomes invalid. There is no magnetic mid-stance foot switching.
      if (input.eligible && input.anyGrounded && acquirePending()) return state;
      state.holding = false;
    } else {
      state.weight += (1 - state.weight) * blend;
      return state;
    }
  }

  if (state.foot !== -1) {
    // Let go in world space as well as in rotation weight. Following the authored contact toward
    // its current position prevents a fading lock from pulling harder simply because the runner's
    // root continued downfield during the release frames.
    state.anchor.x += (input.activePoint.x - state.anchor.x) * blend;
    state.anchor.y += (input.activePoint.y - state.anchor.y) * blend;
    state.anchor.z += (input.activePoint.z - state.anchor.z) * blend;
    state.weight *= Math.exp(-LOCK_RATE * dt);
    // At this point less than five per cent of the correction remains: visually released, and
    // retaining ownership longer only prevents the next stance foot from acquiring cleanly.
    if (state.weight < 0.05) {
      state.foot = -1;
      state.weight = 0;
    }
    if (state.foot !== -1) return state;
  }

  trackCandidate();
  acquirePending();
  return state;
}
