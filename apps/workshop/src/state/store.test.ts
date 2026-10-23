import { describe, expect, it } from 'vitest';
import { Store } from './store.ts';
import { addComponent, emptyDesign, renameDesign } from './ops.ts';

const IDENT = { position: [0, 0, 0] as const, rotation: [0, 0, 0, 1] as const };

describe('Store history', () => {
  it('undoes and redoes edits', () => {
    const s = new Store();
    s.commit((d) => renameDesign(d, 'a'));
    s.commit((d) => renameDesign(d, 'b'));
    s.undo();
    expect(s.design.name).toBe('a');
    s.undo();
    expect(s.design.name).toBe('Untitled bot');
    expect(s.canUndo).toBe(false);
    s.redo();
    s.redo();
    expect(s.design.name).toBe('b');
    expect(s.canRedo).toBe(false);
  });

  it('drops the redo branch on a new edit', () => {
    const s = new Store();
    s.commit((d) => renameDesign(d, 'a'));
    s.undo();
    s.commit((d) => renameDesign(d, 'c'));
    expect(s.canRedo).toBe(false);
  });

  it('folds a gesture into one undo step', () => {
    const s = new Store();
    s.commit((d) => addComponent(d, { id: 'm', def: 'x', pose: IDENT }));
    s.beginGesture();
    for (let i = 1; i <= 5; i++) {
      s.preview((d) => ({ ...d, components: d.components.map((c) => ({ ...c, pose: { ...c.pose, position: [i, 0, 0] } })) }));
    }
    s.endGesture();
    expect(s.design.components[0]?.pose.position).toEqual([5, 0, 0]);
    s.undo();
    expect(s.design.components[0]?.pose.position).toEqual([0, 0, 0]);
    s.undo();
    expect(s.design.components).toHaveLength(0);
  });

  it('does not record a gesture that changed nothing', () => {
    const s = new Store();
    s.beginGesture();
    s.endGesture();
    expect(s.canUndo).toBe(false);
  });

  it('clears a selection whose target was undone away', () => {
    const s = new Store();
    s.commit((d) => addComponent(d, { id: 'm', def: 'x', pose: IDENT }));
    s.select({ kind: 'component', id: 'm' });
    s.undo();
    expect(s.selection.kind).toBe('none');
  });

  it('starts fresh history on replace', () => {
    const s = new Store();
    s.commit((d) => renameDesign(d, 'a'));
    s.replace(emptyDesign('loaded'));
    expect(s.canUndo).toBe(false);
    expect(s.design.name).toBe('loaded');
  });
});
