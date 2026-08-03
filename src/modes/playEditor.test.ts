import { describe, it, expect, beforeEach } from 'vitest';
import type { DefensePlay, OffensePlay } from '../core/types.ts';
import { Rng } from '../core/rng.ts';
import { getSave, resetSave } from '../persistence/save.ts';
import { CUSTOM_PAGE } from '../plays/playbook.ts';
import {
  DEF_MAX_DEPTH, LINE_SPLIT_LIMIT, MAX_CUSTOM_PLAYS, MAX_ROUTE_NODES, SLOTS_PER_SIDE,
  addNode, copyCustom, customId, customOffensePlays, deleteCustom, firstFreeSlot, listCustom,
  loadCustom, moveNode, moveSlot, newCustomDefense, newCustomOffense, reassignTargets,
  removeNode, renameCustom, saveCustom, sanitizeName, setAssignment, setBlockDir, setNodeAction,
  setRead, setRole, setTiming, validate,
} from './playEditor.ts';

const MAX_SPLIT_X = 22;

function targets(p: OffensePlay): Array<0 | 1 | 2 | null> {
  return p.players.map((q) => q.target);
}

describe('play editor — templates', () => {
  it('a new offensive play validates clean', () => {
    const p = newCustomOffense('Test Play', 0);
    expect(validate(p)).toEqual([]);
    expect(p.players).toHaveLength(7);
    expect(p.page).toBe(CUSTOM_PAGE);
    expect(p.id).toBe(customId('OFF', 0));
  });

  it('a new defensive play validates clean', () => {
    const d = newCustomDefense('Test Call', 3);
    expect(validate(d)).toEqual([]);
    expect(d.players).toHaveLength(7);
    expect(d.slot).toBe(3);
    expect(d.id).toBe(customId('DEF', 3));
  });

  it('every slot produces a clean template on both sides', () => {
    for (let i = 0; i < SLOTS_PER_SIDE; i++) {
      expect(validate(newCustomOffense(`Play ${i}`, i))).toEqual([]);
      expect(validate(newCustomDefense(`Call ${i}`, i))).toEqual([]);
    }
  });

  it('names are sanitised for an arcade panel', () => {
    expect(sanitizeName('  hook & <ladder>  ')).toBe('HOOK LADDER');
    expect(sanitizeName('a'.repeat(80)).length).toBeLessThanOrEqual(20);
    expect(newCustomOffense('', 0).name).toBe('NEW PLAY');
  });
});

describe('play editor — alignment clamping', () => {
  it('clamps a receiver dragged off the sideline and past the line', () => {
    const p = newCustomOffense('Wide', 0);
    const got = moveSlot(p, 4, -999, 40);
    expect(got.x).toBe(-MAX_SPLIT_X);
    expect(got.z).toBeLessThanOrEqual(0.3);
    expect(p.players[4].align.x).toBe(-MAX_SPLIT_X);
    expect(validate(p)).toEqual([]);

    const other = moveSlot(p, 6, 999, -999);
    expect(other.x).toBe(MAX_SPLIT_X);
    expect(other.z).toBeGreaterThanOrEqual(-12);
  });

  it('keeps linemen on the line and inside four yards of the ball', () => {
    const p = newCustomOffense('Line', 0);
    const got = moveSlot(p, 1, -30, 18);
    expect(got.x).toBe(-LINE_SPLIT_LIMIT);
    expect(got.z).toBeLessThan(0);
    expect(p.players[1].align.z).toBe(p.players[2].align.z);
    expect(validate(p)).toEqual([]);
  });

  it('keeps the quarterback behind the ball', () => {
    const p = newCustomOffense('Gun', 0);
    const got = moveSlot(p, 0, 0, 12);
    expect(got.z).toBeLessThanOrEqual(-1);
    expect(moveSlot(p, 0, 0, -80).z).toBeGreaterThanOrEqual(-12);
    expect(validate(p)).toEqual([]);
  });

  it('keeps defenders off the ball and inbounds', () => {
    const d = newCustomDefense('Front', 0);
    const got = moveSlot(d, 0, -400, -9);
    expect(got.x).toBe(-MAX_SPLIT_X);
    expect(got.z).toBeGreaterThanOrEqual(0.8);
    expect(moveSlot(d, 6, 0, 900).z).toBeLessThanOrEqual(DEF_MAX_DEPTH);
  });

  it('rejects an out-of-range slot index without throwing', () => {
    const p = newCustomOffense('Guard', 0);
    expect(() => moveSlot(p, 99, 0, 0)).not.toThrow();
    expect(() => moveSlot(p, -1, 0, 0)).not.toThrow();
    expect(validate(p)).toEqual([]);
  });
});

