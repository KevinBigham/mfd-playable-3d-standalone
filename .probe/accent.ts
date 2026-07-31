import { TEAMS } from '../src/data/teams.ts';
import { resolveKits, kitDistance } from '../src/render/kits.ts';
let bad=0, tot=0; const w:any[]=[];
for(const h of TEAMS) for(const a of TEAMS){ if(h.id===a.id)continue; tot++;
  const k=resolveKits(h,a);
  const d=kitDistance(k.home.accent, k.away.accent);   // athleteRig:143 accent = colors.accent, never re-resolved
  if(d<0.42){bad++; w.push([h.abbr,a.abbr,k.home.accent,k.away.accent,+d.toFixed(3),k.swapped]);}
}
w.sort((x,y)=>x[4]-y[4]);
console.log(`ACCENT-vs-ACCENT clashes (never checked by resolveKits): ${bad}/${tot} = ${(100*bad/tot).toFixed(0)}%`);
console.log(w.slice(0,14).map(r=>r.join('  ')).join('\n'));
const irh=TEAMS.find(t=>t.abbr==='IRH')!, qpm=TEAMS.find(t=>t.abbr==='QPM')!;
console.log('\nIRH vs QPM accent d =', kitDistance(irh.colors.accent,qpm.colors.accent).toFixed(3), irh.colors.accent, qpm.colors.accent);
// projected areas, broadcast camera looking down
const build=0.5, bulk=0.86+(1.32-0.86)*build, shoulderW=(0.52+0.2*build)*bulk;
const parts:[string,string,number,number][] = [
  ['accent shoulder trim','accent', shoulderW*2.32*0.92, 0.54*bulk],
  ['shoulder pads (jersey)','jersey', shoulderW*2.32, 0.52*bulk],
  ['torso (jersey)','jersey', 0.66*bulk, 0.44*bulk],
  ['helmet (top)','helmet', 0.60*1.06, 0.60*1.12],
];
console.log('\nTOP-DOWN projected area of each coloured part (yd^2):');
for(const [n,role,a,b] of parts) console.log(`  ${n.padEnd(24)} ${role.padEnd(7)} ${(a*b).toFixed(3)}`);
console.log('  -> accent trim covers the pads and is the largest single flat plate seen from a raised camera.');
