import './style.css';
import { sampleDesign } from '@botfoundry/cad';
import { CATALOG, type Id, type Plane, type Sketch, type V2 } from '@botfoundry/model';
import { h } from './dom.ts';
import { KernelSession } from './kernel/session.ts';
import {
  addSketch, carvedBodies, emptyDesign, removeBody, removeComponent, removeFeature, removeSketch, setCarve,
} from './state/ops.ts';
import { AUTOSAVE_KEY, SAVE_KEY, parseDesign, readStored, stringifyDesign, writeStored } from './state/persist.ts';
import { Store } from './state/store.ts';
import { EditTool } from './tools/editTool.ts';
import { SketchTool } from './tools/sketchTool.ts';
import { SceneSync } from './view/sceneSync.ts';
import { SketchOverlay } from './view/sketchOverlay.ts';
import { Viewport } from './view/viewport.ts';
import { FeatureDialog } from './ui/featureDialog.ts';
import { Inspector } from './ui/inspector.ts';
import { LeftRail } from './ui/leftRail.ts';
import { MassPanel } from './ui/massPanel.ts';
import { Toasts } from './ui/toast.ts';
import { Topbar } from './ui/topbar.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const toasts = new Toasts($('toasts'));
const toast = (m: string, kind: 'info' | 'error' = 'info'): void => toasts.show(m, kind);

const store = new Store(readStored(AUTOSAVE_KEY) ?? emptyDesign());
const session = new KernelSession();
const stage = $('stage');
const vp = new Viewport(stage);
const sync = new SceneSync(vp);
const overlay = new SketchOverlay(vp);
const edit = new EditTool(vp, sync, store);

// ----- sketch mode -------------------------------------------------------------------------

let pendingAxis: { done: (axis: { origin: V2; direction: V2 }) => void; cancelled?: () => void } | null = null;

const sketchTool = new SketchTool(vp, store, {
  onFinish(sketch: Sketch) {
    store.commit((d) => addSketch(d, sketch));
    store.select({ kind: 'sketch', id: sketch.id });
    dialog.open(sketch.id, 'extrude');
  },
  onPickAxis(axis) {
    const p = pendingAxis;
    pendingAxis = null;
    p?.done(axis);
  },
  onEnter() {
    sync.ghost = true;
    sync.restyle();
    edit.setEnabled(false);
    overlay.update(store.design, store.selection, false);
  },
  onExit() {
    sync.ghost = false;
    sync.restyle();
    edit.setEnabled(true);
    overlay.update(store.design, store.selection, true);
    renderAll();
  },
  onPickCancelled() {
    // a pick that ended without a choice (Esc, Cancel) hands control back to whoever asked
    const p = pendingAxis;
    pendingAxis = null;
    p?.cancelled?.();
  },
  toast,
}, stage);

function startSketch(plane: Plane, label: string): void {
  store.select({ kind: 'none' });
  sketchTool.startDraw(plane, label);
}

function pickAxis(sketch: Sketch, done: (axis: { origin: V2; direction: V2 }) => void, cancelled?: () => void): void {
  pendingAxis = { done, cancelled };
  sketchTool.startPickAxis(sketch);
}

// ----- panels ------------------------------------------------------------------------------

const dialog = new FeatureDialog(store, { pickAxis, toast });
const mass = new MassPanel($('mass'));

function addPart(defId: Id): void {
  edit.place(defId);
}

const left = new LeftRail($('left'), store, { addPart });

function toggleCarve(id: Id, on: boolean): void {
  if (!on) return store.commit((d) => setCarve(d, id, [], false));
  carveColliding(id, true);
}

function carveColliding(id: Id, announce = false): void {
  const hit = session.evaluation?.components.find((c) => c.id === id)?.collidesWith ?? [];
  const mounted = store.design.components.find((c) => c.id === id)?.mountedTo;
  const bodies = [...new Set([...hit, ...(mounted ? [mounted] : [])])];
  if (bodies.length === 0) {
    if (announce) toast('This part does not touch any body yet. Move it into the frame, then carve.');
    return;
  }
  store.commit((d) => setCarve(d, id, bodies, true));
}

const inspector = new Inspector($('inspector'), store, {
  openFeatureDialog: (sketchId, kind) => dialog.open(sketchId, kind),
  pickAxis,
  setCarve: toggleCarve,
  carveColliding: (id) => carveColliding(id),
});

function deleteSelection(): void {
  const sel = store.selection;
  switch (sel.kind) {
    case 'component': return store.commit((d) => removeComponent(d, sel.id));
    case 'body': return store.commit((d) => removeBody(d, sel.id));
    case 'sketch': return store.commit((d) => removeSketch(d, sel.id));
    case 'feature': return store.commit((d) => removeFeature(d, sel.body, sel.id));
    case 'none': return;
  }
}

// ----- files -------------------------------------------------------------------------------

