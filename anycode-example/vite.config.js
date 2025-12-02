import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    extensions: [".js"],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 3000,
    open: true
  }
});

