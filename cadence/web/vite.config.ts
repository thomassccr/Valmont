import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Le front passe par un proxy : même origine que l'API, donc cookies de session simples.
    proxy: { '/api': { target: API, changeOrigin: true } },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', sourcemap: false },
});
