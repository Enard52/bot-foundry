import type { Design, Id } from '@botfoundry/model';
import { emptyDesign } from './ops.ts';

export type Selection =
  | { kind: 'none' }
  | { kind: 'body'; id: Id }
  | { kind: 'component'; id: Id }
  | { kind: 'sketch'; id: Id }
  | { kind: 'feature'; body: Id; id: Id };

export const NO_SELECTION: Selection = { kind: 'none' };

export type StoreEvent = 'design' | 'selection';

const HISTORY_LIMIT = 200;

/**
 * The design being edited, what is selected, and the undo history. Designs are immutable values,
 * so history is a stack of earlier designs. A gesture (dragging a gizmo) previews many designs and
 * records one undo step when it ends.
 */
export class Store {
  design: Design;
  selection: Selection = NO_SELECTION;
  private past: Design[] = [];
  private future: Design[] = [];
  private gestureBase: Design | null = null;
  private listeners = new Set<(e: StoreEvent) => void>();

  constructor(design: Design = emptyDesign()) {
    this.design = design;
  }

  subscribe(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: StoreEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Apply an edit as one undo step. Returning the same design is a no-op. */
  commit(edit: (d: Design) => Design): void {
    const next = edit(this.design);
    if (next === this.design) return;
    this.endGesture();
    this.past.push(this.design);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.design = next;
    this.pruneSelection();
    this.emit('design');
  }

  /** Start a gesture: later previews are folded into one undo step. */
  beginGesture(): void {
    this.gestureBase ??= this.design;
  }

  preview(edit: (d: Design) => Design): void {
    this.beginGesture();
    const next = edit(this.design);
    if (next === this.design) return;
    this.design = next;
    this.emit('design');
  }

  endGesture(): void {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (base && base !== this.design) {
      this.past.push(base);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
  }

  undo(): void {
    this.endGesture();
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.design);
    this.design = prev;
    this.pruneSelection();
    this.emit('design');
  }

  redo(): void {
    this.endGesture();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.design);
    this.design = next;
    this.pruneSelection();
    this.emit('design');
  }

  /** Replace the whole design (load, import, new). History restarts. */
  replace(design: Design): void {
    this.gestureBase = null;
    this.past = [];
    this.future = [];
    this.design = design;
    this.selection = NO_SELECTION;
    this.emit('design');
    this.emit('selection');
  }

  select(selection: Selection): void {
    const a = this.selection, b = selection;
    const same = a.kind === b.kind && JSON.stringify(a) === JSON.stringify(b);
    if (same) return;
    this.selection = selection;
    this.emit('selection');
  }

  /** Clear a selection whose target no longer exists after an edit. */
  private pruneSelection(): void {
    const s = this.selection;
    const d = this.design;
    let alive = true;
    switch (s.kind) {
      case 'body': alive = d.bodies.some((b) => b.id === s.id); break;
      case 'component': alive = d.components.some((c) => c.id === s.id); break;
      case 'sketch': alive = d.sketches.some((k) => k.id === s.id); break;
      case 'feature': alive = !!d.bodies.find((b) => b.id === s.body)?.features.some((f) => f.id === s.id); break;
      case 'none': break;
    }
    if (!alive) {
      this.selection = NO_SELECTION;
      this.emit('selection');
    }
  }
}
