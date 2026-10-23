import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE || '/admin/',
  plugins: [react()],
  server: { port: 5174, allowedHosts: true, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } }, hmr: process.env.VITE_HMR_CLIENT_PORT ? { clientPort: Number(process.env.VITE_HMR_CLIENT_PORT) } : undefined },
});
