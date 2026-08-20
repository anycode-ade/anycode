import { test, expect } from '@playwright/test';

test.describe('1,000,000 Lines Virtual Scroll Performance Benchmark', () => {
    test.beforeEach(async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (err) => {
            console.error('Page error caught:', err);
            errors.push(err.toString());
        });
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                console.error('Console error:', msg.text());
            }
        });

        await page.goto('/');
        (page as any)._pageErrors = errors;
    });

    test.afterEach(async ({ page }) => {
        const errors = (page as any)._pageErrors || [];
        expect(errors, `Uncaught page errors were detected: ${errors.join('; ')}`).toHaveLength(0);
    });

    test('Benchmark: Open 1M line file, jump to line 500,000, and smooth scroll performance', async ({ page }) => {
        test.setTimeout(60000);

        // 1. Wait for file tree to load
        const scrollDemoFile = page.getByText('scroll-demo.ts').first();
        await expect(scrollDemoFile).toBeVisible({ timeout: 10000 });

        // 2. Measure File Open Time
        console.log('\n======================================================');
        console.log('🚀 ANYCODE 1,000,000 LINES VIRTUAL SCROLL BENCHMARK');
        console.log('======================================================\n');

        const openStart = Date.now();
        await scrollDemoFile.click();

        // Wait for first line to render
        await expect(page.locator('.anyeditor .code .line').first()).toBeVisible({ timeout: 15000 });
        const openDuration = Date.now() - openStart;
        console.log(`⏱️  [1] File Open Time: ${openDuration} ms (1,000,000 lines)`);

        // Verify editor container is present
        const editorContainer = page.locator('.anyeditor').first();
        await expect(editorContainer).toBeVisible();

        // Get line height from computed style
        const editorMetrics = await editorContainer.evaluate((el: HTMLElement) => {
            const computed = window.getComputedStyle(el);
            const lh = parseFloat(computed.getPropertyValue('--anycode-line-height')) || 20;
            const scrollHeight = el.scrollHeight;
            const clientHeight = el.clientHeight;
            return { lineHeight: lh, scrollHeight, clientHeight };
        });

        console.log(`📏 Line height: ${editorMetrics.lineHeight}px | Total scroll height: ${(editorMetrics.scrollHeight / 1024 / 1024).toFixed(2)}M px`);

        // 3. Jump to Line 500,000
        const targetLine = 500000;
        const targetScrollTop = (targetLine - 1) * editorMetrics.lineHeight;

        const jumpStart = Date.now();
        await editorContainer.evaluate((el: HTMLElement, top: number) => {
            el.scrollTop = top;
            el.dispatchEvent(new Event('scroll'));
        }, targetScrollTop);

        // Wait for the target line or nearby lines to render in DOM
        await page.waitForFunction(
            ({ targetLine }) => {
                const gutters = Array.from(document.querySelectorAll('.anyeditor .gutter .ln'));
                const lineNumbers = gutters.map((g) => parseInt(g.textContent || '0', 10));
                return lineNumbers.some((num) => Math.abs(num - targetLine) <= 50);
            },
            { targetLine },
            { timeout: 10000 }
        );

        const jumpDuration = Date.now() - jumpStart;
        console.log(`⚡ [2] Jump to Line 500,000 Latency: ${jumpDuration} ms`);

        // Verify rendered content at line 500,000
        const lineContentAt500k = await editorContainer.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.anyeditor .code .line'));
            return lines.map((l) => l.textContent || '').filter(Boolean);
        });

        expect(lineContentAt500k.length).toBeGreaterThan(0);
        console.log(`📄 Rendered lines count at 500,000: ${lineContentAt500k.length}`);
        console.log(`   Sample line text: "${lineContentAt500k[0]?.substring(0, 60)}..."`);

        // 4. Benchmark Smooth Scroll Down (from line 500,000 down by 120 frames)
        console.log('\n📊 [3] Starting Smooth Scroll Benchmark...');

        const scrollMetrics = await editorContainer.evaluate(async (el: HTMLElement) => {
            const frameTimes: number[] = [];
            let blankFrames = 0;
            let lastTime = performance.now();
            const totalSteps = 120;
            const scrollDeltaPerFrame = 16; // ~16px per frame

            for (let step = 0; step < totalSteps; step++) {
                await new Promise<void>((resolve) => {
                    requestAnimationFrame((now) => {
                        const delta = now - lastTime;
                        lastTime = now;
                        frameTimes.push(delta);

                        // Perform scroll step
                        el.scrollTop += scrollDeltaPerFrame;
                        el.dispatchEvent(new Event('scroll'));

                        // Check for blank frame (whether visible lines exist and have non-empty text)
                        const renderedLines = el.querySelectorAll('.code .line');
                        if (renderedLines.length === 0) {
                            blankFrames++;
                        }

                        resolve();
                    });
                });
            }

            // Compute statistics (skip first frame warmup)
            const sampleFrames = frameTimes.slice(1);
            const totalDuration = sampleFrames.reduce((a, b) => a + b, 0);
            const avgFrameTime = totalDuration / sampleFrames.length;
            const sortedFrames = [...sampleFrames].sort((a, b) => a - b);
            const p50 = sortedFrames[Math.floor(sortedFrames.length * 0.5)];
            const p95 = sortedFrames[Math.floor(sortedFrames.length * 0.95)];
            const p99 = sortedFrames[Math.floor(sortedFrames.length * 0.99)];
            const maxFrameTime = Math.max(...sampleFrames);
            const minFrameTime = Math.min(...sampleFrames);
            const jankCount = sampleFrames.filter((t) => t > 16.67).length;
            const effectiveFps = 1000 / avgFrameTime;

            let memoryInfo: { usedJSHeapSizeMB?: number; totalJSHeapSizeMB?: number } = {};
            if ((performance as any).memory) {
                memoryInfo = {
                    usedJSHeapSizeMB: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024),
                    totalJSHeapSizeMB: Math.round((performance as any).memory.totalJSHeapSize / 1024 / 1024),
                };
            }

            return {
                totalSteps,
                totalDurationMs: Math.round(totalDuration),
                avgFrameTimeMs: parseFloat(avgFrameTime.toFixed(2)),
                p50Ms: parseFloat(p50.toFixed(2)),
                p95Ms: parseFloat(p95.toFixed(2)),
                p99Ms: parseFloat(p99.toFixed(2)),
                minFrameTimeMs: parseFloat(minFrameTime.toFixed(2)),
                maxFrameTimeMs: parseFloat(maxFrameTime.toFixed(2)),
                effectiveFps: parseFloat(effectiveFps.toFixed(1)),
                jankFramesCount: jankCount,
                blankFramesCount: blankFrames,
                memory: memoryInfo,
            };
        });

        console.log('\n======================================================');
        console.log('📈 BENCHMARK RESULTS SUMMARY (1,000,000 LINES)');
        console.log('======================================================');
        console.log(`⏱️  Open Duration:     ${openDuration} ms`);
        console.log(`⚡ Jump (Line 500k):   ${jumpDuration} ms`);
        console.log(`⏱️  Avg Frame Time:    ${scrollMetrics.avgFrameTimeMs} ms`);
        console.log(`🎯 p95 Frame Time:    ${scrollMetrics.p95Ms} ms`);
        console.log(`🎯 p99 Frame Time:    ${scrollMetrics.p99Ms} ms`);
        console.log(`📈 Max Frame Time:    ${scrollMetrics.maxFrameTimeMs} ms`);
        console.log(`🚀 Effective FPS:     ${scrollMetrics.effectiveFps} FPS`);
        console.log(`⚠️  Jank (>16.6ms):    ${scrollMetrics.jankFramesCount} / ${scrollMetrics.totalSteps} frames`);
        console.log(`✅ Blank Frames:      ${scrollMetrics.blankFramesCount} (0 is perfect)`);
        if (scrollMetrics.memory?.usedJSHeapSizeMB) {
            console.log(`💾 JS Heap Used:      ${scrollMetrics.memory.usedJSHeapSizeMB} MB`);
        }
        console.log('======================================================\n');

        // Assertions
        const highlightedSpansCount = await page.locator('.anyeditor .code .line span.keyword, .anyeditor .code .line span.type, .anyeditor .code .line span.function').count();
        expect(highlightedSpansCount).toBeGreaterThan(0);
        console.log(`🎨 Highlighted syntax tokens found on screen: ${highlightedSpansCount}`);

        expect(scrollMetrics.blankFramesCount).toBe(0);
        expect(scrollMetrics.avgFrameTimeMs).toBeLessThan(35);
        expect(openDuration).toBeLessThan(1500);
        expect(jumpDuration).toBeLessThan(1000);
    });

    test('Benchmark: Drag scrollbar thumb on 1,000,000 lines file with fastScroll buffer optimization', async ({ page }) => {
        test.setTimeout(30000);

        // 1. Open scroll-demo.ts
        const scrollDemoFile = page.getByText('scroll-demo.ts').first();
        await expect(scrollDemoFile).toBeVisible({ timeout: 10000 });
        await scrollDemoFile.click();

        const editorContainer = page.locator('.anyeditor').first();
        await expect(editorContainer).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.anyeditor .code .line').first()).toBeVisible();

        // 2. Locate scrollbar thumb
        const scrollbarThumb = page.locator('.smrt').first();
        await expect(scrollbarThumb).toBeAttached();

        const thumbBox = await scrollbarThumb.boundingBox();
        expect(thumbBox).not.toBeNull();

        if (!thumbBox) return;

        // 3. Perform scrollbar drag: drag thumb down by 200px
        const startX = thumbBox.x + thumbBox.width / 2;
        const startY = thumbBox.y + thumbBox.height / 2;

        const dragStart = Date.now();
        await page.mouse.move(startX, startY);
        await page.mouse.down();

        // Drag down across 30 steps
        for (let i = 1; i <= 30; i++) {
            await page.mouse.move(startX, startY + i * 5);
        }

        // Verify that during drag, lines are rendered
        const linesDuringDrag = await page.locator('.anyeditor .code .line').count();
        expect(linesDuringDrag).toBeGreaterThan(0);
        console.log(`🖱️  Lines rendered during scrollbar drag: ${linesDuringDrag}`);

        await page.mouse.up();
        const dragDuration = Date.now() - dragStart;
        console.log(`⏱️  Scrollbar drag test completed in ${dragDuration} ms`);

        // Wait a frame for expandBuffer
        await page.waitForTimeout(50);
        const linesAfterRelease = await page.locator('.anyeditor .code .line').count();
        console.log(`📄 Lines rendered after drag release: ${linesAfterRelease}`);
        expect(linesAfterRelease).toBeGreaterThanOrEqual(linesDuringDrag);
    });
});