describe('play editor — routes', () => {
  it('appends, moves, retags and removes nodes', () => {
    const p = newCustomOffense('Route', 0);
    const before = p.players[5].route.length;
    const idx = addNode(p, 5, 4, 9, 'CUT');
    expect(idx).toBe(before);
    expect(p.players[5].route[idx].action).toBe('CUT');

    moveNode(p, 5, idx, 3, 14);
    expect(p.players[5].route[idx].z).toBe(14);

    setNodeAction(p, 5, idx, 'SPEED');
    expect(p.players[5].route[idx].action).toBe('SPEED');

    expect(removeNode(p, 5, idx)).toBe(true);
    expect(p.players[5].route).toHaveLength(before);
    expect(validate(p)).toEqual([]);
  });

  it('clamps route nodes so a route never leaves the field', () => {
    const p = newCustomOffense('Deep', 0);
    moveSlot(p, 6, MAX_SPLIT_X, 0);
    const i = addNode(p, 6, 60, 400, 'SPEED');
    const nd = p.players[6].route[i];
    expect(p.players[6].align.x + nd.x).toBeLessThanOrEqual(25.5);
    expect(nd.z).toBeLessThanOrEqual(60);
    expect(validate(p)).toEqual([]);
  });

  it('re-clamps existing route nodes when the player moves', () => {
    const p = newCustomOffense('Slide', 0);
    addNode(p, 5, 20, 6, 'SPEED');
    moveSlot(p, 5, MAX_SPLIT_X, -4.6);
    for (const nd of p.players[5].route) {
      expect(Math.abs(p.players[5].align.x + nd.x)).toBeLessThanOrEqual(25.6);
    }
    expect(validate(p)).toEqual([]);
  });

  it('refuses to empty a route and caps the node count', () => {
    const p = newCustomOffense('Cap', 0);
    p.players[4].route = [{ x: 0, z: 8, action: 'RUN' }];
    expect(removeNode(p, 4, 0)).toBe(false);
    for (let i = 0; i < 30; i++) addNode(p, 4, i % 5, 6 + i, 'RUN');
    expect(p.players[4].route.length).toBeLessThanOrEqual(MAX_ROUTE_NODES);
    expect(addNode(p, 4, 1, 30, 'RUN')).toBe(-1);
  });

  it('accepts one handoff and flags two', () => {
    const p = newCustomOffense('Mesh', 0);
    p.players[5].route = [
      { x: 1, z: -1.2, action: 'CARRY' },
      { x: 3, z: 2, action: 'RUN' },
      { x: 5, z: 10, action: 'SPEED' },
    ];
    expect(validate(p)).toEqual([]);
    p.players[4].route = [{ x: 0, z: -1, action: 'CARRY' }, { x: 2, z: 8, action: 'SPEED' }];
    const problems = validate(p);
    expect(problems.some((x) => x.includes('both take the handoff'))).toBe(true);
  });

  it('flags a handoff stamped too late in a route', () => {
    const p = newCustomOffense('Late', 0);
    const i = addNode(p, 5, 1, -1, 'CARRY');
    expect(i).toBeGreaterThan(1);
    expect(validate(p).some((x) => x.includes('too late'))).toBe(true);
  });
});

