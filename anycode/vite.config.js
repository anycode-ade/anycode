import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const vendorChunk = (id) => {
  if (!id.includes("node_modules") && !id.includes("/anycode-base/")) {
    return undefined;
  }
  if (id.includes("web-tree-sitter") || id.includes("/anycode-base/")) {
    return "editor";
  }
  if (id.includes("@xterm/")) {
    return "terminal";
  }
  if (id.includes("react-markdown") || id.includes("remark-") || id.includes("micromark")) {
    return "markdown";
  }
  if (id.includes("dockview")) {
    return "dockview";
  }
  if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("scheduler")) {
    return "react";
  }
  return undefined;
};

export default defineConfig(({ mode }) => {
  const backendPort = process.env.ANYCODE_PORT || "3000";
  const backendTarget = `http://localhost:${backendPort}`;

  return {
    base: mode === "demo" ? "./" : "/",
    plugins: [react()],
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      alias: {
        "fs/promises": fileURLToPath(new URL("./shims/node-fs-promises.js", import.meta.url)),
        "module": fileURLToPath(new URL("./shims/node-module.js", import.meta.url)),
      },
    },
    assetsInclude: ["**/*.wasm"],
    hot: true,
    server: {
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      // Keep maps only for development packaging, not for production release embedding.
      sourcemap: mode === "development",
      rolldownOptions: {
        onLog(level, log, handler) {
          const isTreeSitterEval = log.code === "EVAL"
            && log.id?.includes("web-tree-sitter");
          if (!isTreeSitterEval) {
            handler(level, log);
          }
        },
        output: {
          manualChunks: vendorChunk,
        },
      },
    },
  };
});
