import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Inline ghostty's wasm as a base64 string in the JS bundle. Vite's own wasm handling
// (?url / ?inline) always emits a separate .wasm asset, and Tauri's asset protocol fails
// to serve it in the notarized release build — the fetch comes back as index.html, so
// WebAssembly.compile chokes ("doesn't start with '\0asm'"). Embedding the bytes in the
// bundle means terminal.ts can build a blob: URL from memory and never touch the asset
// server. `import wasm from "virtual:ghostty-wasm"` → the base64 string.
function inlineGhosttyWasm() {
  const virtualId = "virtual:ghostty-wasm";
  const resolvedId = "\0" + virtualId;
  return {
    name: "inline-ghostty-wasm",
    resolveId(id: string) {
      return id === virtualId ? resolvedId : null;
    },
    load(id: string) {
      if (id !== resolvedId) return null;
      const b64 = readFileSync("node_modules/ghostty-web/ghostty-vt.wasm").toString("base64");
      return `export default ${JSON.stringify(b64)};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({

  plugins: [inlineGhosttyWasm()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
}));