describe('play editor — target buttons', () => {
  it('reassignTargets always yields exactly one each of 0, 1 and 2', () => {
    const rng = new Rng(0xc0ffee);
    for (let trial = 0; trial < 200; trial++) {
      const p = newCustomOffense('Shuffle', 0);
      for (let i = 0; i < 7; i++) {
        moveSlot(p, i, rng.range(-MAX_SPLIT_X - 8, MAX_SPLIT_X + 8), rng.range(-14, 2));
      }
      reassignTargets(p);
      const t = targets(p).filter((v) => v !== null).sort();
      expect(t).toEqual([0, 1, 2]);
    }
  });

  it('stamps buttons strictly left to right by pre-snap x', () => {
    const p = newCustomOffense('Order', 0);
    moveSlot(p, 4, 14, 0);     // was the leftmost split end
    moveSlot(p, 6, -19, 0);    // was the rightmost
    reassignTargets(p);
    const eligible = p.players
      .map((q, i) => ({ i, x: q.align.x, t: q.target }))
      .filter((e) => e.t !== null)
      .sort((a, b) => a.x - b.x);
    expect(eligible.map((e) => e.t)).toEqual([0, 1, 2]);
    expect(validate(p)).toEqual([]);
  });

  it('promotes a lineman rather than leaving fewer than three targets', () => {
    const p = newCustomOffense('Heavy', 0);
    p.players[4].role = 'LINE';
    reassignTargets(p);
    const t = targets(p).filter((v) => v !== null).sort();
    expect(t).toEqual([0, 1, 2]);
  });

  it('setRole never moves the quarterback slot', () => {
    const p = newCustomOffense('Roles', 0);
    expect(setRole(p, 1, 'QB')).toBe(false);
    expect(setRole(p, 0, 'WIDE')).toBe(false);
    expect(p.players[0].role).toBe('QB');
    expect(p.players.filter((q) => q.role === 'QB')).toHaveLength(1);
  });

  it('setRole swaps a lineman with a receiver instead of making a fourth target', () => {
    const p = newCustomOffense('Swap', 0);
    expect(setRole(p, 1, 'SLOT')).toBe(true);
    expect(p.players[1].role).toBe('SLOT');
    expect(p.players.filter((q) => q.role === 'LINE')).toHaveLength(3);
    expect(p.players.filter((q) => q.role !== 'QB' && q.role !== 'LINE')).toHaveLength(3);
    expect(targets(p).filter((v) => v !== null).sort()).toEqual([0, 1, 2]);
    expect(validate(p)).toEqual([]);
  });

  it('a plain change between eligible roles is a straight swap of nobody', () => {
    const p = newCustomOffense('Back', 0);
    expect(setRole(p, 5, 'SLOT')).toBe(true);
    expect(p.players[5].role).toBe('SLOT');
    expect(p.players.filter((q) => q.role === 'LINE')).toHaveLength(3);
    expect(validate(p)).toEqual([]);
  });

  it('repairs reads that stop pointing at a target', () => {
    const p = newCustomOffense('Reads', 0);
    p.reads = [1, 1];
    reassignTargets(p);
    expect(p.reads[0]).not.toBe(p.reads[1]);
    expect(p.players[p.reads[0]].target).not.toBeNull();
    expect(p.players[p.reads[1]].target).not.toBeNull();
    expect(validate(p)).toEqual([]);
  });

  it('setRead only accepts players who carry a target', () => {
    const p = newCustomOffense('Primary', 0);
    expect(setRead(p, 0, 1)).toBe(false);          // a lineman
    expect(setRead(p, 0, p.reads[1])).toBe(false); // already the other read
    expect(setRead(p, 0, 5)).toBe(true);
    expect(p.reads[0]).toBe(5);
    expect(validate(p)).toEqual([]);
  });

  it('keeps the secondary read after the primary', () => {
    const p = newCustomOffense('Timing', 0);
    setTiming(p, 200, 10);
    expect(p.timing.secondary).toBeGreaterThan(p.timing.primary);
    setTiming(p, Number.NaN, Number.NaN);
    expect(Number.isFinite(p.timing.primary)).toBe(true);
    expect(validate(p)).toEqual([]);
  });
});

