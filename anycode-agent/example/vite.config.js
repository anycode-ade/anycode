import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Examples run against the component source in this repo, not the npm build.
      // Remove this alias to use the published `anycode-agent` from node_modules.
      {
        find: /^anycode-agent$/,
        replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      },
      // Code blocks use the anycode editor source the same way.
      {
        find: /^anycode-editor-react$/,
        replacement: fileURLToPath(new URL("../../anycode-editor/react/src/index.ts", import.meta.url)),
      },
      {
        find: /^anycode-editor$/,
        replacement: fileURLToPath(new URL("../../anycode-editor/core/src/index.ts", import.meta.url)),
      },
    ],
    // The source resolves react from anycode-agent/node_modules; keep one copy so hooks work.
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 3003,
  },
});
