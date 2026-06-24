import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'tests/e2e/report', open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    // Capture console logs, screenshots on failure, videos on failure
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    // Grant audio permissions (Web Audio API needs them in some browsers)
    permissions: ['microphone'],
    // Keep browser open long enough for Web Audio to initialise
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },

  // Reuse the dev server already running on :3000 (started with DEV_OPEN=1)
  // For CI, spin a fresh one on :3007
  webServer: process.env.CI ? {
    command: 'DEV_OPEN=1 npx next dev --port 3007 --turbopack',
    url: 'http://localhost:3007',
    timeout: 90_000,
    env: { DEV_OPEN: '1' },
  } : undefined,

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Launch with audio support flags
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
})
