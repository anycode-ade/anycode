import { test, expect, type Page } from '@playwright/test';

const startDemoAgent = async (page: Page) => {
    await page.getByTitle('Start Demo Agent in').click();
    const promptInput = page.getByPlaceholder('Ask anything...');
    await expect(promptInput).toBeEnabled({ timeout: 10000 });
    return promptInput;
};

const shrinkViewportForOverflow = async (page: Page, overflowPx: number) => {
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    const targetViewport = await page.evaluate((overflow) => {
        const scroller = document.querySelector('.acp-messages') as HTMLElement;
        const inner = document.querySelector('.acp-messages-inner') as HTMLElement;
        const emptyTemplates = document.querySelector('.acp-empty-templates-wrapper') as HTMLElement;
        const input = document.querySelector('.acp-input') as HTMLElement;

        const innerStyle = getComputedStyle(inner);
        const inputStyle = getComputedStyle(input);
        const naturalHeight =
            parseFloat(innerStyle.paddingTop) +
            parseFloat(innerStyle.paddingBottom) +
            emptyTemplates.getBoundingClientRect().height +
            parseFloat(inputStyle.marginTop) +
            input.getBoundingClientRect().height;

        const desiredClientHeight = naturalHeight - overflow;
        const delta = scroller.clientHeight - desiredClientHeight;
        return {
            width: window.innerWidth,
            height: Math.max(240, Math.round(window.innerHeight - delta)),
        };
    }, overflowPx);

    await page.setViewportSize(targetViewport);

    await expect.poll(() => page.evaluate(() => {
        const scroller = document.querySelector('.acp-messages') as HTMLElement;
        return scroller.scrollHeight - scroller.clientHeight;
    })).toBeGreaterThanOrEqual(4);

    await expect.poll(() => page.evaluate(() => {
        const scroller = document.querySelector('.acp-messages') as HTMLElement;
        return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    })).toBeLessThan(2);
};

const attachPageErrorTracker = (page: Page) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
        errors.push(err.toString());
    });
    return errors;
};

test.describe('Agent prompt input and auto-scroll', () => {
    // Regression: typing in a 2+ line textarea used to briefly collapse it to height='auto' (1 row),
    // clamping .acp-messages.scrollTop toward 0 on every keystroke.
    test('typing in a multi-line prompt does not jump scrollTop upward', async ({ page }) => {
        const errors = attachPageErrorTracker(page);
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/');

        const promptInput = await startDemoAgent(page);
        await expect(page.locator('.acp-empty-templates-wrapper')).toBeVisible({ timeout: 10000 });

        await promptInput.click();
        await promptInput.pressSequentially('first line');
        await promptInput.press('Shift+Enter');
        await promptInput.pressSequentially('second line ');

        await expect.poll(() => promptInput.evaluate((el) => el.clientHeight)).toBeGreaterThanOrEqual(44);
        await shrinkViewportForOverflow(page, 18);

        const initialTop = await page.evaluate(() => {
            const scroller = document.querySelector('.acp-messages') as HTMLElement;
            const win = window as typeof window & {
                __scrollDrops?: number[];
                __minScrollTop?: number;
            };
            win.__scrollDrops = [];
            win.__minScrollTop = scroller.scrollTop;

            let prevTop = scroller.scrollTop;
            const checkScroll = () => {
                const top = scroller.scrollTop;
                if (top < win.__minScrollTop!) win.__minScrollTop = top;
                if (top < prevTop - 0.5) {
                    win.__scrollDrops!.push(prevTop - top);
                }
                prevTop = top;
            };
            scroller.addEventListener('scroll', checkScroll);
            return scroller.scrollTop;
        });

        expect(initialTop).toBeGreaterThan(2);

        await promptInput.pressSequentially('typing more text', { delay: 25 });
        await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));

        const metrics = await page.evaluate(() => {
            const scroller = document.querySelector('.acp-messages') as HTMLElement;
            const win = window as typeof window & {
                __scrollDrops?: number[];
                __minScrollTop?: number;
            };
            return {
                drops: win.__scrollDrops ?? [],
                minScrollTop: win.__minScrollTop ?? scroller.scrollTop,
                finalScrollTop: scroller.scrollTop,
                gap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
            };
        });

        expect(metrics.drops).toEqual([]);
        expect(metrics.minScrollTop).toBeGreaterThanOrEqual(initialTop - 0.5);
        expect(metrics.finalScrollTop).toBeGreaterThanOrEqual(initialTop - 0.5);
        expect(metrics.gap).toBeLessThan(2);
        await expect(page.getByRole('button', { name: 'Enable auto-scroll' })).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    // Regression: followBottom() used to spin indefinitely when subpixel scrollHeight rounding kept
    // gap < 2 (e.g. 0.5px on Retina) or when gap === 2 rounded easing increments back to 0px.
    for (const deviceScaleFactor of [1, 2] as const) {
        test(`followBottom settles and stops looping on ${deviceScaleFactor}x display`, async ({ browser }) => {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 800 },
                deviceScaleFactor,
            });
            const page = await context.newPage();
            const errors = attachPageErrorTracker(page);

            try {
                await page.goto('/');
                const promptInput = await startDemoAgent(page);
                await expect(page.locator('.acp-empty-templates-wrapper')).toBeVisible({ timeout: 10000 });

                await shrinkViewportForOverflow(page, 16);

                await page.evaluate(() => {
                    const scroller = document.querySelector('.acp-messages') as HTMLElement;
                    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
                    const win = window as typeof window & { __scrollTopWrites?: number };
                    win.__scrollTopWrites = 0;

                    Object.defineProperty(scroller, 'scrollTop', {
                        configurable: true,
                        get() {
                            return desc.get!.call(this);
                        },
                        set(value: number) {
                            win.__scrollTopWrites = (win.__scrollTopWrites ?? 0) + 1;
                            desc.set!.call(this, value);
                        },
                    });
                });

                await promptInput.click();
                await promptInput.press('Shift+Enter');
                await promptInput.press('Shift+Enter');

                await expect.poll(() => page.evaluate(() => {
                    const scroller = document.querySelector('.acp-messages') as HTMLElement;
                    return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
                })).toBeLessThan(2);

                const idleWrites = await page.evaluate(() => new Promise<number>((resolve) => {
                    const win = window as typeof window & { __scrollTopWrites?: number };
                    win.__scrollTopWrites = 0;
                    setTimeout(() => resolve(win.__scrollTopWrites ?? 0), 300);
                }));

                expect(idleWrites).toBe(0);
                await expect(page.getByRole('button', { name: 'Enable auto-scroll' })).toHaveCount(0);
                expect(errors).toEqual([]);
            } finally {
                await context.close();
            }
        });
    }
});
