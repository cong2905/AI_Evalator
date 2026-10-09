import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The API binds to 127.0.0.1 only, so target it explicitly (not 'localhost',
      // which can resolve to ::1 on Windows).
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
});
