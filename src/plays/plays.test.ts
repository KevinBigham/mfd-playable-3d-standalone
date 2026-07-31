import { describe, expect, it } from 'vitest';

import type { OffensePlay, PlayTag } from '../core/types.ts';
import { DEFENSE_PAGE, DEFENSE_PLAYS } from './defense.ts';
import { playDiagramSvg } from './diagram.ts';
import { BASE_OFFENSE_FORMATIONS, DEFENSE_FORMATIONS, OFFENSE_FORMATIONS } from './formations.ts';
import { OFFENSE_PAGES, OFFENSE_PLAYS } from './offense.ts';
import {
  DEFAULT_AUDIBLES_DEF, DEFAULT_AUDIBLES_OFF, allPlays, getDefensePlay, getOffensePlay,
  offensePage, validatePlay,
} from './playbook.ts';
import { mirrorDefensePlay, mirrorOffensePlay, mirrorRoute, routeDepth } from './routes.ts';
import { SPECIAL_DEFENSE, SPECIAL_OFFENSE, SPECIAL_PLAYS } from './special.ts';

const ALL = allPlays();
const eligible = (p: OffensePlay) => p.players.filter((pl) => pl.role !== 'QB' && pl.role !== 'LINE');

describe('playbook size', () => {
  it('ships exactly 27 offensive plays', () => {
    expect(OFFENSE_PLAYS).toHaveLength(27);
  });

  it('ships exactly 14 defensive plays', () => {
    expect(DEFENSE_PLAYS).toHaveLength(14);
  });

  it('splits the offense into three pages of nine', () => {
    expect(OFFENSE_PAGES).toHaveLength(3);
    for (const page of OFFENSE_PAGES) expect(page).toHaveLength(9);
    expect(OFFENSE_PAGES.flat()).toEqual(OFFENSE_PLAYS);
  });

  it('shows the first nine defensive calls on the wheel', () => {
    expect(DEFENSE_PAGE).toHaveLength(9);
    expect(DEFENSE_PAGE).toEqual(DEFENSE_PLAYS.slice(0, 9));
  });
});

describe('identity', () => {
  it('gives every play a unique id', () => {
    const ids = ALL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every play a non-empty name', () => {
    for (const p of ALL) expect(p.name.length).toBeGreaterThan(0);
  });

  it('never uses the forbidden word in a user-facing string', () => {
    for (const p of ALL) {
      expect(p.name.toLowerCase()).not.toContain('blitz');
      expect(p.id.toLowerCase()).not.toContain('blitz');
    }
    for (const f of [...Object.keys(OFFENSE_FORMATIONS), ...Object.keys(DEFENSE_FORMATIONS)]) {
      expect(f.toLowerCase()).not.toContain('blitz');
    }
  });

  it('resolves ids back to the same play object', () => {
    for (const p of OFFENSE_PLAYS) expect(getOffensePlay(p.id)).toBe(p);
    for (const p of DEFENSE_PLAYS) expect(getDefensePlay(p.id)).toBe(p);
  });

  it('falls back rather than returning undefined for an unknown id', () => {
    expect(getOffensePlay('nope')).toBe(OFFENSE_PLAYS[0]);
    expect(getDefensePlay('nope')).toBe(DEFENSE_PLAYS[0]);
  });
});

describe('validation', () => {
  it('reports zero problems for every shipped play', () => {
    for (const p of ALL) expect([p.id, validatePlay(p)]).toEqual([p.id, []]);
  });

  it('catches a play that lost a player', () => {
    const broken = { ...OFFENSE_PLAYS[0], players: OFFENSE_PLAYS[0].players.slice(1) };
    expect(validatePlay(broken).length).toBeGreaterThan(0);
  });

  it('catches a receiver split out of bounds', () => {
    const src = OFFENSE_PLAYS[4];
    const players = src.players.map((pl, i) =>
      i === 6 ? { ...pl, align: { x: 40, z: pl.align.z } } : pl);
    expect(validatePlay({ ...src, players }).join(' ')).toContain('out of bounds');
  });

  it('catches a route that runs off the field', () => {
    const src = OFFENSE_PLAYS[5];
    const players = src.players.map((pl, i) =>
      i === 6 ? { ...pl, route: [{ x: 22, z: 12, action: 'RUN' as const }] } : pl);
    expect(validatePlay({ ...src, players }).join(' ')).toContain('leaves the field');
  });

  it('catches a defender lined up offside', () => {
    const src = DEFENSE_PLAYS[0];
    const players = src.players.map((pl, i) =>
      i === 0 ? { ...pl, align: { x: pl.align.x, z: -1 } } : pl);
    expect(validatePlay({ ...src, players }).join(' ')).toContain('offside');
  });
});

