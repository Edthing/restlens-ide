/**
 * Diagnostics Cache
 *
 * LRU cache for storing diagnostics results keyed by content hash.
 */

import { Diagnostic } from "vscode-languageserver/node";
import { LRUCache } from "lru-cache";
import { createHash } from "crypto";

interface CacheEntry {
  diagnostics: Diagnostic[];
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100;

export class DiagnosticsCache {
  private cache: LRUCache<string, CacheEntry>;

  constructor() {
    this.cache = new LRUCache({
      max: CACHE_MAX_SIZE,
      ttl: CACHE_TTL_MS,
    });
  }

  /**
   * Get cached diagnostics for content.
   */
  get(content: string): Diagnostic[] | null {
    const key = this.hashContent(content);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if entry is stale
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.diagnostics;
  }

  /**
   * Cache diagnostics for content.
   */
  set(content: string, diagnostics: Diagnostic[]): void {
    const key = this.hashContent(content);
    this.cache.set(key, {
      diagnostics,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Hash content for cache key.
   */
  private hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
