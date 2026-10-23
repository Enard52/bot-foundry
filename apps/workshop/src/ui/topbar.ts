import { PLANE_XY, PLANE_XZ, PLANE_YZ, type Plane } from '@botfoundry/model';
import { axisName, offsetPlane } from '../geom/plane.ts';
import { button, h } from '../dom.ts';
import { facePlanes, renameDesign } from '../state/ops.ts';
import type { Store } from '../state/store.ts';
import type { GizmoMode } from '../tools/editTool.ts';

export interface TopbarActions {
  startSketch(plane: Plane, label: string): void;
  setMode(mode: GizmoMode): void;
  setSnap(on: boolean): void;
  setKeepOuts(on: boolean): void;
  save(): void;
  load(): void;
  importFile(): void;
  exportFile(): void;
  loadSample(): void;
  clear(): void;
}

/** Brand, design name, sketch plane picker, history, gizmo and file controls. */
export class Topbar {
  private readonly store: Store;
  private readonly actions: TopbarActions;
  private readonly name: HTMLInputElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly modeBtns = new Map<GizmoMode, HTMLButtonElement>();
  private readonly menu: HTMLElement;
  private offsetMm = 0;

  constructor(el: HTMLElement, store: Store, actions: TopbarActions) {
    this.store = store;
    this.actions = actions;
    this.name = h('input', { class: 'botname', type: 'text', title: 'Design name', on: { change: () => this.rename() } });
    this.undoBtn = button('Undo', () => store.undo(), '', 'Undo (Ctrl/Cmd+Z)');
    this.redoBtn = button('Redo', () => store.redo(), '', 'Redo (Shift+Ctrl/Cmd+Z)');
    this.menu = h('div', { class: 'menu', hidden: true });
    const sketchBtn = button('New sketch ▾', () => this.toggleMenu(), 'primary');
    for (const [m, label, tip] of [['translate', 'Move', 'Move (W)'], ['rotate', 'Rotate', 'Rotate (E)']] as const) {
      const b = button(label, () => actions.setMode(m), '', tip);
      this.modeBtns.set(m, b);
    }
    const snap = h('input', { type: 'checkbox', checked: true, on: { change: (e) => actions.setSnap((e.target as HTMLInputElement).checked) } });
    const keep = h('input', { type: 'checkbox', on: { change: (e) => actions.setKeepOuts((e.target as HTMLInputElement).checked) } });
    el.append(
      h('div', { class: 'brand' }, h('i', { class: 'mark' }), h('span', { text: 'Bot Foundry' }), h('small', { text: 'Workshop' })),
      this.name,
      h('div', { class: 'group menuwrap' }, sketchBtn, this.menu),
      h('div', { class: 'group' }, this.undoBtn, this.redoBtn),
      h('div', { class: 'group seg' }, ...this.modeBtns.values()),
      h('label', { class: 'chk', title: 'Snap the gizmo to 1 mm and 5 degrees' }, snap, h('span', { text: 'Snap' })),
      h('label', { class: 'chk', title: 'Show every keep-out envelope' }, keep, h('span', { text: 'Keep-outs' })),
      h('div', { class: 'spacer' }),
      h('div', { class: 'group' },
        button('Sample', actions.loadSample, '', 'Load the sample wedge robot'),
        button('Save', actions.save, '', 'Save to this browser'),
        button('Load', actions.load, '', 'Load the saved design'),
        button('Import', actions.importFile, '', 'Import a design from a JSON file'),
        button('Export', actions.exportFile, '', 'Download the design as JSON'),
        button('Clear', actions.clear, 'ghost', 'Start an empty design')),
    );
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !(e.target as Element).closest('.menuwrap')) this.menu.hidden = true;
    });
    this.sync();
  }

  sync(mode?: GizmoMode): void {
    if (document.activeElement !== this.name) this.name.value = this.store.design.name;
    this.undoBtn.disabled = !this.store.canUndo;
    this.redoBtn.disabled = !this.store.canRedo;
    if (mode) for (const [m, b] of this.modeBtns) b.classList.toggle('on', m === mode);
  }

  private rename(): void {
    const v = this.name.value.trim();
    if (v) this.store.commit((d) => renameDesign(d, v));
    else this.name.value = this.store.design.name;
  }

  private toggleMenu(): void {
    this.menu.hidden = !this.menu.hidden;
    if (!this.menu.hidden) this.renderMenu();
  }

  private renderMenu(): void {
    const pick = (plane: Plane, label: string): void => {
      this.menu.hidden = true;
      this.actions.startSketch(this.offsetMm === 0 ? plane : offsetPlane(plane, this.offsetMm / 1000), this.offsetMm === 0 ? label : `${label} +${this.offsetMm} mm`);
    };
    const item = (label: string, note: string, plane: Plane): HTMLElement =>
      h('button', { type: 'button', class: 'item', on: { click: () => pick(plane, label) } }, h('b', { text: label }), h('small', { text: note }));
    const offset = h('input', { type: 'number', value: String(this.offsetMm), step: '1', on: { change: (e) => { this.offsetMm = Number((e.target as HTMLInputElement).value) || 0; } } });
    const faces = facePlanes(this.store.design, (n) => `${axisName(n) ?? 'sloped'} face`);
    this.menu.replaceChildren(
      h('div', { class: 'mhead', text: 'Sketch on a plane' }),
      item('XZ plane', 'top view, the ground', PLANE_XZ),
      item('XY plane', 'side view', PLANE_XY),
      item('YZ plane', 'front view', PLANE_YZ),
      h('label', { class: 'moff' }, h('span', { text: 'Offset along the normal' }), h('span', { class: 'unit' }, offset, h('i', { text: 'mm' }))),
      h('div', { class: 'mhead', text: 'Sketch on a face' }),
      ...(faces.length === 0
        ? [h('p', { class: 'none', text: 'Faces of extruded bodies appear here.' })]
        : faces.map((f) => item(f.label, 'face of the body', f.plane))),
    );
  }
}
