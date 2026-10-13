import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base: './' — чтобы собранный интерфейс открывался из file:// внутри Electron.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
