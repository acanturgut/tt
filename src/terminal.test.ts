import { test, expect } from 'vitest';
import wasmB64 from 'virtual:ghostty-wasm';

// The release bug was WebAssembly.compile choking on non-wasm bytes ("doesn't start with
// '\0asm'"). Guard the inline path: the bundled base64 must decode to a real wasm module.
test('inlined ghostty wasm decodes to a compilable module', async () => {
  const bin = atob(wasmB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  expect([...bytes.slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]); // \0asm magic
  await expect(WebAssembly.compile(bytes)).resolves.toBeInstanceOf(WebAssembly.Module);
});
