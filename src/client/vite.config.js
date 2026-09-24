import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load .env from the workspace root so the dev proxy targets the same port
  // the API server actually listens on (PORT), defaulting to 3000.
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiPort = env.PORT || '3000';

  return {
    root: __dirname,
    plugins: [react()],
    build: {
      outDir: path.resolve(__dirname, '../../dist'),
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
