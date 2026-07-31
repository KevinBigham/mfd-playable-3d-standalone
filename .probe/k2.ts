import * as THREE from 'three';
import { TEAMS } from '../src/data/teams.ts';
import { resolveKits, kitDistance } from '../src/render/kits.ts';
const g = (a:string)=>TEAMS.find(t=>t.abbr===a)!;
const mul=(h:string,s:number)=>'#'+new THREE.Color(h).multiplyScalar(s).getHexString();
function show(hA:string, aA:string){
  const h=g(hA), a=g(aA); const k=resolveKits(h,a);
  const rows = {
    'HOME jersey': k.home.primary,
    'HOME helmet': mul(k.home.primary,1.05),
    'HOME pants ': mul(k.home.secondary,0.92),
    'HOME accent': k.home.accent,
    'AWAY jersey': k.away.secondary,
    'AWAY helmet': mul(k.away.secondary,0.92),
    'AWAY pants ': mul(k.away.primary,0.92),
    'AWAY accent': k.away.accent,
  };
  console.log(`\n=== ${hA} (home) vs ${aA} (away)  swapped=${k.swapped}`);
  for (const [k2,v] of Object.entries(rows)) console.log(' ', k2, v);
  console.log('  jersey vs jersey  d =', kitDistance(rows['HOME jersey'], rows['AWAY jersey']).toFixed(3));
  console.log('  HOMEjersey vs AWAYpants d =', kitDistance(rows['HOME jersey'], rows['AWAY pants ']).toFixed(3));
  console.log('  AWAYjersey vs HOMEpants d =', kitDistance(rows['AWAY jersey'], rows['HOME pants ']).toFixed(3));
  console.log('  badge fill(accent0) vs ink0:', k.home.accent, h.colors.ink, 'd =', kitDistance(k.home.accent, h.colors.ink).toFixed(3));
}
show('IRH','QPM');
// distribution of jersey-vs-jersey distance after resolution
const ds:number[]=[];
for(const h of TEAMS) for(const a of TEAMS){ if(h.id===a.id)continue; const k=resolveKits(h,a); ds.push(kitDistance(k.home.primary,k.away.secondary)); }
ds.sort((x,y)=>x-y);
console.log('\njersey-distance percentiles: min',ds[0].toFixed(3),'p10',ds[Math.floor(ds.length*0.1)].toFixed(3),'median',ds[Math.floor(ds.length/2)].toFixed(3),'max',ds[ds.length-1].toFixed(3));
// badge contrast: every team's accent vs its own ink
console.log('\nbadge fill(accent) vs glyph(ink) contrast per team:');
const bad:string[]=[];
for(const t of TEAMS){ const d=kitDistance(t.colors.accent,t.colors.ink); if(d<0.42) bad.push(`${t.abbr} accent=${t.colors.accent} ink=${t.colors.ink} d=${d.toFixed(3)}`); }
console.log(bad.join('\n')||'none'); console.log('low-contrast badge teams:', bad.length, '/', TEAMS.length);
