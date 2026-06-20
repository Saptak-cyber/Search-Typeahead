import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy API calls to the Express backend so the frontend can use same-origin paths.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/suggest': 'http://localhost:4000',
      '/search': 'http://localhost:4000',
      '/trending': 'http://localhost:4000',
      '/cache': 'http://localhost:4000',
      '/stats': 'http://localhost:4000',
    },
  },
});
