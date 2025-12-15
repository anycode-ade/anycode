import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      'anycode-base': resolve(__dirname, './anycode-base/src'),
      'anycode-react': resolve(__dirname, './anycode-react/src'),
    },
  },
});
