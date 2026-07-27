import { defineConfig, devices } from '@playwright/test'

const useLocalChrome = process.platform === 'darwin' && !process.env.CI
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const baseURL = externalBaseURL ?? 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useLocalChrome ? { channel: 'chrome' } : {}),
      },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command:
          'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
      },
})
