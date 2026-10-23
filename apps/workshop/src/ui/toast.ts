import { h } from '../dom.ts';

/** Short messages in the corner of the screen. Errors stay a little longer. */
export class Toasts {
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  show(message: string, kind: 'info' | 'error' = 'info'): void {
    const el = h('div', { class: `toast ${kind}`, text: message, role: 'status' });
    this.host.append(el);
    setTimeout(() => el.classList.add('out'), kind === 'error' ? 6000 : 3200);
    setTimeout(() => el.remove(), kind === 'error' ? 6400 : 3600);
  }
}
