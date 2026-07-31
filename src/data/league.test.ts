/**
 * League integrity + IP-safety tests.
 *
 * This suite is the guard rail on the most legally sensitive data in the project.
 * If it fails, the league is either broken or has drifted toward something real.
 */

import { describe, it, expect } from 'vitest';
import { Rng, hashSeed } from '../core/rng.ts';
import type { PlayerDef, TeamDef } from '../core/types.ts';
import { TEAMS, TEAM_IDS, CONFERENCES, getTeam, conferenceOf, teamRating } from './teams.ts';
import { STADIUMS, STADIUM_IDS, NEUTRAL_SITE_IDS, getStadium } from './stadiums.ts';
import { LOGO_KEYS, teamLogoSvg, teamWordmarkSvg, logoDataUrl } from './logoGen.ts';
import { makeRoster, ROSTER_SIZE, KICKER_SLOT, KICKER_POS } from './names.ts';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Real-world nicknames this league must never use. Written out explicitly so the check
 * is auditable rather than vibes-based.
 */
const BANNED_NICKNAMES: readonly string[] = [
  'Cowboys', 'Packers', 'Patriots', 'Chiefs', 'Eagles', 'Steelers', 'Bears', 'Giants',
  'Jets', 'Ravens', 'Bengals', 'Browns', 'Texans', 'Colts', 'Jaguars', 'Titans',
  'Broncos', 'Chargers', 'Raiders', 'Dolphins', 'Bills', 'Vikings', 'Lions', 'Falcons',
  'Panthers', 'Saints', 'Buccaneers', 'Cardinals', 'Rams', '49ers', 'Seahawks',
  'Commanders', 'Redskins',
];

/** Words that must never reach a player's eyes anywhere in this league. */
const BANNED_WORDS: readonly string[] = ['nfl', 'nflpa', 'blitz', 'midway', 'nintendo', 'madden'];

function allTeamStrings(t: TeamDef): string[] {
  return [t.id, t.city, t.name, t.abbr, t.blurb, t.logo, t.stadium];
}

