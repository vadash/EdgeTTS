import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', 'src/test/llm-real.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/test/**', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/index.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
});
