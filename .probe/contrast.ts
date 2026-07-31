import { TEAMS } from '../src/data/teams.ts';
const lin=(c:number)=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const L=(hex:string)=>{const n=parseInt(hex.slice(1),16);const r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);};
const ratio=(a:string,b:string)=>{const l1=L(a),l2=L(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);};
console.log('RECEIVER BADGE glyph contrast (WCAG ratio, fill=accent, glyph=ink):');
const rows = TEAMS.map(t=>[t.abbr, t.colors.accent, t.colors.ink, ratio(t.colors.accent,t.colors.ink)] as const)
  .sort((a,b)=>a[3]-b[3]);
for(const r of rows) console.log(`  ${r[0]}  fill ${r[1]}  glyph ${r[2]}  ratio ${r[3].toFixed(2)}:1 ${r[3]<3?'  <-- FAILS WCAG 3:1 for large text':''}`);
console.log('teams below 3:1 =', rows.filter(r=>r[3]<3).length, '/', TEAMS.length);
console.log('teams below 4.5:1 =', rows.filter(r=>r[3]<4.5).length, '/', TEAMS.length);
