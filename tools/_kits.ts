import { TEAMS } from '../src/data/index.ts';
import { resolveKits, kitDistance } from '../src/render/kits.ts';
let clashes = 0, fixed = 0, worst = 9, worstPair = '';
for (const h of TEAMS) for (const a of TEAMS) {
  if (h.id === a.id) continue;
  const raw = kitDistance(h.colors.primary, a.colors.secondary);
  if (raw < 0.42) clashes++;
  const k = resolveKits(h, a);
  const d = kitDistance(k.home.primary, k.away.secondary);
  if (k.swapped) fixed++;
  if (d < worst) { worst = d; worstPair = `${h.abbr} vs ${a.abbr}`; }
}
console.log(`pairs=${TEAMS.length * (TEAMS.length - 1)} raw clashes=${clashes} restripped=${fixed}`);
console.log(`worst distance after resolution: ${worst.toFixed(3)} (${worstPair})`);
