import { MATERIALS, type BooleanOp, type Id, type MaterialId, type Sketch, type V2 } from '@botfoundry/model';
import { button, checkField, FieldSet, h, numberField, selectField, textField } from '../dom.ts';
import type { Store } from '../state/store.ts';
import { applyDraft, defaultDraft, distanceIsThickness, type FeatureDraft, type FeatureKind, type StructureKind } from './featureDraft.ts';

export interface FeatureDialogHooks {
  pickAxis(sketch: Sketch, done: (axis: { origin: V2; direction: V2 }) => void, cancelled?: () => void): void;
  toast(message: string, kind?: 'info' | 'error'): void;
}

export function axisLabel(axis: { origin: V2; direction: V2 }): string {
  const [ox, oy] = axis.origin, [dx, dy] = axis.direction;
  if (ox === 0 && oy === 0 && dx === 0 && Math.abs(dy) === 1) return 'Sketch Y axis';
  if (ox === 0 && oy === 0 && dy === 0 && Math.abs(dx) === 1) return 'Sketch X axis';
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return `Line through (${+(ox * 1000).toFixed(1)}, ${+(oy * 1000).toFixed(1)}) mm at ${+deg.toFixed(1)}°`;
}

const OP_LABEL: Record<BooleanOp, string> = { new: 'New body', add: 'Add to body', subtract: 'Cut from body', intersect: 'Intersect with body' };

/** The dialog that turns a sketch into an extrude or revolve, on a new body or an existing one. */
export class FeatureDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly store: Store;
  private readonly hooks: FeatureDialogHooks;
  private draft: FeatureDraft | null = null;

  constructor(store: Store, hooks: FeatureDialogHooks) {
    this.store = store;
    this.hooks = hooks;
    this.dialog = h('dialog', { class: 'dlg' });
    document.body.append(this.dialog);
  }

  open(sketchId: Id, kind: FeatureKind, draft?: FeatureDraft): void {
    this.draft = draft ?? defaultDraft(this.store.design, sketchId, kind);
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private render(): void {
    const draft = this.draft;
    if (!draft) return;
    const d = this.store.design;
    const sketch = d.sketches.find((s) => s.id === draft.sketchId);
    if (!sketch) return this.close();
    const fs = new FieldSet();
    const rerender = (): void => this.render();

    const kindButton = (k: FeatureKind, label: string): HTMLElement =>
      h('button', { type: 'button', class: draft.kind === k ? 'on' : '', text: label, on: { click: () => {
        draft.kind = k;
        if (k === 'revolve' && draft.structure === 'plate') draft.structure = 'billet';
        rerender();
      } } });

    const ops: BooleanOp[] = d.bodies.length === 0 ? ['new'] : ['new', 'add', 'subtract', 'intersect'];
    const form: HTMLElement[] = [
      h('div', { class: 'seg' }, kindButton('extrude', 'Extrude'), kindButton('revolve', 'Revolve')),
      selectField(fs, 'Operation', ops.map((o) => ({ value: o, label: OP_LABEL[o] })), () => draft.op, (v) => {
        draft.op = v as BooleanOp;
        if (draft.op === 'subtract' && draft.distance > 0) draft.distance = -draft.distance;
        if ((draft.op === 'add' || draft.op === 'new') && draft.distance < 0) draft.distance = -draft.distance;
        if (draft.op !== 'new' && !draft.target) draft.target = d.bodies[0]?.id ?? null;
        rerender();
      }),
    ];

    if (draft.op === 'new') {
      form.push(
        textField(fs, 'Name', () => draft.name, (v) => (draft.name = v)),
        selectField(fs, 'Material', (Object.keys(MATERIALS) as MaterialId[]).map((m) => ({ value: m, label: MATERIALS[m].name })), () => draft.material, (v) => (draft.material = v as MaterialId)),
      );
      const structures: StructureKind[] = draft.kind === 'extrude' ? ['plate', 'billet', 'tube'] : ['billet', 'tube'];
      form.push(selectField(fs, 'Structure', structures.map((s) => ({ value: s, label: s[0]?.toUpperCase() + s.slice(1) })), () => draft.structure, (v) => {
        draft.structure = v as StructureKind;
        rerender();
      }));
      if (draft.structure === 'plate') form.push(numberField(fs, 'Thickness', () => draft.thickness, (v) => (draft.thickness = v), { scale: 1000, unit: 'mm', min: 0.1 }));
      if (draft.structure === 'tube') form.push(numberField(fs, 'Wall', () => draft.wall, (v) => (draft.wall = v), { scale: 1000, unit: 'mm', min: 0.1 }));
    } else {
      if (!draft.target) draft.target = d.bodies[0]?.id ?? null;
      form.push(selectField(fs, 'Body', d.bodies.map((b) => ({ value: b.id, label: b.name })), () => draft.target ?? '', (v) => (draft.target = v)));
    }

    if (draft.kind === 'extrude') {
      if (!distanceIsThickness(draft)) {
        form.push(numberField(fs, 'Distance', () => draft.distance, (v) => (draft.distance = v), { scale: 1000, unit: 'mm' }),
          h('p', { class: 'hint', text: 'Positive goes along the sketch normal, negative against it. Cut into a face you sketched on with a negative distance.' }));
      }
      form.push(
        numberField(fs, 'Taper', () => draft.taper, (v) => (draft.taper = v), { scale: 180 / Math.PI, unit: '°', min: -60, max: 60 }),
        checkField(fs, 'Symmetric (half each side of the plane)', () => draft.symmetric, (v) => (draft.symmetric = v)),
      );
    } else {
      form.push(
        numberField(fs, 'Angle', () => draft.angle, (v) => (draft.angle = v), { scale: 180 / Math.PI, unit: '°', min: 1, max: 360 }),
        h('div', { class: 'axis' },
          h('span', { class: 'lbl', text: 'Axis' }),
          h('span', { class: 'val', text: axisLabel(draft.axis) }),
          button('Sketch X', () => { draft.axis = { origin: [0, 0], direction: [1, 0] }; rerender(); }),
          button('Sketch Y', () => { draft.axis = { origin: [0, 0], direction: [0, 1] }; rerender(); }),
          button('Pick a line…', () => {
            this.close();
            this.hooks.pickAxis(
              sketch,
              (axis) => {
                draft.axis = axis;
                this.open(draft.sketchId, 'revolve', draft);
              },
              () => this.open(draft.sketchId, 'revolve', draft),
            );
          }, 'primary'),
        ),
      );
    }

    this.dialog.replaceChildren(
      h('h2', { text: `${sketch.name} → ${draft.kind === 'extrude' ? 'Extrude' : 'Revolve'}` }),
      h('div', { class: 'form' }, ...form),
      h('div', { class: 'actions' },
        button('Cancel', () => this.close(), 'ghost'),
        button('Create', () => this.create(), 'primary')),
    );
  }

  private create(): void {
    const draft = this.draft;
    if (!draft) return;
    const result = applyDraft(this.store.design, draft);
    if ('error' in result) return this.hooks.toast(result.error, 'error');
    this.store.commit(() => result.design);
    this.store.select(result.selection);
    this.close();
  }
}
