import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  plugins: [
    webExtension({
      manifest: 'manifest.json',
      webExtConfig: {
        startUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