describe('league size and identity', () => {
  it('has exactly 16 teams', () => {
    expect(TEAMS.length).toBe(16);
    expect(TEAM_IDS.length).toBe(16);
  });

  it('has unique team ids', () => {
    expect(new Set(TEAMS.map((t) => t.id)).size).toBe(16);
  });

  it('has unique abbreviations, 2-3 uppercase characters', () => {
    expect(new Set(TEAMS.map((t) => t.abbr)).size).toBe(16);
    for (const t of TEAMS) expect(t.abbr).toMatch(/^[A-Z]{2,3}$/);
  });

  it('has unique city + nickname pairs and kebab-case ids', () => {
    expect(new Set(TEAMS.map((t) => `${t.city} ${t.name}`)).size).toBe(16);
    for (const t of TEAMS) expect(t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('getTeam resolves every id and throws on an unknown one', () => {
    for (const id of TEAM_IDS) expect(getTeam(id).id).toBe(id);
    expect(() => getTeam('no-such-team')).toThrow();
  });

  it('splits into two invented 8-team conferences covering the league exactly once', () => {
    expect(CONFERENCES.length).toBe(2);
    const seen: string[] = [];
    for (const c of CONFERENCES) {
      expect(c.teamIds.length).toBe(8);
      expect(c.name.length).toBeGreaterThan(3);
      for (const id of c.teamIds) {
        expect(TEAM_IDS).toContain(id);
        seen.push(id);
      }
    }
    expect(new Set(seen).size).toBe(16);
    for (const t of TEAMS) expect(conferenceOf(t.id)).not.toBeNull();
  });
});

describe('IP safety', () => {
  it('uses no real league nickname', () => {
    for (const t of TEAMS) {
      const hay = `${t.city} ${t.name}`.toLowerCase();
      for (const banned of BANNED_NICKNAMES) {
        expect(t.name.toLowerCase()).not.toBe(banned.toLowerCase());
        expect(hay).not.toContain(banned.toLowerCase());
      }
    }
  });

  it('uses no banned word in any user-facing team or venue string', () => {
    const haystack: string[] = [];
    for (const t of TEAMS) haystack.push(...allTeamStrings(t));
    for (const s of STADIUMS) haystack.push(s.id, s.name, s.city);
    for (const c of CONFERENCES) haystack.push(c.name);
    for (const text of haystack) {
      for (const w of BANNED_WORDS) expect(text.toLowerCase()).not.toContain(w);
    }
  });

  it('generates no logo or wordmark markup containing NFL or the B-word', () => {
    for (const t of TEAMS) {
      const svg = teamLogoSvg(t);
      const mark = teamWordmarkSvg(t);
      expect(svg).not.toContain('NFL');
      expect(svg).not.toContain('Blitz');
      expect(svg.toLowerCase()).not.toContain('blitz');
      expect(mark).not.toContain('NFL');
      expect(mark.toLowerCase()).not.toContain('blitz');
    }
  });

  it('keeps blurbs short, present, and clean', () => {
    for (const t of TEAMS) {
      expect(t.blurb.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeLessThanOrEqual(70);
    }
  });
});

describe('colours', () => {
  it('are valid 6-digit hex everywhere', () => {
    for (const t of TEAMS) {
      const c = t.colors;
      for (const v of [c.primary, c.secondary, c.accent, c.ink, c.endzone]) {
        expect(v).toMatch(HEX);
      }
    }
    for (const s of STADIUMS) {
      expect(s.crowdTint).toMatch(HEX);
      expect(s.accent).toMatch(HEX);
    }
  });

  it('gives every team a distinct primary colour', () => {
    const primaries = TEAMS.map((t) => t.colors.primary.toLowerCase());
    expect(new Set(primaries).size).toBe(16);
  });

  it('spreads primaries across lightness, not just hue', () => {
    const lum = (hex: string): number => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ls = TEAMS.map((t) => lum(t.colors.primary));
    expect(Math.min(...ls)).toBeLessThan(0.14);
    expect(Math.max(...ls)).toBeGreaterThan(0.85);
    // Dark / mid / light bands must all be well populated, so the league stays
    // separable for players who cannot rely on hue alone.
    expect(ls.filter((l) => l < 0.25).length).toBeGreaterThanOrEqual(4);
    expect(ls.filter((l) => l >= 0.25 && l <= 0.6).length).toBeGreaterThanOrEqual(4);
    expect(ls.filter((l) => l > 0.6).length).toBeGreaterThanOrEqual(4);
    // No two primaries sit on top of each other in lightness AND hue.
    const sorted = [...ls].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeLessThan(0.25);
  });

  it('keeps ink readable against primary', () => {
    const lum = (hex: string): number => {
      const ch = (i: number): number => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
    };
    for (const t of TEAMS) {
      const a = lum(t.colors.ink);
      const b = lum(t.colors.primary);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(ratio).toBeGreaterThan(4.5);
    }
  });
});

describe('stadiums', () => {
  it('has one venue per team plus two neutral sites', () => {
    expect(STADIUMS.length).toBe(18);
    expect(new Set(STADIUM_IDS).size).toBe(18);
    expect(NEUTRAL_SITE_IDS.length).toBe(2);
    for (const id of NEUTRAL_SITE_IDS) expect(STADIUM_IDS).toContain(id);
  });

  it('resolves every team home stadium, one per club', () => {
    const homes = new Set<string>();
    for (const t of TEAMS) {
      const v = getStadium(t.stadium);
      expect(v.id).toBe(t.stadium);
      expect(v.city).toBe(t.city);
      homes.add(v.id);
    }
    expect(homes.size).toBe(16);
    expect(() => getStadium('no-such-venue')).toThrow();
  });

  it('varies roof, surface, tier and sky', () => {
    expect(new Set(STADIUMS.map((s) => s.roof)).size).toBe(3);
    expect(new Set(STADIUMS.map((s) => s.tier)).size).toBe(3);
    expect(new Set(STADIUMS.map((s) => s.surface)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(STADIUMS.map((s) => s.skyKind)).size).toBe(4);
  });
});

describe('rosters', () => {
  const numbersOf = (r: readonly PlayerDef[]): number[] => r.map((p) => p.number);

  it('gives every team at least 15 athletes with unique jersey numbers', () => {
    for (const t of TEAMS) {
      expect(t.roster.length).toBeGreaterThanOrEqual(15);
      const nums = numbersOf(t.roster);
      expect(new Set(nums).size).toBe(nums.length);
      for (const n of nums) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(99);
      }
    }
  });

  it('holds the fixed slot order', () => {
    for (const t of TEAMS) {
      const r = t.roster;
      expect(r.length).toBe(ROSTER_SIZE);
      expect(r[0].pos).toBe('QB');
      for (let i = 1; i <= 3; i++) expect(['WR', 'RB', 'TE']).toContain(r[i].pos);
      for (let i = 4; i <= 6; i++) expect(r[i].pos).toBe('OL');
      for (let i = 7; i <= 9; i++) expect(['DL', 'LB']).toContain(r[i].pos);
      for (let i = 10; i <= 13; i++) expect(['CB', 'S']).toContain(r[i].pos);
      expect(r[KICKER_SLOT].pos).toBe(KICKER_POS);
      expect(r[KICKER_SLOT].ratings.accuracy).toBeGreaterThanOrEqual(60);
    }
  });

  it('keeps jersey numbers position-plausible', () => {
    for (const t of TEAMS) {
      t.roster.forEach((p, i) => {
        const n = p.number;
        if (i === KICKER_SLOT) { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(9); return; }
        switch (p.pos) {
          case 'QB': expect(n >= 1 && n <= 19).toBe(true); break;
          case 'WR': expect((n >= 10 && n <= 19) || (n >= 80 && n <= 89)).toBe(true); break;
          case 'TE': expect((n >= 40 && n <= 49) || (n >= 80 && n <= 89)).toBe(true); break;
          case 'RB': expect(n >= 20 && n <= 49).toBe(true); break;
          case 'OL': expect(n >= 50 && n <= 79).toBe(true); break;
          case 'DL': expect(n >= 90 && n <= 99).toBe(true); break;
          case 'LB': expect(n >= 40 && n <= 59).toBe(true); break;
          case 'CB': case 'S': expect(n >= 20 && n <= 49).toBe(true); break;
        }
      });
    }
  });

  it('keeps every rating, build, tone and flair inside contract range', () => {
    for (const t of TEAMS) {
      for (const p of t.roster) {
        for (const v of Object.values(p.ratings)) {
          expect(v).toBeGreaterThanOrEqual(40);
          expect(v).toBeLessThanOrEqual(97);
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(p.build).toBeGreaterThanOrEqual(0);
        expect(p.build).toBeLessThanOrEqual(1);
        expect(p.tone).toBeGreaterThanOrEqual(0);
        expect(p.tone).toBeLessThanOrEqual(1);
        expect(p.flair).toBeGreaterThanOrEqual(0);
        expect(p.flair).toBeLessThanOrEqual(5);
        expect(Number.isInteger(p.flair)).toBe(true);
        expect(p.name.trim().length).toBeGreaterThan(2);
      }
    }
  });

  it('gives linemen heavy builds and skill athletes light ones', () => {
    for (const t of TEAMS) {
      for (const p of t.roster) {
        if (p.pos === 'OL' || p.pos === 'DL') expect(p.build).toBeGreaterThan(0.7);
        if (p.pos === 'CB') expect(p.build).toBeLessThan(0.4);
      }
    }
  });

  it('spreads skin tones instead of clustering them', () => {
    for (const t of TEAMS) {
      const tones = t.roster.map((p) => p.tone).sort((a, b) => a - b);
      expect(tones[0]).toBeLessThan(0.2);
      expect(tones[tones.length - 1]).toBeGreaterThan(0.8);
      const low = tones.filter((v) => v < 0.34).length;
      const mid = tones.filter((v) => v >= 0.34 && v < 0.67).length;
      const high = tones.filter((v) => v >= 0.67).length;
      expect(Math.min(low, mid, high)).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses unique names inside a roster', () => {
    for (const t of TEAMS) {
      expect(new Set(t.roster.map((p) => p.name)).size).toBe(t.roster.length);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = makeRoster('probe', 'BALANCED', new Rng(hashSeed('probe')));
    const b = makeRoster('probe', 'BALANCED', new Rng(hashSeed('probe')));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = makeRoster('probe', 'BALANCED', new Rng(hashSeed('other')));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('builds a valid roster for every style', () => {
    const styles = ['AIR', 'GROUND', 'BALANCED', 'PRESSURE', 'COVERAGE', 'CHAOS'] as const;
    for (const style of styles) {
      const r = makeRoster(`x-${style}`, style, new Rng(hashSeed(style)));
      expect(r.length).toBe(ROSTER_SIZE);
      expect(new Set(r.map((p) => p.number)).size).toBe(ROSTER_SIZE);
    }
  });
});

describe('team power', () => {
  it('stays inside 40..95', () => {
    for (const t of TEAMS) {
      for (const v of Object.values(t.power)) {
        expect(v).toBeGreaterThanOrEqual(40);
        expect(v).toBeLessThanOrEqual(95);
      }
    }
  });

  it('lets no team be best at everything', () => {
    const cats = ['passing', 'running', 'line', 'coverage', 'special'] as const;
    for (const t of TEAMS) {
      const bests = cats.filter((c) => TEAMS.every((o) => o.power[c] <= t.power[c]));
      expect(bests.length).toBeLessThanOrEqual(2);
      // Somebody beats this team at something.
      expect(TEAMS.some((o) => cats.some((c) => o.power[c] > t.power[c]))).toBe(true);
    }
  });

  it('covers the intended spread of identities', () => {
    const styles = TEAMS.map((t) => t.style);
    expect(styles.filter((s) => s === 'AIR').length).toBeGreaterThanOrEqual(2);
    expect(styles.filter((s) => s === 'GROUND').length).toBeGreaterThanOrEqual(2);
    expect(styles.filter((s) => s === 'COVERAGE').length).toBeGreaterThanOrEqual(1);
    expect(styles.filter((s) => s === 'CHAOS').length).toBeGreaterThanOrEqual(1);
    expect(styles.filter((s) => s === 'BALANCED').length).toBeGreaterThanOrEqual(3);

    // Glass cannons: elite passing, soft trenches or coverage.
    const cannons = TEAMS.filter((t) => t.power.passing >= 90 && Math.min(t.power.line, t.power.coverage) <= 55);
    expect(cannons.length).toBeGreaterThanOrEqual(2);
    // Maulers: elite line and running, mediocre passing.
    const maulers = TEAMS.filter((t) => t.power.line >= 90 && t.power.running >= 85 && t.power.passing <= 65);
    expect(maulers.length).toBeGreaterThanOrEqual(2);

    // No two teams are statistical clones.
    const fingerprints = TEAMS.map((t) => Object.values(t.power).join(','));
    expect(new Set(fingerprints).size).toBe(16);
    // Overall strength is close enough that no club is unplayable.
    const ratings = TEAMS.map(teamRating);
    expect(Math.max(...ratings) - Math.min(...ratings)).toBeLessThanOrEqual(22);
  });
});

describe('logos', () => {
  it('gives every team a distinct emblem archetype from the catalogue', () => {
    const keys = TEAMS.map((t) => t.logo);
    expect(new Set(keys).size).toBe(16);
    for (const k of keys) expect(LOGO_KEYS as readonly string[]).toContain(k);
    expect(LOGO_KEYS.length).toBe(16);
  });

  it('emits a standalone svg document carrying the team colours', () => {
    for (const t of TEAMS) {
      const svg = teamLogoSvg(t);
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox="0 0 128 128"');
      expect(svg).toContain(t.colors.primary);
      expect(svg).toContain(t.colors.secondary);
      // No external references of any kind.
      expect(svg).not.toContain('<image');
      expect(svg).not.toContain('http://www.w3.org/1999/xlink');
      expect(svg).not.toMatch(/url\((?!#)/);
      expect(svg).not.toContain('@font-face');
      expect(svg.length).toBeGreaterThan(300);
      // Balanced tag count is a cheap well-formedness smoke test.
      expect((svg.match(/</g) ?? []).length).toBe((svg.match(/>/g) ?? []).length);
    }
  });

  it('honours the size argument and stays pure', () => {
    const t = TEAMS[0];
    expect(teamLogoSvg(t, 64)).toContain('width="64"');
    expect(teamLogoSvg(t, 64)).toContain('height="64"');
    expect(teamLogoSvg(t)).toBe(teamLogoSvg(t));
    expect(teamLogoSvg(t, 64)).not.toBe(teamLogoSvg(t, 128));
  });

  it('produces visually different markup for every archetype', () => {
    const bodies = TEAMS.map((t) => teamLogoSvg(t).replace(/#[0-9a-fA-F]{6}/g, '').replace(/aria-label="[^"]*"/, ''));
    expect(new Set(bodies).size).toBe(16);
  });

  it('renders a wordmark with a generic font stack only', () => {
    for (const t of TEAMS) {
      const w = teamWordmarkSvg(t);
      expect(w.startsWith('<svg ')).toBe(true);
      expect(w).toContain('<text');
      expect(w).toContain('Impact');
      expect(w).toContain('sans-serif');
      expect(w).toContain(t.name.toUpperCase());
      expect(w).toContain('skewX');
    }
  });

  it('round-trips through logoDataUrl without base64', () => {
    const svg = teamLogoSvg(TEAMS[3]);
    const url = logoDataUrl(svg);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toContain('base64');
    expect(decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length))).toBe(svg);
  });
});
