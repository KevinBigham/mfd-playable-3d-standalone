/**
 * Mastery drills chooser: six short lessons, one tap each into the practice field with the
 * look, the call, and the spot already set. Rep counts persist per drill — identity only.
 */
import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, FocusRing, driveFocus, button, panel } from '../uiKit.ts';
import type { Game } from '../../app/Game.ts';
import { DRILLS, drillOffense, drillDefense, type Drill } from '../../gameplay/drills.ts';
import { drillRepCount } from '../../progression/progression.ts';

export class DrillsScreen implements Screen {
  name = 'drills';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  constructor(private game: Game) { void this.game; }

  private start(d: Drill): void {
    this.ctx.go('practice', {
      offense: drillOffense(d),
      defense: drillDefense(d),
      yard: d.yard,
      down: d.down,
      routesOnly: d.routesOnly,
      side: 'OFF',
      autoStart: true,
      label: `DRILL · ${d.label}`,
      drillId: d.id,
      returnScreen: 'drills',
    });
  }

  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const s = el('div', 'go-screen');
    s.appendChild(el('div', 'go-dim'));
    const p = panel('MASTERY DRILLS', 'One read per drill. Run it until it is yours — BACK on the field re-arms the same rep.');
    const items: FocusItem[] = [];
    for (const d of DRILLS) {
      const reps = drillRepCount(d.id);
      const it = button(reps > 0 ? `${d.label} · ${reps} REPS` : d.label, () => this.start(d));
      const lesson = el('div', 'muted', d.lesson);
      lesson.style.cssText = 'font-size:12px;letter-spacing:.03em;margin:-6px 0 8px;opacity:.85';
      p.appendChild(it.el);
      p.appendChild(lesson);
      items.push(it);
    }
    items.push(button('BACK', () => { ctx.sound('back'); ctx.back(); }, 'ghost'));
    p.appendChild(items[items.length - 1].el);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set(items);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
  }
  update(): void { driveFocus(this.ring, this.ctx.input, this.ctx); }
  unmount(): void { this.node?.remove(); this.node = null; }
}
