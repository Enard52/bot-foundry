import type { Evaluation } from '@botfoundry/cad';
import { principalMoments } from '../geom/inertia.ts';
import { h } from '../dom.ts';
import { fmtMass, fmtSig, fmtVecMm } from './format.ts';

/** Total mass, centre of mass, principal moments of inertia and the last evaluation time. */
export class MassPanel {
  private readonly big = h('b', { text: '—' });
  private readonly com = h('b', { text: '—' });
  private readonly inertia = h('b', { text: '—' });
  private readonly time = h('b', { text: '—' });
  private readonly counts = h('b', { text: '—' });
  private readonly note = h('p', { class: 'hint', text: 'Starting the CAD kernel…' });

  constructor(el: HTMLElement) {
    el.append(
      h('h3', { text: 'Mass' }),
      h('div', { class: 'bigmass' }, this.big, h('span', { text: 'total' })),
      h('div', { class: 'kv' }, h('span', { text: 'Centre of mass' }), this.com),
      h('div', { class: 'kv' }, h('span', { text: 'Principal inertia' }), this.inertia),
      h('div', { class: 'kv' }, h('span', { text: 'Bodies / parts' }), this.counts),
      h('div', { class: 'kv' }, h('span', { text: 'Last evaluate' }), this.time),
      this.note,
    );
  }

  set(ev: Evaluation | null, error: string | null): void {
    this.note.hidden = !!ev && !error;
    this.note.textContent = error ?? 'Starting the CAD kernel…';
    this.note.classList.toggle('err', !!error);
    if (!ev) return;
    const m = ev.mass;
    const empty = ev.bodies.length + ev.components.length === 0;
    this.big.textContent = empty ? '0.000 kg' : fmtMass(m.mass);
    this.com.textContent = empty ? '—' : `${fmtVecMm(m.com)} mm`;
    const p = principalMoments(m.inertia);
    this.inertia.textContent = empty ? '—' : `${p.map(fmtSig).join(', ')} kg·m²`;
    this.counts.textContent = `${ev.bodies.length} / ${ev.components.length}`;
    this.time.textContent = `${ev.timeMs.toFixed(1)} ms`;
  }
}