describe('play editor — defensive assignments', () => {
  it('normalises out-of-range assignments', () => {
    const d = newCustomDefense('Bad', 0);
    setAssignment(d, 0, { kind: 'RUSH', lane: 9 });
    expect((d.players[0].assign as { lane: number }).lane).toBe(1);
    setAssignment(d, 4, { kind: 'MAN', slot: 11 });
    expect((d.players[4].assign as { slot: number }).slot).toBe(2);
    setAssignment(d, 5, { kind: 'ZONE', x: 900, z: -40, r: 0.1 });
    const z = d.players[5].assign as { x: number; z: number; r: number };
    expect(z.x).toBe(MAX_SPLIT_X);
    expect(z.z).toBeGreaterThanOrEqual(0);
    expect(z.r).toBeGreaterThanOrEqual(3);
  });

  it('flags two defenders covering the same receiver', () => {
    const d = newCustomDefense('Double', 0);
    setAssignment(d, 4, { kind: 'MAN', slot: 0 });
    const problems = validate(d);
    expect(problems.some((x) => x.includes('both cover skill slot 0'))).toBe(true);
  });

  it('flags an all-rush call with nobody in coverage', () => {
    const d = newCustomDefense('AllOut', 0);
    for (let i = 4; i < 7; i++) setAssignment(d, i, { kind: 'RUSH', lane: 0.3 });
    expect(validate(d).some((x) => x.includes('covering'))).toBe(true);
  });

  it('flags stacked defenders', () => {
    const d = newCustomDefense('Stack', 0);
    moveSlot(d, 5, 0, 5.2);
    expect(validate(d).some((x) => x.includes('standing on top'))).toBe(true);
  });
});

