/** Action bitmask. Sim only ever sees these — never key codes or gamepad buttons. */
export const Action = {
  TURBO: 1 << 0,
  /** Snap / pass / change-player / lateral — the context-sensitive "A" verb. */
  ACTION: 1 << 1,
  /** Jump / tackle / hurdle / swat — the context-sensitive "B" verb. */
  JUMP: 1 << 2,
  TARGET_L: 1 << 3,
  TARGET_M: 1 << 4,
  TARGET_R: 1 << 5,
  /** Dive (ball carrier) / dive tackle (defense). */
  DIVE: 1 << 6,
  /** Spin (carrier) / power tackle (defense) when combined with turbo. */
  SPECIAL: 1 << 7,
  AUDIBLE: 1 << 8,
  MOTION: 1 << 9,
  PAUSE: 1 << 10,
  PAGE: 1 << 11,
  BACK: 1 << 12,
  UP: 1 << 13,
  DOWN: 1 << 14,
  LEFT: 1 << 15,
  RIGHT: 1 << 16,
  HIDE_PLAY: 1 << 17,
  /** Modern passing mode: aim assist toggle / free-aim throw. */
  LOB: 1 << 18,
  /** Ball carrier: plant and cut. Beats a committed dive, does little against a balanced man. */
  JUKE: 1 << 19,
  /** Ball carrier: two hands on it. Slower and less agile, far harder to strip. */
  PROTECT: 1 << 20,
} as const;

export type ActionMask = number;
export type ActionName = keyof typeof Action;

export const ACTION_NAMES = Object.keys(Action) as ActionName[];

export function has(mask: number, a: number): boolean { return (mask & a) !== 0; }

/** Human-facing labels used by the settings screen and help prompts. */
export const ACTION_LABELS: Record<ActionName, string> = {
  JUKE: 'Juke',
  PROTECT: 'Protect ball',
  TURBO: 'Turbo',
  ACTION: 'Pass / Snap / Switch',
  JUMP: 'Jump / Tackle / Hurdle',
  TARGET_L: 'Throw Left',
  TARGET_M: 'Throw Middle',
  TARGET_R: 'Throw Right',
  DIVE: 'Dive / Dive Tackle',
  SPECIAL: 'Spin / Power Tackle',
  AUDIBLE: 'Audible',
  MOTION: 'Motion Receiver',
  PAUSE: 'Pause',
  PAGE: 'Next Play Page',
  BACK: 'Back',
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right',
  HIDE_PLAY: 'Hide Play',
  LOB: 'Touch Pass',
};
