import { CATALOG, MATERIALS, type Design, type Id, type MaterialId, type Quat, type Sketch, type V2, type V3 } from '@botfoundry/model';
import type { Evaluation } from '@botfoundry/cad';
import { axisName } from '../geom/plane.ts';
import { eulerToQuat, quatToEuler } from '../math.ts';
import { button, checkField, clear, FieldSet, h, liveText, numberField, selectField, textField } from '../dom.ts';
import { carvedBodies, removeBody, removeComponent, removeFeature, removeSketch, structureLabel, updateBody, updateComponent, updateFeature, updateSketch } from '../state/ops.ts';
import type { Store } from '../state/store.ts';
import { axisLabel } from './featureDialog.ts';
import type { FeatureKind } from './featureDraft.ts';
import { fmtMass } from './format.ts';

export interface InspectorHooks {
  openFeatureDialog(sketchId: Id, kind: FeatureKind): void;
  pickAxis(sketch: Sketch, done: (axis: { origin: V2; direction: V2 }) => void, cancelled?: () => void): void;
  setCarve(componentId: Id, on: boolean): void;
  carveColliding(componentId: Id): void;
}

const RAD = 180 / Math.PI;

/**
 * Edits whatever is selected. The panel is rebuilt only when the selection (or the shape of the
 * selected thing) changes; after ordinary edits the existing fields just refresh their values, so
 * typing and tabbing between fields is never interrupted.
 */
export class Inspector {
  private readonly el: HTMLElement;
  private readonly store: Store;
  private readonly hooks: InspectorHooks;
  private fields = new FieldSet();
  private key = '';
  private evaluation: Evaluation | null = null;

  constructor(el: HTMLElement, store: Store, hooks: InspectorHooks) {
    this.el = el;
    this.store = store;
    this.hooks = hooks;
  }

  setEvaluation(ev: Evaluation | null): void {
    this.evaluation = ev;
  }

  render(): void {
    const key = this.structureKey();
    if (key === this.key) return this.fields.refresh();
    this.key = key;
    this.fields = new FieldSet();
    clear(this.el);
    this.el.append(h('h3', { text: 'Inspector' }), this.build());
  }

  private structureKey(): string {
    const d = this.store.design, sel = this.store.selection;
    switch (sel.kind) {
      case 'body': {
        const b = d.bodies.find((x) => x.id === sel.id);
        return `body:${sel.id}:${b?.structure.kind}`;
      }
      case 'feature': {
        const f = d.bodies.find((x) => x.id === sel.body)?.features.find((x) => x.id === sel.id);
        return `feature:${sel.id}:${f?.kind}:${f && 'op' in f ? f.op : ''}`;
      }
      case 'component': return `component:${sel.id}:${d.bodies.map((b) => b.id).join(',')}`;
      default: return JSON.stringify(sel);
    }
  }

  private build(): HTMLElement {
    const sel = this.store.selection;
    switch (sel.kind) {
      case 'none': return this.buildHelp();
      case 'body': return this.buildBody(sel.id);
      case 'component': return this.buildComponent(sel.id);
      case 'sketch': return this.buildSketch(sel.id);
      case 'feature': return this.buildFeature(sel.body, sel.id);
    }
  }

  // ----- pieces ---------------------------------------------------------------------------

  private title(kind: string, name: string): HTMLElement {
    return h('div', { class: 'ptitle' }, h('small', { text: kind }), h('span', { text: name }));
  }

  private danger(label: string, onClick: () => void): HTMLElement {
    return h('div', { class: 'actions' }, button(label, onClick, 'danger'));
  }

  private triple(fs: FieldSet, labels: [string, string, string], get: (i: number) => number, set: (i: number, v: number) => void, scale: number, unit: string): HTMLElement {
    return h('div', { class: 'row3' }, ...[0, 1, 2].map((i) => numberField(fs, labels[i] as string, () => get(i), (v) => set(i, v), { scale, unit, digits: 2 })));
  }

  // ----- selections -----------------------------------------------------------------------

