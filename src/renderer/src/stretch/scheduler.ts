import { rateCacheKey, rateFromKey } from "./cache";
import { isStretchCancelled } from "./errors";

/**
 * Coordinates offline time-stretch requests.
 *
 * Two properties matter for playback:
 *  - the same rate is rendered at most once, even when `play()` and
 *    `applySpeed()` race (they await the same promise);
 *  - a finished render is written to the cache even if the user already paused
 *    or stopped, so a later play at that rate is instant. Only *starting
 *    playback* depends on the caller's intent, not the cache fill.
 */

export interface StretchResult {
  key: string;
  /** Effective rate the buffer was rendered at; use it as the content rate. */
  rate: number;
  buffer: AudioBuffer;
}

export interface StretchSchedulerDeps {
  /** Current source buffer, or null when no audio is loaded. */
  source(): AudioBuffer | null;
  /** Read a cached result for a canonical rate key. */
  get(key: string): AudioBuffer | null;
  /** Store a finished result for a canonical rate key. */
  put(key: string, buffer: AudioBuffer): void;
  /** Perform the actual render (quantized value passed for consistency). */
  render(source: AudioBuffer, rate: number): Promise<AudioBuffer>;
  /** Changes on audio load / engine change; stale results are discarded. */
  epoch(): number;
  onPending?(pending: boolean): void;
  onError?(error: unknown, key: string): void;
}

interface Job {
  promise: Promise<StretchResult | null>;
  epoch: number;
}

export class StretchScheduler {
  private jobs = new Map<string, Job>();

  constructor(private readonly deps: StretchSchedulerDeps) {}

  /** True while at least one render is in flight. */
  get pending(): boolean {
    return this.jobs.size > 0;
  }

  /** Canonical key for a rate, exposed for cache pinning. */
  keyFor(rate: number): string {
    return rateCacheKey(rate);
  }

  request(rate: number): Promise<StretchResult | null> {
    const key = rateCacheKey(rate);
    const effective = rateFromKey(key);

    const cached = this.deps.get(key);
    if (cached)
      return Promise.resolve({ key, rate: effective, buffer: cached });

    const running = this.jobs.get(key);
    if (running) {
      // A job from an invalidated epoch will be discarded, so do not let it
      // satisfy a request made against the new audio / engine.
      if (running.epoch === this.deps.epoch()) return running.promise;
      this.jobs.delete(key);
    }

    const source = this.deps.source();
    if (!source) return Promise.resolve(null);

    const epoch = this.deps.epoch();
    const jobRef: { promise?: Promise<StretchResult | null> } = {};
    if (this.jobs.size === 0) this.deps.onPending?.(true);

    const promise = (async (): Promise<StretchResult | null> => {
      try {
        const buffer = await this.deps.render(source, effective);
        if (this.deps.epoch() !== epoch) return null;
        this.deps.put(key, buffer);
        return { key, rate: effective, buffer };
      } catch (error) {
        if (!isStretchCancelled(error) && this.deps.epoch() === epoch) {
          this.deps.onError?.(error, key);
        }
        return null;
      } finally {
        if (jobRef.promise && this.jobs.get(key)?.promise === jobRef.promise) {
          this.jobs.delete(key);
        }
        if (this.jobs.size === 0) this.deps.onPending?.(false);
      }
    })();

    jobRef.promise = promise;
    this.jobs.set(key, { promise, epoch });
    return promise;
  }

  /** Forget bookkeeping. In-flight renders only fail to populate a new epoch. */
  clear(): void {
    this.jobs.clear();
  }
}
