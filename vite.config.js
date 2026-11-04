import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    environmentMatchGlobs: [['tests/ui/**', 'jsdom']],
  },
});
