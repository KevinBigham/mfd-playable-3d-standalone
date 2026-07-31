import { TEAMS } from '/home/claude/gridiron-overdrive/src/data/teams.ts';
import { resolveKits, kitDistance } from '/home/claude/gridiron-overdrive/src/render/kits.ts';
console.log('teams:', TEAMS.length);
let clash = 0, total = 0; const worst: any[] = [];
for (const h of TEAMS) for (const a of TEAMS) {
  if (h.id === a.id) continue;
  total++;
  const k = resolveKits(h, a);
  const homeJersey = k.home.primary;       // athleteRig:138 away=false -> primary
  const awayJersey = k.away.secondary;     // athleteRig:138 away=true  -> secondary
  const d = kitDistance(homeJersey, awayJersey);
  if (d < 0.42) { clash++; worst.push([h.abbr, a.abbr, homeJersey, awayJersey, +d.toFixed(3), k.swapped]); }
}
worst.sort((x,y)=>x[4]-y[4]);
console.log(`JERSEY clashes AFTER resolveKits: ${clash}/${total}`);
console.log(worst.slice(0,12).map(w=>w.join('  ')).join('\n'));

// HELMET: home = primary*1.05, away = secondary*0.92 (athleteRig:142)
import * as THREE from 'three';
const mul = (hex:string,s:number)=>'#'+new THREE.Color(hex).multiplyScalar(s).getHexString();
let hc=0; const hw:any[]=[];
for (const h of TEAMS) for (const a of TEAMS) {
  if (h.id===a.id) continue;
  const k = resolveKits(h,a);
  const d = kitDistance(mul(k.home.primary,1.05), mul(k.away.secondary,0.92));
  if (d < 0.42) { hc++; hw.push([h.abbr,a.abbr,+d.toFixed(3)]); }
}
console.log(`\nHELMET clashes: ${hc}/${total}`);

// PANTS of away (=k.away.primary*0.92) vs home JERSEY (=k.home.primary)
let pc=0; const pw:any[]=[];
for (const h of TEAMS) for (const a of TEAMS) {
  if (h.id===a.id) continue;
  const k = resolveKits(h,a);
  const d = kitDistance(k.home.primary, mul(k.away.primary,0.92));
  if (d < 0.42) { pc++; pw.push([h.abbr,a.abbr,k.home.primary,mul(k.away.primary,0.92),+d.toFixed(3),k.swapped]); }
}
pw.sort((x,y)=>x[4]-y[4]);
console.log(`AWAY-PANTS vs HOME-JERSEY clashes: ${pc}/${total}`);
console.log(pw.slice(0,12).map(w=>w.join('  ')).join('\n'));

// how many swaps happened
let sw=0; for (const h of TEAMS) for (const a of TEAMS){ if(h.id===a.id)continue; if(resolveKits(h,a).swapped) sw++; }
console.log(`\nswapped: ${sw}/${total}`);
