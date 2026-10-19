import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Relative base ('./') is REQUIRED for the packaged Electron app.
    // Electron loads dist/index.html over the file:// protocol, so absolute
    // '/assets/...' URLs would 404 and the desktop window would stay blank.
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // The window loads exactly this address. If port 3000 were busy and Vite silently took 3001, the app would open a
      // blank page, and browser storage (saved voices, history) is tied to the address, so it must never change.
      port: 3000,
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
