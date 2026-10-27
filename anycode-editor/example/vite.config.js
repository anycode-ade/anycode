import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      // Examples run against the editor source in this repo, not the npm build.
      // Remove this alias to use the published `anycode-editor` from node_modules.
      {
        find: /^anycode-editor$/,
        replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      },
    ],
  },
  assetsInclude: ["**/*.wasm"],
  server: {
    port: 3000,
    open: true,
  },
});