  private buildHelp(): HTMLElement {
    return h('div', { class: 'help' },
      h('p', { text: 'Select a body, part, sketch or feature to edit it.' }),
      h('ul', null,
        h('li', {}, 'Start with ', h('b', { text: 'New sketch' }), ' in the top bar: pick a plane, draw a closed outline, finish, then extrude or revolve it.'),
        h('li', {}, 'Drag parts from the catalog onto the robot. Turn on ', h('b', { text: 'Carve' }), ' on a part to cut its keep-out and mounting holes out of the bodies it touches.'),
        h('li', {}, h('kbd', { text: 'W' }), ' move, ', h('kbd', { text: 'E' }), ' rotate, ', h('kbd', { text: 'Del' }), ' remove, ', h('kbd', { text: 'Ctrl/Cmd+Z' }), ' undo, ', h('kbd', { text: 'Shift+Ctrl/Cmd+Z' }), ' redo.'),
      ),
    );
  }

  private buildBody(id: Id): HTMLElement {
    const fs = this.fields;
    const get = (): Design['bodies'][number] | undefined => this.store.design.bodies.find((b) => b.id === id);
    const b = get();
    if (!b) return h('div');
    const edit = (patch: Parameters<typeof updateBody>[2]): void => this.store.commit((d) => updateBody(d, id, patch));
    const out: (HTMLElement | null)[] = [
      this.title('Body', b.name),
      textField(fs, 'Name', () => get()?.name ?? '', (v) => edit({ name: v })),
      selectField(fs, 'Material', (Object.keys(MATERIALS) as MaterialId[]).map((m) => ({ value: m, label: MATERIALS[m].name })), () => get()?.material ?? 'al6061', (v) => edit({ material: v as MaterialId })),
      selectField(fs, 'Structure', [{ value: 'plate', label: 'Plate' }, { value: 'billet', label: 'Billet' }, { value: 'tube', label: 'Tube' }], () => get()?.structure.kind ?? 'billet', (v) => {
        edit({ structure: v === 'plate' ? { kind: 'plate', thickness: 0.006 } : v === 'tube' ? { kind: 'tube', wall: 0.002 } : { kind: 'billet' } });
      }),
    ];
    if (b.structure.kind === 'plate') {
      out.push(numberField(fs, 'Thickness', () => { const s = get()?.structure; return s?.kind === 'plate' ? s.thickness : 0; }, (v) => edit({ structure: { kind: 'plate', thickness: v } }), { scale: 1000, unit: 'mm', min: 0.1 }));
    } else if (b.structure.kind === 'tube') {
      out.push(numberField(fs, 'Wall', () => { const s = get()?.structure; return s?.kind === 'tube' ? s.wall : 0; }, (v) => edit({ structure: { kind: 'tube', wall: v } }), { scale: 1000, unit: 'mm', min: 0.1 }));
    }
    out.push(
      liveText(fs, 'div', 'info', () => {
        const ev = this.evaluation?.bodies.find((x) => x.id === id);
        const body = get();
        return ev && body ? `${structureLabel(body.structure)} · ${fmtMass(ev.mass.mass)} · ${body.features.length} feature${body.features.length === 1 ? '' : 's'}` : '';
      }),
      liveText(fs, 'div', 'errors', () => this.evaluation?.bodies.find((x) => x.id === id)?.errors.join('\n') ?? ''),
      this.danger('Delete body', () => this.store.commit((d) => removeBody(d, id))),
    );
    return h('div', { class: 'form' }, ...out);
  }

