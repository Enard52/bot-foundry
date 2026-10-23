// A tiny element builder and the form fields the panels use. Fields register an updater so a panel
// can refresh displayed values in place after an edit instead of rebuilding (and losing focus).

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  draggable?: boolean;
  placeholder?: string;
  dataset?: Record<string, string>;
  style?: string;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
  [attr: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null) continue;
      if (key === 'class') el.className = String(val);
      else if (key === 'text') el.textContent = String(val);
      else if (key === 'dataset') Object.assign(el.dataset, val);
      else if (key === 'style') el.setAttribute('style', String(val));
      else if (key === 'on') {
        for (const [type, fn] of Object.entries(val as Record<string, EventListener>)) el.addEventListener(type, fn);
      } else if (key in el) (el as unknown as Record<string, unknown>)[key] = val;
      else el.setAttribute(key, String(val));
    }
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Collects the refresh functions of the fields built for one panel. */
export class FieldSet {
  readonly updaters: (() => void)[] = [];
  refresh(): void {
    for (const fn of this.updaters) fn();
  }
}

const focused = (el: HTMLElement): boolean => document.activeElement === el;

export function formatNumber(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '';
  return String(+v.toFixed(digits));
}

export interface NumberOptions {
  /** display value = model value * scale (1000 for m -> mm, 180/pi for rad -> deg) */
  scale?: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
}

export function numberField(
  fs: FieldSet, label: string, get: () => number, set: (v: number) => void, opts: NumberOptions = {},
): HTMLElement {
  const scale = opts.scale ?? 1;
  const input = h('input', { type: 'number', step: String(opts.step ?? 'any') });
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  const show = (): void => {
    if (!focused(input)) input.value = formatNumber(get() * scale, opts.digits ?? 3);
  };
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) return show();
    set(v / scale);
  });
  fs.updaters.push(show);
  show();
  return h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), h('span', { class: 'unit' }, input, opts.unit ? h('i', { text: opts.unit }) : null));
}

export function textField(fs: FieldSet, label: string, get: () => string, set: (v: string) => void): HTMLElement {
  const input = h('input', { type: 'text' });
  const show = (): void => {
    if (!focused(input)) input.value = get();
  };
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (v === '') return show();
    set(v);
  });
  fs.updaters.push(show);
  show();
  return h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), input);
}

export function selectField(
  fs: FieldSet, label: string, options: readonly { value: string; label: string }[], get: () => string, set: (v: string) => void,
): HTMLElement {
  const select = h('select', null, ...options.map((o) => h('option', { value: o.value, text: o.label })));
  const show = (): void => {
    select.value = get();
  };
  select.addEventListener('change', () => set(select.value));
  fs.updaters.push(show);
  show();
  return h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), select);
}

export function checkField(fs: FieldSet, label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' });
  const show = (): void => {
    input.checked = get();
  };
  input.addEventListener('change', () => set(input.checked));
  fs.updaters.push(show);
  show();
  return h('label', { class: 'field check' }, input, h('span', { class: 'lbl', text: label }));
}

/** A live text line, refreshed with the panel. */
export function liveText(fs: FieldSet, tag: 'div' | 'p', cls: string, get: () => string): HTMLElement {
  const el = h(tag, { class: cls });
  const show = (): void => {
    const t = get();
    if (el.textContent !== t) el.textContent = t;
    el.hidden = t === '';
  };
  fs.updaters.push(show);
  show();
  return el;
}

export function button(text: string, onClick: () => void, cls = '', title?: string): HTMLButtonElement {
  return h('button', { type: 'button', class: cls, text, title, on: { click: onClick } });
}

/** Rotation as intrinsic XYZ Euler angles in degrees (quaternion in, display out) lives in math.ts. */
