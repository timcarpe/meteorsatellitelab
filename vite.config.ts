import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
import snapshot from './src/meteor_station/data/orbits.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    viteSingleFile(),
    {
      name: 'development-orbit-snapshot',
      configureServer(server) {
        server.middlewares.use('/api/orbits', (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(snapshot));
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@meteor': fileURLToPath(new URL('./src/meteor_station', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/meteor_station/{core,orbit,timetable,decoder,radio,server}/*.ts'],
      exclude: ['**/decoder.worker.ts', '**/wasm.ts', '**/worker-session.ts'],
      thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
      reporter: ['text', 'json-summary'],
    },
  },
});
