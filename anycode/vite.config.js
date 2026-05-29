import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const backendPort = process.env.ANYCODE_PORT || "3000";
  const backendTarget = `http://localhost:${backendPort}`;

  return {
    plugins: [react()],
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
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
    },
  };
});
