import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Rode pelos scripts do package.json (npm test / npm run test:integration): eles passam por
// scripts/vitest.mjs, que corrige a letra do drive no Windows.

// Só "@/..." aponta para src/. Um alias '@' puro também capturaria pacotes como @vitest/runner.
const alias = [{ find: /^@\//, replacement: `${path.resolve(__dirname, 'src')}/` }];

// unit:        npm test                  (sem banco, sem rede)
// integration: npm run test:integration  (Postgres + S3 + ffmpeg; ver docker-compose.test.yml)
export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      {
        resolve: { alias },
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
      },
    ],
  },
});
