// Agent response cache — SCAFFOLDING. Not imported anywhere under agents/.
// Activation point: agents/shared.js runJsonAgent(), gated on the Settings
// flag `scaling.cache.enabled`. See lib/README.md.
//
// Every implementation satisfies this interface:
//   get(key)                       -> value | undefined
//   set(key, value, ttlMs?)        -> void
//   getOrCompute(key, fn, ttlMs?)  -> Promise<value>
//   stats()                        -> { hits, misses, size }

import { agentCacheKey, contentHash } from "./key.js";

export { agentCacheKey, contentHash };

// Default while the layer is inert: every lookup misses, nothing is stored,
// so wrapping a call in getOrCompute() is a no-op passthrough.
export class NoopCache {
  constructor() {
    this.hits = 0;
    this.misses = 0;
  }
  get() {
    this.misses++;
    return undefined;
  }
  set() {}
  async getOrCompute(_key, fn) {
    this.misses++;
    return fn();
  }
  stats() {
    return { hits: this.hits, misses: this.misses, size: 0 };
  }
}

// Working implementation: process-local LRU with per-entry TTL. Suitable for
// a single-process deployment. Swap for a SQLite- or Redis-backed store when
// the app runs multiple workers.
export class InMemoryCache {
  constructor({ maxEntries = 500, defaultTtlMs = 6 * 60 * 60 * 1000 } = {}) {
    this.map = new Map(); // insertion order == LRU order
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.hits = 0;
    this.misses = 0;
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // touch: move to newest
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }
  set(key, value, ttlMs = this.defaultTtlMs) {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
  }
  async getOrCompute(key, fn, ttlMs) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }
  stats() {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }
}

// Factory the pipeline would call once activated:
//   const cache = createAgentCache(store.getSettings().scaling.cache);
export function createAgentCache({ enabled = false } = {}) {
  return enabled ? new InMemoryCache() : new NoopCache();
}
