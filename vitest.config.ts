import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts'],
  },
  resolve: {
    alias: {
      'anycode-base': resolve(__dirname, './anycode-base/src'),
      'anycode-react': resolve(__dirname, './anycode-react/src'),
    },
  },
});