  private buildComponent(id: Id): HTMLElement {
    const fs = this.fields;
    const get = (): Design['components'][number] | undefined => this.store.design.components.find((c) => c.id === id);
    const inst = get();
    if (!inst) return h('div');
    const def = CATALOG.find((x) => x.id === inst.def);
    const pose = (): { position: V3; rotation: Quat } => get()?.pose ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const setPos = (i: number, v: number): void => {
      const p = [...pose().position] as [number, number, number];
      p[i] = v;
      this.store.commit((d) => updateComponent(d, id, { pose: { ...pose(), position: p } }));
    };
    const setRot = (i: number, v: number): void => {
      const e = [...quatToEuler(pose().rotation)] as [number, number, number];
      e[i] = v;
      this.store.commit((d) => updateComponent(d, id, { pose: { ...pose(), rotation: eulerToQuat(e) } }));
    };
    const colliding = (): Id[] => this.evaluation?.components.find((c) => c.id === id)?.collidesWith ?? [];
    const names = (ids: Id[]): string => ids.map((x) => this.store.design.bodies.find((b) => b.id === x)?.name ?? x).join(', ');

    const carveNote = liveText(fs, 'div', 'errors', () => {
      const hit = colliding();
      return hit.length > 0 ? `Overlaps ${names(hit)} without a carve. Its keep-out is tinted red.` : '';
    });
    const carveBtn = button('Carve these bodies', () => this.hooks.carveColliding(id), 'primary');
    fs.updaters.push(() => { carveBtn.hidden = colliding().length === 0; });
    carveBtn.hidden = colliding().length === 0;

    return h('div', { class: 'form' },
      this.title(def?.category ?? 'Part', inst.name ?? inst.id),
      textField(fs, 'Name', () => get()?.name ?? get()?.id ?? '', (v) => this.store.commit((d) => updateComponent(d, id, { name: v }))),
      h('p', { class: 'info', text: def?.name ?? inst.def }),
      h('div', { class: 'sub', text: 'Position' }),
      this.triple(fs, ['X', 'Y', 'Z'], (i) => pose().position[i] as number, setPos, 1000, 'mm'),
      h('div', { class: 'sub', text: 'Rotation' }),
      this.triple(fs, ['X', 'Y', 'Z'], (i) => quatToEuler(pose().rotation)[i] as number, setRot, RAD, '°'),
      selectField(fs, 'Bolted to', [{ value: '', label: 'Nothing' }, ...this.store.design.bodies.map((b) => ({ value: b.id, label: b.name }))], () => get()?.mountedTo ?? '', (v) => {
        this.store.commit((d) => updateComponent(d, id, { mountedTo: v === '' ? undefined : v }));
      }),
      checkField(fs, 'Carve (cut keep-out and mounting holes)', () => carvedBodies(this.store.design, id).length > 0, (on) => this.hooks.setCarve(id, on)),
      liveText(fs, 'div', 'info', () => {
        const c = carvedBodies(this.store.design, id);
        return c.length > 0 ? `Carved from ${names(c)}` : '';
      }),
      carveNote,
      carveBtn,
      def ? h('p', { class: 'info', text: `Mass ${fmtMass(def.mass)}` }) : null,
      this.danger('Remove part', () => this.store.commit((d) => removeComponent(d, id))),
    );
  }

  private buildSketch(id: Id): HTMLElement {
    const fs = this.fields;
    const sketch = this.store.design.sketches.find((s) => s.id === id);
    if (!sketch) return h('div');
    const n = axisName(sketch.plane.normal);
    const o = sketch.plane.origin;
    const used = this.store.design.bodies.reduce((c, b) => c + b.features.filter((f) => (f.kind === 'extrude' || f.kind === 'revolve') && f.sketch === id).length, 0);
    return h('div', { class: 'form' },
      this.title('Sketch', sketch.name),
      textField(fs, 'Name', () => this.store.design.sketches.find((s) => s.id === id)?.name ?? '', (v) => this.store.commit((d) => updateSketch(d, id, { name: v }))),
      h('p', { class: 'info', text: `Plane normal ${n ?? sketch.plane.normal.map((x) => x.toFixed(3)).join(', ')} through (${o.map((x) => +(x * 1000).toFixed(1)).join(', ')}) mm` }),
      h('p', { class: 'info', text: `${sketch.profiles.length} profile${sketch.profiles.length === 1 ? '' : 's'} · used by ${used} feature${used === 1 ? '' : 's'}` }),
      h('div', { class: 'actions' },
        button('Extrude…', () => this.hooks.openFeatureDialog(id, 'extrude'), 'primary'),
        button('Revolve…', () => this.hooks.openFeatureDialog(id, 'revolve'))),
      this.danger(used > 0 ? 'Delete sketch and its features' : 'Delete sketch', () => this.store.commit((d) => removeSketch(d, id))),
    );
  }

