import { defineConfig, devices } from '@playwright/test';

import { journeyApiOrigin, journeyRpcUrl } from './e2e/fixtures/journey-fixture';

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: process.env.CI ? [['github'], ['line']] : 'line',
  retries: process.env.CI ? 1 : 0,
  testDir: './e2e',
  testMatch: '**/*.journey.ts',
  timeout: 20_000,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bunx next dev -p 3001 --hostname 127.0.0.1',
    env: {
      NEXT_PUBLIC_DUEL_API_URL: journeyApiOrigin,
      NEXT_PUBLIC_E2E_FIXTURES: '1',
      NEXT_PUBLIC_SOLANA_RPC_URL: journeyRpcUrl,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:3001/overview',
  },
  workers: process.env.CI ? 1 : undefined,
});
