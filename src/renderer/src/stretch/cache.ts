/**
 * Bounded LRU cache for pitch-preserving time-stretch results.
 *
 * A stretched buffer costs `length * channels * 4` bytes, so a long track can
 * easily reach hundreds of MB per playback rate. The cache is therefore byte
 * bounded (LRU eviction) instead of count bounded, and the entry used by the
 * current playback is pinned so a short second rate cannot evict the audible
 * one. A single entry larger than the whole budget is still kept: the buffer
 * already exists in memory by the time it is offered, and dropping it would
 * only force a re-render without freeing anything.
 */

/** Playback rates are compared and rendered at this precision (1/1000). */
const RATE_SCALE = 1000;

/** Canonical cache key for a playback rate, quantized to 3 decimals. */
export function rateCacheKey(rate: number): string {
  const safe = Number.isFinite(rate) ? rate : 1;
  return (Math.round(safe * RATE_SCALE) / RATE_SCALE).toFixed(3);
}

/** Numeric rate a cache key stands for (use it as the content rate). */
export function rateFromKey(key: string): number {
  const n = Number(key);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Bytes an AudioBuffer occupies in memory (Float32 PCM). */
export function audioBufferBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

interface CacheEntry {
  buffer: AudioBuffer;
  bytes: number;
}

export class StretchCache {
  private entries = new Map<string, CacheEntry>();
  private bytes = 0;
  private maxBytes: number;
  private pinnedKey: string | null = null;

  constructor(maxBytes: number) {
    this.maxBytes = Math.max(0, maxBytes);
  }

  get size(): number {
    return this.entries.size;
  }

  get sizeBytes(): number {
    return this.bytes;
  }

  get limitBytes(): number {
    return this.maxBytes;
  }

  get pinned(): string | null {
    return this.pinnedKey;
  }

  get(key: string): AudioBuffer | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    // Refresh recency: delete + re-insert moves it to the newest slot.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.buffer;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  put(key: string, buffer: AudioBuffer): void {
    const bytes = audioBufferBytes(buffer);
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.bytes -= previous.bytes;
    }
    this.entries.set(key, { buffer, bytes });
    this.bytes += bytes;
    // Keep the just-added entry: it is the result the caller is about to play,
    // and it may be the only entry when a pinned one already exceeds the budget.
    this.evict(key);
  }

  /** Pin the entry used by the current playback; pass null to unpin. */
  pin(key: string | null): void {
    this.pinnedKey = key;
    if (key && !this.entries.has(key)) this.pinnedKey = null;
    // Moving the pin can make the previous entry evictable again.
    this.evict();
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    if (this.pinnedKey === key) this.pinnedKey = null;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.pinnedKey = null;
  }

  setMaxBytes(maxBytes: number): void {
    this.maxBytes = Math.max(0, maxBytes);
    this.evict();
  }

  private evict(keepKey?: string): void {
    // Keep at least one entry: an oversize buffer is already allocated and is
    // the one playback needs right now.
    while (this.entries.size > 1 && this.bytes > this.maxBytes) {
      let victim: string | null = null;
      for (const key of this.entries.keys()) {
        if (key !== this.pinnedKey && key !== keepKey) {
          victim = key;
          break;
        }
      }
      if (!victim) break;
      this.delete(victim);
    }
  }
}