describe('personnel', () => {
  it('puts exactly seven players on every play', () => {
    for (const p of ALL) expect(p.players).toHaveLength(7);
  });

  it('gives every offensive play exactly one quarterback', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      expect(p.players.filter((pl) => pl.role === 'QB')).toHaveLength(1);
    }
  });

  it('gives every offensive play exactly three distinct targets 0/1/2', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      const targets = p.players.map((pl) => pl.target).filter((t) => t !== null);
      expect([p.id, targets.length]).toEqual([p.id, 3]);
      expect([p.id, [...targets].sort()]).toEqual([p.id, [0, 1, 2]]);
    }
  });

  it('assigns targets strictly by pre-snap x, leftmost first', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      const order = eligible(p).slice().sort((a, b) => a.align.x - b.align.x);
      expect([p.id, order.map((pl) => pl.target)]).toEqual([p.id, [0, 1, 2]]);
      // No ties, or the ordering above would be ambiguous.
      const xs = order.map((pl) => pl.align.x);
      expect([p.id, new Set(xs).size]).toEqual([p.id, 3]);
    }
  });

  it('never makes a lineman or the quarterback a target', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      for (const pl of p.players) {
        if (pl.role === 'QB' || pl.role === 'LINE') expect(pl.target).toBeNull();
      }
    }
  });

  it('points both reads at real, distinct targets', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      expect(p.reads[0]).not.toBe(p.reads[1]);
      for (const r of p.reads) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(7);
        expect([p.id, p.players[r].target]).not.toEqual([p.id, null]);
      }
    }
  });
});

