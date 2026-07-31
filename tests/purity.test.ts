import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARCHITECTURE.md §0: the deterministic layers must run identically in Node and the browser.
 * Breaking this silently breaks headless simulation, scenario tests and fixed-seed replay.
 */
const PURE_DIRS = ['src/core', 'src/data', 'src/rules', 'src/plays', 'src/sim', 'src/ai'];
const BANNED = [
  { re: /\bfrom\s+['"]three['"]/, why: 'imports three.js' },
  { re: /\bwindow\./, why: 'touches window' },
  { re: /\bdocument\./, why: 'touches document' },
  { re: /\blocalStorage\b/, why: 'touches localStorage' },
  { re: /\bMath\.random\s*\(/, why: 'uses Math.random (use match.rng)' },
  { re: /\bDate\.now\s*\(/, why: 'uses Date.now' },
  { re: /\bperformance\.now\s*\(/, why: 'uses performance.now' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('deterministic layer purity', () => {
  for (const dir of PURE_DIRS) {
    it(`${dir} stays pure`, () => {
      const problems: string[] = [];
      for (const file of walk(dir)) {
        const src = readFileSync(file, 'utf8');
        const stripped = src
          .split('\n')
          .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
          .join('\n');
        for (const b of BANNED) {
          if (b.re.test(stripped)) problems.push(`${file}: ${b.why}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

describe('no binary art assets', () => {
  it('repository ships no images, models, audio or fonts', () => {
    const bad: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(png|jpe?g|gif|webp|gltf|glb|fbx|obj|wav|mp3|ogg|m4a|ttf|otf|woff2?)$/i.test(p)
                 && !p.includes('docs/captures')) bad.push(p);
      }
    };
    scan('src');
    scan('public');
    expect(bad).toEqual([]);
  });
});
