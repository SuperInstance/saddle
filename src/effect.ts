/**
 * effect.ts — v4 effect-scoped registration (SEAM-REPORT §1.2).
 *
 * Registration is an effect; disposal is the unit of cleanup. `register(fn)`
 * runs fn ON ACTIVATION (immediately) and fn RETURNS the disposer; dispose()
 * unwinds disposers in REVERSE registration order (LIFO). There is no
 * "unregister" API — a registration borrows the scope's lifetime, so it
 * cannot leak past it.
 *
 * The activation-returns-disposer shape is load-bearing (SEAM-REPORT
 * friction #4): "ctx.effect(fn) is 'run fn on activation, fn RETURNS the
 * disposer' — NOT 'store fn, run it on dispose'. A mock that gets it wrong
 * silently tests nothing."
 *
 * Honest scope (SEAM-REPORT §3): what genuinely reverts is registrations and
 * owned temp resources; what does NOT revert is external side effects,
 * completed ledger appends, and the model's memory. Saddle steals the
 * registration/disposal hygiene and does not claim transactional execution.
 */

export type Disposer = () => void | Promise<void>;

export class EffectScope {
  private _disposers: Disposer[] = [];
  private _disposed = false;

  /**
   * Activate an effect NOW. `activate` runs immediately and RETURNS the
   * disposer (Cordis semantics). If activate throws, the scope unwinds
   * everything registered so far (fail = dispose) and rethrows. If activate
   * returns a non-function, throws a TypeError — a mock that gets the
   * semantics wrong cannot slip through.
   */
  register(activate: () => Disposer): void {
    if (this._disposed) {
      throw new Error('EffectScope: cannot register on a disposed scope');
    }
    let disposer: Disposer;
    try {
      disposer = activate();
    } catch (err) {
      // a failed activation tears down everything registered so far
      void this.dispose();
      throw err;
    }
    if (typeof disposer !== 'function') {
      throw new TypeError('effect activation must return a disposer function');
    }
    this._disposers.push(disposer);
  }

  /**
   * Register a bare disposer with no activation step (the effect has already
   * happened elsewhere; this only attaches the cleanup). Also disposes-once
   * semantics and LIFO unwind.
   */
  onDispose(fn: Disposer): void {
    this.register(() => fn);
  }

  /**
   * Unwind LIFO. Awaits async disposers. A throwing disposer does not block
   * the rest — the first error is rethrown after all disposers ran. Double
   * dispose is a no-op.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true; // set BEFORE running disposers so they may check
    let firstError: unknown;
    while (this._disposers.length > 0) {
      const disposer = this._disposers.pop()!;
      try {
        await disposer();
      } catch (err) {
        if (firstError === undefined) firstError = err;
      }
    }
    if (firstError !== undefined) throw firstError;
  }

  /** number of live registrations (no unregister exists) */
  get size(): number {
    return this._disposers.length;
  }

  get disposed(): boolean {
    return this._disposed;
  }
}
