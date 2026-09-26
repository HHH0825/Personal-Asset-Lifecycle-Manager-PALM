// Session-only read cache. Invalidation aborts stale reads and prevents their
// eventual completion from replacing newer data.
export function createDataStore(fetcher, { ttlMs = 60_000, now = () => Date.now() } = {}) {
  const entries = new Map();

  function isFresh(key) {
    const entry = entries.get(key);
    return Boolean(entry && entry.hasValue && now() - entry.savedAt < ttlMs);
  }

  function peek(key) {
    return isFresh(key) ? entries.get(key).value : undefined;
  }

  function load(key) {
    if (isFresh(key)) return Promise.resolve(entries.get(key).value);
    const previous = entries.get(key);
    if (previous?.promise) return previous.promise;
    const controller = new AbortController();
    const entry = { controller, hasValue: false, savedAt: 0, value: undefined, promise: null };
    entries.set(key, entry);
    entry.promise = Promise.resolve().then(() => fetcher(key, controller.signal)).then((value) => {
      if (entries.get(key) === entry) {
        entry.value = value;
        entry.hasValue = true;
        entry.savedAt = now();
        entry.promise = null;
        entry.controller = null;
      }
      return value;
    }, (error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    return entry.promise;
  }

  function invalidate(keys) {
    for (const key of keys) {
      const entry = entries.get(key);
      entries.delete(key);
      entry?.controller?.abort();
    }
  }

  function invalidateAll() { invalidate([...entries.keys()]); }
  function invalidateMatching(predicate) { invalidate([...entries.keys()].filter(predicate)); }
  function set(key, value) {
    invalidate([key]);
    entries.set(key, { value, hasValue: true, savedAt: now(), promise: null, controller: null });
  }

  return { load, peek, isFresh, invalidate, invalidateMatching, invalidateAll, clear: invalidateAll, set };
}
