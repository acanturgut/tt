// Node 25 enables Web Storage by default, so `globalThis.localStorage` exists but
// is an unusable stub without --localstorage-file. Under vitest that stub lands on
// the jsdom window too, shadowing jsdom's working Storage — every localStorage
// call then throws (or gets swallowed by a try/catch and silently reads empty).
// Install a real in-memory Storage instead: fresh per run, so tests stay
// deterministic rather than inheriting a file's leftovers.
// ponytail: swap for jsdom's own Storage if vitest ever stops clobbering it.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(String(k)) ?? null,
    setItem: (k, v) => void m.set(String(k), String(v)),
    removeItem: (k) => void m.delete(String(k)),
    clear: () => m.clear(),
  } as Storage;
}

if (typeof globalThis.localStorage?.setItem !== 'function') {
  const store = memoryStorage();
  for (const target of [globalThis, globalThis.window]) {
    if (target) Object.defineProperty(target, 'localStorage', { value: store, configurable: true });
  }
}
