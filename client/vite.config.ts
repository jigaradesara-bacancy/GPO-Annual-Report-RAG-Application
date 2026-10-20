/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:5001', changeOrigin: true, timeout: 600_000, proxyTimeout: 600_000 } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
});
