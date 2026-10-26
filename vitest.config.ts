import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts', '**/.delta/**'],
  },
  resolve: {
    alias: {
      'anycode-agent': resolve(__dirname, './anycode-agent/src'),
      'anycode-editor': resolve(__dirname, './anycode-editor/core/src'),
      'anycode-editor-react': resolve(__dirname, './anycode-editor/react/src'),
    },
  },
});