  private buildFeature(bodyId: Id, id: Id): HTMLElement {
    const fs = this.fields;
    const find = () => this.store.design.bodies.find((b) => b.id === bodyId)?.features.find((f) => f.id === id);
    const f = find();
    const body = this.store.design.bodies.find((b) => b.id === bodyId);
    if (!f || !body) return h('div');
    const patch = (p: Record<string, unknown>): void => this.store.commit((d) => updateFeature(d, bodyId, id, p));
    const isFirst = body.features[0]?.id === id;
    const form: (HTMLElement | null)[] = [this.title(`Feature of ${body.name}`, f.kind)];

    const opField = (): HTMLElement =>
      selectField(fs, 'Operation', (isFirst ? ['new'] : ['add', 'subtract', 'intersect']).map((o) => ({ value: o, label: o[0]?.toUpperCase() + o.slice(1) })),
        () => { const x = find(); return x && 'op' in x ? x.op : 'new'; }, (v) => patch({ op: v }));

    if (f.kind === 'extrude') {
      form.push(
        opField(),
        numberField(fs, 'Distance', () => { const x = find(); return x?.kind === 'extrude' ? x.distance : 0; }, (v) => patch({ distance: v }), { scale: 1000, unit: 'mm' }),
        numberField(fs, 'Taper', () => { const x = find(); return x?.kind === 'extrude' ? (x.taper ?? 0) : 0; }, (v) => patch({ taper: v === 0 ? undefined : v }), { scale: RAD, unit: '°', min: -60, max: 60 }),
        checkField(fs, 'Symmetric', () => { const x = find(); return x?.kind === 'extrude' ? !!x.symmetric : false; }, (v) => patch({ symmetric: v ? true : undefined })),
      );
      if (isFirst && body.structure.kind === 'plate') form.push(h('p', { class: 'hint', text: 'This is the plate thickness: changing it changes the plate.' }));
    } else if (f.kind === 'revolve') {
      const sketch = this.store.design.sketches.find((s) => s.id === f.sketch);
      form.push(
        opField(),
        numberField(fs, 'Angle', () => { const x = find(); return x?.kind === 'revolve' ? x.angle : 0; }, (v) => patch({ angle: v }), { scale: RAD, unit: '°', min: 1, max: 360 }),
        h('div', { class: 'axis' },
          h('span', { class: 'lbl', text: 'Axis' }),
          liveText(fs, 'div', 'val', () => { const x = find(); return x?.kind === 'revolve' ? axisLabel(x.axis) : ''; }),
          sketch ? button('Pick a line…', () => this.hooks.pickAxis(sketch, (axis) => patch({ axis })), 'primary') : null,
          button('Sketch X', () => patch({ axis: { origin: [0, 0], direction: [1, 0] } })),
          button('Sketch Y', () => patch({ axis: { origin: [0, 0], direction: [0, 1] } }))),
      );
    } else if (f.kind === 'carve') {
      const inst = this.store.design.components.find((c) => c.id === f.component);
      form.push(
        h('p', { class: 'info', text: `Keep-out and mounting holes of ${inst?.name ?? f.component}` }),
        numberField(fs, 'Clearance', () => { const x = find(); return x?.kind === 'carve' ? x.clearance : 0; }, (v) => patch({ clearance: Math.max(0, v) }), { scale: 1000, unit: 'mm', min: 0 }),
      );
    } else {
      form.push(h('p', { class: 'info', text: `${f.kind} features are edited in the design JSON for now.` }));
    }
    form.push(
      liveText(fs, 'div', 'errors', () => this.evaluation?.bodies.find((x) => x.id === bodyId)?.errors.join('\n') ?? ''),
      this.danger('Delete feature', () => this.store.commit((d) => removeFeature(d, bodyId, id))),
    );
    return h('div', { class: 'form' }, ...form);
  }
}