describe('geometry', () => {
  it('keeps every route node inside |x| <= 26 and z <= 62', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      for (const pl of p.players) {
        for (const nd of pl.route) {
          expect([p.id, Math.abs(nd.x) <= 26]).toEqual([p.id, true]);
          expect([p.id, nd.z <= 62]).toEqual([p.id, true]);
        }
      }
    }
  });

  it('keeps every athlete inbounds for the whole route', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      for (const pl of p.players) {
        for (const nd of pl.route) {
          expect([p.id, Math.abs(pl.align.x + nd.x) <= 26.265]).toEqual([p.id, true]);
        }
      }
    }
  });

  it('never aligns an offensive player past the line of scrimmage', () => {
    for (const p of [...OFFENSE_PLAYS, ...SPECIAL_OFFENSE]) {
      for (const pl of p.players) expect(pl.align.z).toBeLessThanOrEqual(0.35);
    }
  });

  it('never aligns a defender inside 0.8 yards of the ball', () => {
    for (const p of [...DEFENSE_PLAYS, ...SPECIAL_DEFENSE]) {
      for (const pl of p.players) expect(pl.align.z).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('builds every base formation with seven slots and three eligibles', () => {
    for (const f of BASE_OFFENSE_FORMATIONS) {
      expect([f.name, f.slots.length]).toEqual([f.name, 7]);
      const skill = f.slots.filter((sl) => sl.role !== 'QB' && sl.role !== 'LINE');
      expect([f.name, skill.length]).toEqual([f.name, 3]);
      expect([f.name, f.slots.filter((sl) => sl.role === 'LINE').length]).toEqual([f.name, 3]);
      for (const sl of f.slots) expect(Math.abs(sl.align.x)).toBeLessThanOrEqual(22);
    }
  });

  it('builds every defensive formation with seven slots off the ball', () => {
    for (const f of Object.values(DEFENSE_FORMATIONS)) {
      expect([f.name, f.slots.length]).toEqual([f.name, 7]);
      for (const sl of f.slots) expect(sl.align.z).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe('wheel layout', () => {
  it('fills every offensive page/slot exactly once', () => {
    const seen = new Set<string>();
    for (const p of OFFENSE_PLAYS) {
      expect(p.page).toBeGreaterThanOrEqual(0);
      expect(p.page).toBeLessThanOrEqual(2);
      expect(p.slot).toBeGreaterThanOrEqual(0);
      expect(p.slot).toBeLessThanOrEqual(8);
      const key = `${p.page}:${p.slot}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(27);
  });

  it('places each play at the page/slot the pages array agrees with', () => {
    for (let page = 0; page < 3; page++) {
      for (let slot = 0; slot < 9; slot++) {
        const p = OFFENSE_PAGES[page][slot];
        expect([p.id, p.page, p.slot]).toEqual([p.id, page, slot]);
      }
    }
  });

  it('fills defensive slots 0 through 13 exactly once', () => {
    const slots = DEFENSE_PLAYS.map((p) => p.slot).sort((a, b) => a - b);
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('returns the right page and falls back for the custom page', () => {
    expect(offensePage(0)).toEqual(OFFENSE_PAGES[0]);
    expect(offensePage(2)).toEqual(OFFENSE_PAGES[2]);
    expect(offensePage(3)).toHaveLength(9);
    expect(offensePage(3)[0]).toBe(OFFENSE_PAGES[0][0]);
  });

  it('drops a custom play into its own slot on the custom page', () => {
    const custom = {
      id: 'c1', name: 'Mine', side: 'OFF' as const, slot: 4,
      data: { ...OFFENSE_PLAYS[6], id: 'c1', name: 'Mine' },
    };
    const page = offensePage(3, [custom]);
    expect(page[4].id).toBe('c1');
    expect(page[0]).toBe(OFFENSE_PAGES[0][0]);
  });
});

describe('concept coverage', () => {
  const count = (tag: PlayTag) => OFFENSE_PLAYS.filter((p) => p.tags.includes(tag)).length;

  it('carries enough of every concept family to call a game', () => {
    expect(count('RUN')).toBeGreaterThanOrEqual(5);
    expect(count('QUICK')).toBeGreaterThanOrEqual(5);
    expect(count('CROSS')).toBeGreaterThanOrEqual(3);
    expect(count('FLOOD')).toBeGreaterThanOrEqual(3);
    expect(count('DEEP')).toBeGreaterThanOrEqual(4);
    expect(count('MISDIRECT')).toBeGreaterThanOrEqual(2);
    expect(count('ROLLOUT')).toBeGreaterThanOrEqual(2);
    expect(count('SCREEN')).toBeGreaterThanOrEqual(2);
    expect(count('OPTION')).toBeGreaterThanOrEqual(1);
    expect(count('TRICK')).toBeGreaterThanOrEqual(1);
    expect(count('GOALLINE')).toBeGreaterThanOrEqual(2);
  });

  it('tags every play with something', () => {
    for (const p of ALL) expect(p.tags.length).toBeGreaterThan(0);
  });

  it('covers man, zone, pressure, spy, contain and prevent on defense', () => {
    const has = (t: string) => DEFENSE_PLAYS.some((p) => (p.tags as string[]).includes(t));
    for (const t of ['MAN', 'ZONE', 'MIXED', 'CONTAIN', 'SPY', 'EDGE', 'INTERIOR', 'ALLOUT',
      'GOALLINE', 'PREVENT']) {
      expect([t, has(t)]).toEqual([t, true]);
    }
  });

  it('scales timing with route depth and orders the two reads', () => {
    for (const p of OFFENSE_PLAYS) {
      expect(p.timing.primary).toBeGreaterThan(0);
      expect(p.timing.secondary).toBeGreaterThan(p.timing.primary);
      const depth = routeDepth(p.players[p.reads[0]].route);
      // ~0.55 s of snap-and-set plus depth at ~11 yd/s, with generous slack.
      const expected = 33 + (depth * 60) / 11;
      expect([p.id, Math.abs(p.timing.primary - expected) < 70]).toEqual([p.id, true]);
    }
  });

  it('keeps aggression and deep help inside 0..1 and honest about all-out calls', () => {
    for (const p of DEFENSE_PLAYS) {
      expect(p.aggression).toBeGreaterThanOrEqual(0);
      expect(p.aggression).toBeLessThanOrEqual(1);
      expect(p.deepHelp).toBeGreaterThanOrEqual(0);
      expect(p.deepHelp).toBeLessThanOrEqual(1);
      const rushers = p.players.filter(
        (d) => d.assign.kind === 'RUSH' || d.assign.kind === 'BLITZ_DELAY').length;
      if (rushers >= 5) expect(p.deepHelp).toBeLessThan(0.2);
      const deep = p.players.filter(
        (d) => d.assign.kind === 'ZONE' && d.assign.z >= 18).length;
      if (deep === 0) expect(p.deepHelp).toBeLessThan(0.55);
    }
  });
});

describe('audibles', () => {
  it('exposes three offensive audibles that all resolve', () => {
    expect(DEFAULT_AUDIBLES_OFF).toHaveLength(3);
    for (const id of DEFAULT_AUDIBLES_OFF) {
      expect(OFFENSE_PLAYS.some((p) => p.id === id)).toBe(true);
    }
  });

  it('covers run, quick game and a deep shot', () => {
    const [run, quick, deep] = DEFAULT_AUDIBLES_OFF.map(getOffensePlay);
    expect(run.tags).toContain('RUN');
    expect(quick.tags).toContain('QUICK');
    expect(deep.tags).toContain('DEEP');
  });

  it('exposes three defensive audibles that all resolve', () => {
    expect(DEFAULT_AUDIBLES_DEF).toHaveLength(3);
    for (const id of DEFAULT_AUDIBLES_DEF) {
      expect(DEFENSE_PLAYS.some((p) => p.id === id)).toBe(true);
    }
  });
});

describe('special teams', () => {
  it('exposes every special-teams call', () => {
    for (const key of ['punt', 'fakePunt', 'fieldGoal', 'fakeFieldGoal', 'extraPoint',
      'kickoff', 'onside', 'kickReturn', 'puntReturn', 'blockKick'] as const) {
      expect(SPECIAL_PLAYS[key]).toBeTruthy();
      expect(SPECIAL_PLAYS[key].players).toHaveLength(7);
    }
  });

  it('aligns the kicking specialist deep behind the line', () => {
    expect(SPECIAL_PLAYS.punt.players[0].align.z).toBeLessThanOrEqual(-9);
    const kicker = SPECIAL_PLAYS.fieldGoal.players.find((pl) => pl.role === 'BACK');
    expect(kicker?.align.z ?? 0).toBeLessThanOrEqual(-9);
    expect(SPECIAL_PLAYS.kickoff.players[0].align.z).toBeLessThanOrEqual(-6);
  });

  it('keeps special-teams slots clear of the scrimmage playbook', () => {
    for (const p of SPECIAL_OFFENSE) expect(p.page).toBe(3);
    for (const p of SPECIAL_DEFENSE) expect(p.slot).toBeGreaterThan(13);
  });
});

describe('mirroring', () => {
  it('flips a route across the midline and back again', () => {
    const r = OFFENSE_PLAYS[5].players[5].route;
    expect(mirrorRoute(mirrorRoute(r))).toEqual(r);
  });

  it('re-stamps targets so button 0 is still the leftmost receiver', () => {
    for (const p of OFFENSE_PLAYS) {
      const m = mirrorOffensePlay(p);
      expect(validatePlay(m)).toEqual([]);
      const order = eligible(m).slice().sort((a, b) => a.align.x - b.align.x);
      expect(order.map((pl) => pl.target)).toEqual([0, 1, 2]);
    }
  });

  it('swaps the outside man assignments and leaves the middle alone', () => {
    for (const p of DEFENSE_PLAYS) {
      const m = mirrorDefensePlay(p);
      expect(validatePlay(m)).toEqual([]);
      for (let i = 0; i < 7; i++) {
        expect(m.players[i].align.x).toBe(-p.players[i].align.x);
        const a = p.players[i].assign;
        const b = m.players[i].assign;
        if (a.kind === 'MAN' && b.kind === 'MAN') {
          expect(b.slot).toBe(a.slot === 1 ? 1 : 2 - a.slot);
        }
      }
    }
  });

  it('gives the mirrored play a distinct id', () => {
    expect(mirrorOffensePlay(OFFENSE_PLAYS[0]).id).not.toBe(OFFENSE_PLAYS[0].id);
    expect(mirrorDefensePlay(DEFENSE_PLAYS[0]).id).not.toBe(DEFENSE_PLAYS[0].id);
  });
});

describe('diagrams', () => {
  it('renders a non-empty SVG for every play', () => {
    for (const p of ALL) {
      const svg = playDiagramSvg(p);
      expect([p.id, svg.length > 0]).toEqual([p.id, true]);
      expect([p.id, svg.includes('<svg')]).toEqual([p.id, true]);
      expect([p.id, svg.trimEnd().endsWith('</svg>')]).toEqual([p.id, true]);
    }
  });

  it('never emits NaN or undefined into the markup', () => {
    for (const p of ALL) {
      const svg = playDiagramSvg(p, { bg: '#101318' });
      expect([p.id, /NaN|undefined|Infinity/.test(svg)]).toEqual([p.id, false]);
    }
  });

  it('is a pure function of its inputs', () => {
    for (const p of ALL.slice(0, 8)) {
      expect(playDiagramSvg(p)).toBe(playDiagramSvg(p));
    }
  });

  it('honours a custom canvas size', () => {
    const svg = playDiagramSvg(OFFENSE_PLAYS[0], { width: 110, height: 75 });
    expect(svg).toContain('width="110"');
    expect(svg).toContain('height="75"');
  });

  it('escapes the play name in the title', () => {
    const svg = playDiagramSvg({ ...OFFENSE_PLAYS[0], name: 'A & B <x>' });
    expect(svg).toContain('A &amp; B &lt;x&gt;');
  });

  it('survives a malformed play without throwing', () => {
    const junk = { ...OFFENSE_PLAYS[0], players: [] };
    expect(playDiagramSvg(junk)).toContain('<svg');
  });
});