let frameNext = true;

function replaceDesign(design: ReturnType<typeof emptyDesign>, frame = true): void {
  store.commit(() => design);
  store.select({ kind: 'none' });
  frameNext = frame;
  session.request(design);
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, on: {
  change: () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    file.text().then((text) => {
      try {
        replaceDesign(parseDesign(text));
        toast(`Imported ${file.name}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    }, () => toast('Could not read that file.', 'error'));
  },
} });
document.body.append(fileInput);

const topbar = new Topbar($('topbar'), store, {
  startSketch,
  setMode: (m) => {
    edit.setMode(m);
    topbar.sync(m);
  },
  setSnap: (on) => edit.setSnap(on),
  setKeepOuts: (on) => {
    sync.showKeepOuts = on;
    sync.restyle();
  },
  save: () => toast(writeStored(SAVE_KEY, store.design) ? 'Saved to this browser.' : 'Could not save: browser storage is unavailable.', 'info'),
  load: () => {
    const d = readStored(SAVE_KEY);
    if (!d) return toast('Nothing saved in this browser yet.');
    replaceDesign(d);
    toast('Loaded the saved design.');
  },
  importFile: () => fileInput.click(),
  exportFile: () => download(`${store.design.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'design'}.botfoundry.json`, stringifyDesign(store.design)),
  loadSample: () => replaceDesign(sampleDesign()),
  clear: () => {
    if (store.design.bodies.length + store.design.components.length + store.design.sketches.length === 0) return;
    replaceDesign(emptyDesign(), false);
    toast('Cleared. Undo brings it back.');
  },
});
topbar.sync('translate');

// ----- viewport furniture ------------------------------------------------------------------

const empty = h('div', { class: 'empty' },
  h('h2', { text: 'An empty workshop' }),
  h('p', { text: 'Sketch an outline on a plane and extrude it, or start from the sample robot.' }),
  h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'primary', text: 'Load the sample robot', on: { click: () => replaceDesign(sampleDesign()) } }),
    h('button', { type: 'button', text: 'Sketch on the ground plane', on: { click: () => startSketch({ origin: [0, 0, 0], normal: [0, 1, 0], xAxis: [1, 0, 0] }, 'XZ plane') } })));
const banner = h('div', { class: 'banner', hidden: true });
stage.append(
  banner, empty,
  h('div', { class: 'keys', text: 'Drag parts in · W move · E rotate · Del remove · Ctrl/Cmd+Z undo' }),
);

// ----- render loop of the app --------------------------------------------------------------

function renderAll(): void {
  left.setEvaluation(session.evaluation);
  inspector.setEvaluation(session.evaluation);
  left.render();
  inspector.render();
  topbar.sync(edit.mode);
  const d = store.design;
  empty.hidden = d.bodies.length + d.components.length + d.sketches.length > 0 || sketchTool.active;
}

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

store.subscribe((e) => {
  if (e === 'design') {
    session.request(store.design);
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => writeStored(AUTOSAVE_KEY, store.design), 500);
  }
  overlay.update(store.design, store.selection, !sketchTool.active);
  sync.restyle(store.selection);
  renderAll();
});

session.onResult(({ design, evaluation, error }) => {
  banner.hidden = !error;
  banner.textContent = error ?? '';
  mass.set(evaluation, error);
  if (design && evaluation) {
    const hadContent = sync.hasContent();
    sync.update(design, evaluation, store.selection);
    // frame after loading a design, and when the first thing appears in an empty workshop
    if ((frameNext || !hadContent) && sync.hasContent() && !sketchTool.active) {
      frameNext = false;
      vp.frameContent();
    }
  }
  renderAll();
});

// ----- keyboard ----------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
  if (sketchTool.active || document.querySelector('dialog[open]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    store.redo();
  } else if (mod) {
    return;
  } else if (key === 'w') {
    edit.setMode('translate');
    topbar.sync('translate');
  } else if (key === 'e') {
    edit.setMode('rotate');
    topbar.sync('rotate');
  } else if (key === 'delete' || key === 'backspace') {
    e.preventDefault();
    deleteSelection();
  } else if (key === 'escape') {
    store.select({ kind: 'none' });
  } else if (key === 'f') {
    vp.frameContent();
  }
});

// ----- go ----------------------------------------------------------------------------------

// expose the pieces for debugging in the browser console
(window as unknown as { workshop: unknown }).workshop = { store, session, vp, sync, edit, sketchTool, CATALOG };

renderAll();
overlay.update(store.design, store.selection, true);
session.request(store.design);
session.start().then(
  () => {
    session.flush();
  },
  (e: unknown) => {
    const msg = `The CAD kernel failed to start: ${e instanceof Error ? e.message : String(e)}`;
    banner.hidden = false;
    banner.textContent = msg;
    mass.set(null, msg);
  },
);