describe('play editor — persistence', () => {
  beforeEach(() => { resetSave(); });

  it('round-trips a play through the save file', () => {
    const p = newCustomOffense('Coil Mesh', 2);
    setBlockDir(p, 1, -1);
    addNode(p, 5, 3, 8, 'CUT');

    const stored = saveCustom('OFF', 2, p);
    expect(stored).not.toBeNull();
    expect(stored!.side).toBe('OFF');
    expect(stored!.slot).toBe(2);
    expect(stored!.name).toBe('COIL MESH');
    expect(getSave().customPlays).toHaveLength(1);

    const back = loadCustom('OFF', 2);
    expect(back).not.toBeNull();
    const data = back!.data as OffensePlay;
    expect(data.players).toHaveLength(7);
    expect(data.players[5].route).toHaveLength(p.players[5].route.length);
    expect(data.players[1].blockDir).toBe(-1);
    expect(data.id).toBe(customId('OFF', 2));
    expect(validate(data)).toEqual([]);

    expect(deleteCustom('OFF', 2)).toBe(true);
    expect(loadCustom('OFF', 2)).toBeNull();
    expect(getSave().customPlays).toHaveLength(0);
    expect(deleteCustom('OFF', 2)).toBe(false);
  });

  it('keeps offensive and defensive slots independent', () => {
    saveCustom('OFF', 0, newCustomOffense('Alpha', 0));
    saveCustom('DEF', 0, newCustomDefense('Bravo', 0));
    expect(listCustom()).toHaveLength(2);
    expect(listCustom('OFF')).toHaveLength(1);
    expect(listCustom('DEF')).toHaveLength(1);
    expect(loadCustom('OFF', 0)!.name).toBe('ALPHA');
    expect(loadCustom('DEF', 0)!.name).toBe('BRAVO');
    expect(deleteCustom('DEF', 0)).toBe(true);
    expect(loadCustom('OFF', 0)).not.toBeNull();
  });

  it('overwrites in place rather than growing the list', () => {
    saveCustom('OFF', 4, newCustomOffense('First', 4));
    saveCustom('OFF', 4, newCustomOffense('Second', 4));
    expect(getSave().customPlays).toHaveLength(1);
    expect(loadCustom('OFF', 4)!.name).toBe('SECOND');
  });

  it('holds nine per side and eighteen overall', () => {
    for (let i = 0; i < SLOTS_PER_SIDE; i++) {
      expect(saveCustom('OFF', i, newCustomOffense(`O${i}`, i))).not.toBeNull();
      expect(saveCustom('DEF', i, newCustomDefense(`D${i}`, i))).not.toBeNull();
    }
    expect(getSave().customPlays).toHaveLength(MAX_CUSTOM_PLAYS);
    expect(firstFreeSlot('OFF')).toBe(-1);
    // Slot 9 does not exist; the write is refused rather than silently wrapping.
    expect(saveCustom('OFF', SLOTS_PER_SIDE, newCustomOffense('Overflow', 0))).toBeNull();
    expect(getSave().customPlays).toHaveLength(MAX_CUSTOM_PLAYS);
  });

  it('refuses a play whose side does not match its shape', () => {
    expect(saveCustom('DEF', 0, newCustomOffense('Wrong', 0))).toBeNull();
    expect(saveCustom('OFF', 0, newCustomDefense('Wrong', 0))).toBeNull();
    expect(getSave().customPlays).toHaveLength(0);
  });

  it('reads a corrupt entry as an empty slot', () => {
    const save = getSave();
    save.customPlays = [
      { id: 'junk', name: 'JUNK', side: 'OFF', slot: 1, data: { players: [] } as unknown as OffensePlay },
    ];
    expect(loadCustom('OFF', 1)).toBeNull();
  });

  it('copies and renames', () => {
    saveCustom('OFF', 0, newCustomOffense('Source', 0));
    const copy = copyCustom('OFF', 0, 5);
    expect(copy).not.toBeNull();
    expect(copy!.slot).toBe(5);
    expect(copy!.data.id).toBe(customId('OFF', 5));
    expect(loadCustom('OFF', 0)!.name).toBe('SOURCE');

    expect(renameCustom('OFF', 5, 'Copy Cat')).toBe('COPY CAT');
    expect(loadCustom('OFF', 5)!.name).toBe('COPY CAT');
    expect(renameCustom('OFF', 8, 'Nothing')).toBeNull();
  });

  it('exports saved offensive plays for a match config', () => {
    saveCustom('OFF', 0, newCustomOffense('Runnable', 0));
    saveCustom('DEF', 0, newCustomDefense('Ignored', 0));
    const plays = customOffensePlays();
    expect(plays).toHaveLength(1);
    expect(plays[0].page).toBe(CUSTOM_PAGE);
    expect(validate(plays[0])).toEqual([]);
  });

  it('a saved play survives a JSON round trip unchanged', () => {
    const p = newCustomOffense('Json Safe', 7);
    addNode(p, 4, -3, 12, 'CUT');
    saveCustom('OFF', 7, p);
    const raw = JSON.stringify(getSave().customPlays);
    const parsed = JSON.parse(raw) as Array<{ data: OffensePlay }>;
    expect(validate(parsed[0].data)).toEqual([]);
    expect(parsed[0].data.players[4].route).toHaveLength(p.players[4].route.length);
  });

  it('defensive calls round-trip too', () => {
    const d = newCustomDefense('Storm Wall', 1);
    setAssignment(d, 4, { kind: 'ZONE', x: 0, z: 12, r: 10 });
    setAssignment(d, 5, { kind: 'SPY' });
    saveCustom('DEF', 1, d);
    const back = loadCustom('DEF', 1)!.data as DefensePlay;
    expect(back.players[4].assign.kind).toBe('ZONE');
    expect(back.players[5].assign.kind).toBe('SPY');
    expect(validate(back)).toEqual([]);
  });
});
