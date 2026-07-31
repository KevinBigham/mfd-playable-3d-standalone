import { startServer, stopServer, launch } from '../tools/browser.ts';
import { mkdirSync } from 'node:fs';
mkdirSync('/tmp/shots2',{recursive:true});
async function main(){
  const url=await startServer(4191);
  const h=await launch(url,{width:1440,height:810});
  const {page}=h;
  await page.waitForTimeout(1200);
  // FONT check
  const fonts = await page.evaluate(()=>{
    const c=document.createElement('canvas').getContext('2d')!;
    const t='GRIDIRON OVERDRIVE 88';
    c.font='64px monospace'; const mono=c.measureText(t).width;
    const out:Record<string,number>={};
    for(const f of ['Impact','Haettenschweiler','"Arial Narrow Bold"','"Arial Narrow"','system-ui','sans-serif','serif','monospace']){ c.font=`64px ${f}, monospace`; out[f]=c.measureText(t).width; }
    const btn=document.querySelector('.go-btn')||document.querySelector('.go-title')||document.body;
    return { widths: out, monoBaseline: mono,
      resolvedTitleFont: getComputedStyle(document.documentElement).fontFamily,
      docFonts: (document as any).fonts ? (document as any).fonts.size : -1,
      impactSupported: (document as any).fonts?.check?.('64px Impact') ?? null,
      arialNarrowSupported: (document as any).fonts?.check?.('64px "Arial Narrow"') ?? null,
    };
  });
  console.log('FONTS', JSON.stringify(fonts,null,1));
  // CPU-vs-CPU match run to completion, then screenshot the end state
  await page.evaluate(()=>{(window as any).GO.reset('match',{config:{seed:909090,quarterSeconds:60,difficulty:'ALLSTAR',weather:'CLEAR',
    seats:[{side:0,active:false},{side:1,active:false},{side:0,active:false},{side:1,active:false}],mode:'QUICKPLAY'},returnScreen:'mainMenu'});});
  await page.waitForTimeout(2500);
  const fin = await page.evaluate(()=>{const m=(window as any).GO.match; let t=0; while(m&&!m.state.finished&&t<60*60*40){m.tick();t++;} return {t, finished:m.state.finished, q:m.state.quarter, h:m.state.teams[0].score, a:m.state.teams[1].score};});
  console.log('finish:', JSON.stringify(fin));
  for (const w of [1,3,6,10]) {
    await page.waitForTimeout(w*1000 - (w>1?(w-1)*1000:0));
    const s = await page.evaluate(()=>({screen:(window as any).GO.currentScreen, hudVisible: (document.getElementById('hud') as HTMLElement)?.style.display, uiKids:[...document.getElementById('ui-root')!.children].map(c=>c.className||c.id)}));
    console.log(`t+${w}s`, JSON.stringify(s));
  }
  await page.evaluate(()=>{const g=(window as any).GO; try{g.renderer.render();}catch{} g.stop();});
  await page.waitForTimeout(250);
  await page.screenshot({path:'/tmp/shots2/final-real.png',timeout:60000});
  console.log('errors', JSON.stringify(h.errors.slice(0,5)));
  await h.close(); stopServer(); process.exit(0);
}
main().catch(e=>{console.error(e);stopServer();process.exit(1);});
