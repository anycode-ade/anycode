import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    retries: 0,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:5174',
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'pnpm dev:demo -- --port 5174',
        url: 'http://localhost:5174',
        reuseExistingServer: false,
        timeout: 120 * 1000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], channel: 'chrome' },
        },
    ],
});
