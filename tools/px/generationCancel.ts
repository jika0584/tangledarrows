export type CancelMode = 'none' | 'now' | 'after';

export class GenerationCancelled extends Error {
  readonly mode: 'now' | 'after';

  constructor(mode: 'now' | 'after') {
    super(mode === 'now' ? 'Generation stopped.' : 'Generation stopped after this puzzle.');
    this.name = 'GenerationCancelled';
    this.mode = mode;
  }
}

/** Shared cancel flag for the active PX generate / regenerate job. */
export class GenerationHandle {
  mode: CancelMode = 'none';

  request(mode: 'now' | 'after'): void {
    if (this.mode === 'now') return;
    this.mode = mode;
  }

  /** Abort between seed attempts or before the next puzzle. */
  throwIfNow(): void {
    if (this.mode === 'now') throw new GenerationCancelled('now');
  }

  /** True once the current puzzle should be the last one written. */
  stopAfterCurrent(): boolean {
    return this.mode === 'after' || this.mode === 'now';
  }
}

let active: GenerationHandle | null = null;

export function beginGeneration(): GenerationHandle {
  active = new GenerationHandle();
  return active;
}

export function endGeneration(handle: GenerationHandle): void {
  if (active === handle) active = null;
}

export function requestGenerationCancel(mode: 'now' | 'after'): void {
  active?.request(mode);
}

export function isGenerationCancelled(error: unknown): error is GenerationCancelled {
  return error instanceof GenerationCancelled;
}
