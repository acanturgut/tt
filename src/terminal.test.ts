import { test, expect } from 'vitest';
import { init } from 'ghostty-web';
import wasmB64 from 'virtual:ghostty-wasm';
import { isGhosttyWasmUrl } from './terminal';

function bytes(): Uint8Array {
  const bin = atob(wasmB64);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

// The release bug was WebAssembly.compile choking on non-wasm bytes ("doesn't start with
// '\0asm'"). Guard the inline path: the bundled base64 must decode to a real wasm module.
test('inlined ghostty wasm decodes to a compilable module', async () => {
  const b = bytes();
  expect([...b.slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]); // \0asm magic
  await expect(WebAssembly.compile(b)).resolves.toBeInstanceOf(WebAssembly.Module);
});

test('shim matches the URLs init() actually fetches', () => {
  expect(isGhosttyWasmUrl('data:application/wasm;base64,AGFzbQ')).toBe(true);
  expect(isGhosttyWasmUrl('./ghostty-vt.wasm')).toBe(true);
  expect(isGhosttyWasmUrl('/ghostty-vt.wasm')).toBe(true);
  expect(isGhosttyWasmUrl('ipc://localhost/plugin')).toBe(false);
});

// The real proof: run ghostty's own init() with the fetch shim in place. init() ignores
// args and fetches its data: URL candidate; the shim must intercept that and feed it our
// in-memory bytes, and ghostty must compile+instantiate them successfully.
test('ghostty init() loads through the fetch shim', async () => {
  const b = bytes();
  let shimHit = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, opts?: RequestInit) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (isGhosttyWasmUrl(u)) {
      shimHit = true;
      return Promise.resolve(new Response(b, { headers: { 'Content-Type': 'application/wasm' } }));
    }
    return realFetch(input, opts);
  }) as typeof fetch;
  try {
    await expect(init()).resolves.toBeUndefined();
  } finally {
    globalThis.fetch = realFetch;
  }
  expect(shimHit).toBe(true);
});
