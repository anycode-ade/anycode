import { test, expect } from '@playwright/test';
import { DEMO_RESUME_TURN_COUNT, demoResumeUserPrompt } from '../demoSessionHistory';

// Same demo session as agent-search-virtualized: long enough that the virtualized list unmounts old turns.
const TURN_COUNT = DEMO_RESUME_TURN_COUNT;

// Selection.toString() may reflow whitespace, so compare text with whitespace removed.
const compact = (text: string) => text.replace(/\s+/g, '');

test.describe('Agent chat selection with virtualized turns', () => {
    test.setTimeout(300_000);

    // Regression: scrolling far away unmounted the selected turns, which collapsed the selection.
    test('a selection that spans turns survives a far scroll', async ({ page }) => {
        await page.goto('/');
        await page.getByTitle('Browse Demo Agent sessions').click();
        await page.getByRole('button', { name: 'Resume' }).click();
        await expect(page.locator('.acp-message-user', { hasText: demoResumeUserPrompt(TURN_COUNT) })).toBeVisible({ timeout: 10000 });
        await expect.poll(() => page.locator('[data-turn-key]').count()).toBeLessThan(TURN_COUNT);

        // Disengage auto-scroll follow before moving to the top.
        await page.locator('.acp-messages').dispatchEvent('wheel', { deltaY: -100 });
        await page.evaluate(() => {
            (document.querySelector('.acp-messages') as HTMLElement).scrollTop = 0;
        });
        await expect(page.locator('.acp-message-user', { hasText: demoResumeUserPrompt(1) })).toBeVisible();
        await expect.poll(() => page.locator('.acp-messages [data-turn-key]').count()).toBeGreaterThanOrEqual(5);

        const [startText, endText] = await page.evaluate(() => {
            const turns = [...document.querySelectorAll<HTMLElement>('.acp-messages [data-turn-key]')];
            const firstTextIn = (turn: HTMLElement) => {
                const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    if (node.textContent?.trim()) return node as Text;
                }
                throw new Error('turn has no text');
            };
            const first = firstTextIn(turns[0]);
            const later = firstTextIn(turns[4]);
            const range = document.createRange();
            range.setStart(first, 0);
            range.setEnd(later, later.length);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            return [first.data, later.data];
        });
        const startMarker = compact(startText).slice(0, 20);
        const endMarker = compact(endText).slice(0, 20);
        await expect.poll(async () => compact(await page.evaluate(() => window.getSelection()!.toString()))).toContain(startMarker);

        // Far scroll to the bottom: the turns in the selection must stay mounted.
        await page.evaluate(() => {
            const scroller = document.querySelector('.acp-messages') as HTMLElement;
            scroller.scrollTop = scroller.scrollHeight;
        });
        await expect.poll(() => page.evaluate(() => {
            const scroller = document.querySelector('.acp-messages') as HTMLElement;
            return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        })).toBeLessThanOrEqual(48);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        const selected = compact(await page.evaluate(() => window.getSelection()!.toString()));
        expect(selected).toContain(startMarker);
        expect(selected).toContain(endMarker);
    });
});
