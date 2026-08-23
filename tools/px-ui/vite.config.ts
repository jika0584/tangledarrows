import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          return startup([join(root, 'dist-electron/main.js'), '--no-sandbox']);
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', 'node:sqlite', 'node:fs', 'node:path', 'node:url', 'node:os'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
});
