import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  assetsInclude: ["**/*.wasm"],
  hot: true,
  build: {
    // Keep maps only for development packaging, not for production release embedding.
    sourcemap: mode === "development",
  },
}));
