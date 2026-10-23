import { createKernel, type CadKernel } from '@botfoundry/cad';
import type { Design } from '@botfoundry/model';
import type { Evaluation } from '@botfoundry/cad';

export interface SessionResult {
  /** the design that was evaluated; it may be older than the one being edited */
  design: Design | null;
  evaluation: Evaluation | null;
  /** set when the kernel refused the design (duplicate ids, unknown part, ...) */
  error: string | null;
}

/**
 * Owns the CAD kernel and re-evaluates the latest design. Requests made while a gesture streams
 * edits are coalesced to one evaluation per `delayMs`, always of the newest design. The kernel
 * caches per body, so an edit costs only the bodies it touches.
 */
export class KernelSession {
  evaluation: Evaluation | null = null;
  design: Design | null = null;
  error: string | null = null;
  private kernel: CadKernel | null = null;
  private pending: Design | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(r: SessionResult) => void>();

  private readonly delayMs: number;

  constructor(delayMs = 16) {
    this.delayMs = delayMs;
  }

  async start(): Promise<void> {
    this.kernel = await createKernel();
    if (this.pending) this.flush();
  }

  get ready(): boolean {
    return this.kernel !== null;
  }

  onResult(fn: (r: SessionResult) => void): void {
    this.listeners.add(fn);
  }

  request(design: Design): void {
    this.pending = design;
    if (!this.kernel || this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Evaluate now, bypassing the debounce. */
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const design = this.pending;
    this.pending = null;
    if (!design || !this.kernel) return;
    try {
      this.evaluation = this.kernel.evaluate(design);
      this.design = design;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    for (const fn of this.listeners) fn({ design: this.design, evaluation: this.evaluation, error: this.error });
  }
}
