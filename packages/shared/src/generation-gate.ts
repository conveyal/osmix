export interface GenerationGateOptions {
  initialGeneration?: number;
  /** Force shared or RPC-updated state. Defaults to SharedArrayBuffer availability. */
  shared?: boolean;
}

export interface GenerationGateTransferables {
  generation: number;
  sharedGeneration?: SharedArrayBuffer;
}

const normalizeGeneration = (generation: number): number =>
  Math.max(0, Math.min(0x7fff_ffff, Math.trunc(generation)));

/**
 * Monotonic generation-based cancellation shared between a dispatcher and worker jobs.
 *
 * SharedArrayBuffer runtimes observe advances immediately through Atomics. Other runtimes copy
 * the current generation and call {@link update} through their existing RPC transport.
 */
export class GenerationGate {
  private fallbackGeneration: number;
  private readonly sharedGeneration: Int32Array<SharedArrayBuffer> | null;

  private constructor(
    generation: number,
    sharedGeneration: Int32Array<SharedArrayBuffer> | null,
    initializeSharedState: boolean,
  ) {
    this.fallbackGeneration = normalizeGeneration(generation);
    this.sharedGeneration = sharedGeneration;
    if (sharedGeneration && initializeSharedState) {
      Atomics.store(sharedGeneration, 0, this.fallbackGeneration);
    }
  }

  static create(options: GenerationGateOptions = {}): GenerationGate {
    const generation = normalizeGeneration(options.initialGeneration ?? 0);
    const useShared = options.shared ?? typeof SharedArrayBuffer !== "undefined";
    if (!useShared) return new GenerationGate(generation, null, false);
    if (typeof SharedArrayBuffer === "undefined") {
      throw new Error("SharedArrayBuffer is unavailable in this runtime");
    }
    return new GenerationGate(generation, new Int32Array(new SharedArrayBuffer(4)), true);
  }

  static fromTransferables(transferables: GenerationGateTransferables): GenerationGate {
    const sharedGeneration = transferables.sharedGeneration
      ? new Int32Array(transferables.sharedGeneration)
      : null;
    // The descriptor may have been captured before the dispatcher advanced the shared value.
    // Wrapping an existing SAB must never write that stale snapshot back into shared state.
    return new GenerationGate(transferables.generation, sharedGeneration, false);
  }

  get generation(): number {
    return this.sharedGeneration ? Atomics.load(this.sharedGeneration, 0) : this.fallbackGeneration;
  }

  get hasSharedState(): boolean {
    return this.sharedGeneration !== null;
  }

  advance(): number {
    const current = this.generation;
    if (current === 0x7fff_ffff) throw new Error("Generation limit reached");
    return this.update(current + 1);
  }

  /** Apply an RPC-delivered generation, ignoring stale updates. */
  update(generation: number): number {
    const next = normalizeGeneration(generation);
    if (this.sharedGeneration) {
      let current = Atomics.load(this.sharedGeneration, 0);
      while (next > current) {
        const previous = Atomics.compareExchange(this.sharedGeneration, 0, current, next);
        if (previous === current) return next;
        current = previous;
      }
      return current;
    }
    this.fallbackGeneration = Math.max(this.fallbackGeneration, next);
    return this.fallbackGeneration;
  }

  isCurrent(generation: number): boolean {
    return normalizeGeneration(generation) === this.generation;
  }

  isCancelled(generation: number): boolean {
    return normalizeGeneration(generation) < this.generation;
  }

  transferables(): GenerationGateTransferables {
    return {
      generation: this.generation,
      ...(this.sharedGeneration ? { sharedGeneration: this.sharedGeneration.buffer } : {}),
    };
  }
}
