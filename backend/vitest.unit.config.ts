import { defineConfig } from 'vitest/config';

// Pure unit tests only: no database, so the migrate-reset global setup of vitest.config.ts is not used.
export default defineConfig({ test: { include: ['tests/**/*.unit.test.ts'], env: { NODE_ENV: 'test' } } });
