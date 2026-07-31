/* Minimal DOM good enough to exercise the season screen's render paths. */
class N {
  tagName: string; className = ''; children: N[] = []; parent: N | null = null;
  style: Record<string, string> = {}; innerHTML = ''; type = ''; private _text = '';
  classList = {
    add: (c: string) => { if (!this.className.split(' ').includes(c)) this.className = (this.className + ' ' + c).trim(); },
    toggle: (c: string, on?: boolean) => { if (on) this.classList.add(c); else this.className = this.className.split(' ').filter((x) => x !== c).join(' '); },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this._text || this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this._text = String(v); this.children = []; }
  get firstChild(): N | null { return this.children[0] ?? null; }
  get firstElementChild(): N | null { return this.children[0] ?? null; }
  appendChild(c: N): N { c.parent = this; this.children.push(c); return c; }
  append(...cs: N[]): void { for (const c of cs) this.appendChild(c); }
  removeChild(c: N): N { this.children = this.children.filter((x) => x !== c); return c; }
  remove(): void { this.parent?.removeChild(this); this.parent = null; }
  addEventListener(): void {}
  removeEventListener(): void {}
  setAttribute(): void {}
  scrollIntoView(): void {}
  querySelector(): N | null { return null; }
  querySelectorAll(): N[] { return []; }
  get outerText(): string { return this.textContent; }
}
const doc = {
  createElement: (t: string) => new N(t),
  documentElement: new N('html'),
  fullscreenElement: null,
  addEventListener() {}, removeEventListener() {},
};
(globalThis as unknown as { document: unknown }).document = doc;
(globalThis as unknown as { window: unknown }).window = { addEventListener() {}, removeEventListener() {} };
export { N };
