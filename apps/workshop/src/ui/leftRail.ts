import { CATALOG, MATERIALS, type Design, type Id } from '@botfoundry/model';
import type { Evaluation } from '@botfoundry/cad';
import { clear, h } from '../dom.ts';
import { DRAG_MIME, DRAG_PREFIX } from '../tools/editTool.ts';
import { structureLabel } from '../state/ops.ts';
import type { Selection, Store } from '../state/store.ts';
import { fmtMass } from './format.ts';

export interface LeftRailHooks {
  addPart(defId: Id): void;
}

/** Component catalog, the bodies of the design, the features of the selected body, sketches and placed parts. */
export class LeftRail {
  private readonly el: HTMLElement;
  private readonly store: Store;
  private readonly hooks: LeftRailHooks;
  private readonly lists: Record<'bodies' | 'features' | 'sketches' | 'parts', HTMLElement>;
  private evaluation: Evaluation | null = null;

  constructor(el: HTMLElement, store: Store, hooks: LeftRailHooks) {
    this.el = el;
    this.store = store;
    this.hooks = hooks;
    const section = (title: string, body: HTMLElement, hint?: string): HTMLElement =>
      h('section', { class: 'sec' }, h('h3', { text: title }), hint ? h('p', { class: 'hint', text: hint }) : null, body);
    this.lists = { bodies: h('div', { class: 'list' }), features: h('div', { class: 'list' }), sketches: h('div', { class: 'list' }), parts: h('div', { class: 'list' }) };
    el.append(
      section('Catalog', this.buildCatalog(), 'Drag onto the robot or the ground. Double-click to add at the origin.'),
      section('Bodies', this.lists.bodies),
      section('Features', this.lists.features),
      section('Sketches', this.lists.sketches),
      section('Placed parts', this.lists.parts),
    );
  }

  private buildCatalog(): HTMLElement {
    const list = h('div', { class: 'list catalog' });
    for (const def of CATALOG) {
      const row = h('div', {
        class: 'row part', draggable: true, title: def.name,
        on: {
          dragstart: (e) => {
            e.dataTransfer?.setData(DRAG_MIME, DRAG_PREFIX + def.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
          },
          dblclick: () => this.hooks.addPart(def.id),
        },
      },
      h('i', { class: `sw cat-${def.category}` }),
      h('span', { class: 'nm', text: def.name }),
      h('span', { class: 'kg', text: fmtMass(def.mass) }));
      list.append(row);
    }
    return list;
  }

  setEvaluation(evaluation: Evaluation | null): void {
    this.evaluation = evaluation;
  }

  render(): void {
    const d = this.store.design;
    const sel = this.store.selection;
    this.renderBodies(d, sel);
    this.renderFeatures(d, sel);
    this.renderSketches(d, sel);
    this.renderParts(d, sel);
  }

  private row(cls: string, selected: boolean, onClick: () => void, ...kids: (Node | null)[]): HTMLElement {
    return h('div', { class: `row ${cls}${selected ? ' sel' : ''}`, on: { click: onClick } }, ...kids);
  }

  private empty(list: HTMLElement, text: string): void {
    list.append(h('p', { class: 'none', text }));
  }

  private renderBodies(d: Design, sel: Selection): void {
    const list = this.lists.bodies;
    clear(list);
    if (d.bodies.length === 0) return this.empty(list, 'None yet. Sketch a plane, then extrude it.');
    for (const b of d.bodies) {
      const ev = this.evaluation?.bodies.find((x) => x.id === b.id);
      const selected = (sel.kind === 'body' && sel.id === b.id) || (sel.kind === 'feature' && sel.body === b.id);
      list.append(this.row('body', selected, () => this.store.select({ kind: 'body', id: b.id }),
        h('i', { class: `sw mat-${b.material}` }),
        h('span', { class: 'nm' }, h('b', { text: b.name }), h('small', { text: `${MATERIALS[b.material]?.name ?? b.material} · ${structureLabel(b.structure)}` })),
        ev && ev.errors.length > 0 ? h('span', { class: 'warn', title: ev.errors.join('\n'), text: '!' }) : null,
        h('span', { class: 'kg', text: ev ? fmtMass(ev.mass.mass) : '' })));
    }
  }

  private renderFeatures(d: Design, sel: Selection): void {
    const list = this.lists.features;
    clear(list);
    const bodyId = sel.kind === 'body' ? sel.id : sel.kind === 'feature' ? sel.body : null;
    const body = d.bodies.find((b) => b.id === bodyId);
    if (!body) return this.empty(list, 'Select a body to see its feature tree.');
    body.features.forEach((f, i) => {
      const what =
        f.kind === 'extrude' ? `Extrude ${+(Math.abs(f.distance) * 1000).toFixed(2)} mm` :
        f.kind === 'revolve' ? `Revolve ${+((f.angle * 180) / Math.PI).toFixed(1)}°` :
        f.kind === 'carve' ? `Carve ${d.components.find((c) => c.id === f.component)?.name ?? f.component}` :
        f.kind === 'mirror' ? 'Mirror' : `Pattern ×${f.count}`;
      const op = 'op' in f ? f.op : f.kind === 'carve' ? 'subtract' : 'add';
      list.append(this.row('feat', sel.kind === 'feature' && sel.id === f.id, () => this.store.select({ kind: 'feature', body: body.id, id: f.id }),
        h('span', { class: 'idx', text: String(i + 1) }),
        h('span', { class: 'nm', text: what }),
        h('span', { class: `op op-${op}`, text: op })));
    });
  }

  private renderSketches(d: Design, sel: Selection): void {
    const list = this.lists.sketches;
    clear(list);
    if (d.sketches.length === 0) return this.empty(list, 'None yet.');
    for (const s of d.sketches) {
      const loops = s.profiles.reduce((n, p) => n + 1 + p.holes.length, 0);
      list.append(this.row('sketch', sel.kind === 'sketch' && sel.id === s.id, () => this.store.select({ kind: 'sketch', id: s.id }),
        h('span', { class: 'nm' }, h('b', { text: s.name }), h('small', { text: `${s.profiles.length} profile${s.profiles.length === 1 ? '' : 's'}, ${loops} loop${loops === 1 ? '' : 's'}` }))));
    }
  }

  private renderParts(d: Design, sel: Selection): void {
    const list = this.lists.parts;
    clear(list);
    if (d.components.length === 0) return this.empty(list, 'None yet.');
    for (const c of d.components) {
      const def = CATALOG.find((x) => x.id === c.def);
      const ev = this.evaluation?.components.find((x) => x.id === c.id);
      const carved = d.bodies.some((b) => b.features.some((f) => f.kind === 'carve' && f.component === c.id));
      list.append(this.row('placed', sel.kind === 'component' && sel.id === c.id, () => this.store.select({ kind: 'component', id: c.id }),
        h('i', { class: `sw cat-${def?.category ?? 'sensor'}` }),
        h('span', { class: 'nm' }, h('b', { text: c.name ?? c.id }), h('small', { text: carved ? 'carved' : 'not carved' })),
        ev && ev.collidesWith.length > 0 ? h('span', { class: 'warn', title: `Overlaps ${ev.collidesWith.join(', ')} without a carve`, text: '!' }) : null));
    }
  }
}
