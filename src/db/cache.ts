interface CacheEntry {
  value: unknown;
  expiresAt: number;
  tables: string[];
}

export class QueryCache {
  private readonly store = new Map<string, CacheEntry>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number, tables: string[]): void {
    if (ttlMs === 0) return;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, tables });
  }

  invalidateTable(tableName: string): void {
    for (const [key, entry] of this.store) {
      if (entry.tables.includes(tableName)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
