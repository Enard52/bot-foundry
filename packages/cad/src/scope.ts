// manifold-3d objects live in WASM memory and are not garbage collected. A Scope collects every
// temporary created during one operation so a single dispose() frees them, while objects that
// outlive the operation are released from it first.

interface Disposable {
  delete(): void;
}

export class Scope {
  private items = new Set<Disposable>();

  track<T extends Disposable>(item: T): T {
    this.items.add(item);
    return item;
  }

  /** Take an object out of the scope so dispose() leaves it alone; the caller now owns it. */
  keep<T extends Disposable>(item: T): T {
    this.items.delete(item);
    return item;
  }

  dispose(): void {
    for (const item of this.items) {
      try {
        item.delete();
      } catch {
        // already freed
      }
    }
    this.items.clear();
  }
}
