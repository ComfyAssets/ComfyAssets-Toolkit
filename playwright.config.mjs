import { defineConfig } from '@playwright/test';
const port = Number(process.env.TOOLKIT_TEST_PORT || 8772);
export default defineConfig({
    testDir: './tests/browser', outputDir: './test-results/browser',
    workers: 1, retries: 0, forbidOnly: Boolean(process.env.CI),
    use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    webServer: { command: 'node tools/browser-server.mjs', url: `http://127.0.0.1:${port}`, reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
    projects: [{ name: 'desktop' }, { name: 'touch', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } }],
});
