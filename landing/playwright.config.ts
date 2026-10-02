import { defineConfig, devices } from '@playwright/test';
import { writerUrl } from './test/helpers';

const PORT = 3100;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './test/e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx tsx scripts/dev-server.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DATABASE_URL: writerUrl(),
      ALLOWED_ORIGINS: `http://localhost:${PORT}`,
      PRIVACY_POLICY_VERSION: '2026-10-15',
      LOG_HASH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-000000',
      // Todas las pruebas salen de 127.0.0.1: el límite real se prueba en integración (prueba 11).
      RATE_LIMIT_IP_PER_MINUTE: '10000',
      RATE_LIMIT_EMAIL_PER_DAY: '10000',
    },
  },
});
