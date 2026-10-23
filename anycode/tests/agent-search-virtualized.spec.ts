import { test, expect, type Page } from '@playwright/test';
import {
    DEMO_RESUME_MARKED_TURNS,
    DEMO_RESUME_QUERY,
    DEMO_RESUME_TURN_COUNT,
    demoResumeUserPrompt,
} from '../demoSessionHistory';

// The demo session is resumed from the Sessions list, so its history is replayed without driving prompts.
// Enough turns that the virtualized list keeps only the bottom of the chat mounted.
const TURN_COUNT = DEMO_RESUME_TURN_COUNT;
const QUERY = DEMO_RESUME_QUERY;
// Turns whose prompt and answer contain QUERY. The first one must end up unmounted (asserted below).
const MARKED_TURNS = DEMO_RESUME_MARKED_TURNS;
// Per marked turn the user prompt and the answer both contain the query.
const EXPECTED_MATCHES = MARKED_TURNS.length * 2;

// Reads the active search highlight and checks that it sits inside the messages scroller.
const currentHighlight = (page: Page) => page.evaluate(() => {
    const current = CSS.highlights.get('acp-search-current');
    const scroller = document.querySelector('.acp-messages');
    if (!current || current.size !== 1 || !scroller) return null;
    const range = [...current][0] as Range;
    const rect = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    return {
        text: range.toString(),
        inView: rect.height > 0 && rect.top >= box.top && rect.bottom <= box.bottom,
    };
});

test.describe('Agent chat search with virtualized turns', () => {
    test.setTimeout(300_000);

    // Regression: replayed history used to switch auto-scroll off, leaving the list mid-history.
    test('resumed session follows the latest message without a manual scroll', async ({ page }) => {
        await page.goto('/');
        await page.getByTitle('Browse Demo Agent sessions').click();
        await page.getByRole('button', { name: 'Resume' }).click();
        await expect(page.locator('.acp-message-user', { hasText: demoResumeUserPrompt(TURN_COUNT) })).toBeVisible({ timeout: 10000 });

        // The list settles at the bottom on its own, and the jump-to-latest button is never shown.
        await expect.poll(() => page.evaluate(() => {
            const scroller = document.querySelector('.acp-messages') as HTMLElement;
            return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        })).toBeLessThanOrEqual(48);
        await expect(page.getByRole('button', { name: 'Enable auto-scroll' })).toHaveCount(0);
    });

    test('finds, scrolls to and highlights matches outside the mounted window', async ({ page }) => {
        await page.goto('/');
        // Demo mode seeds the Demo Agent on first run. Resuming its stored session replays the whole conversation.
        await page.getByTitle('Browse Demo Agent sessions').click();
        await page.getByRole('button', { name: 'Resume' }).click();
        // The whole history arrives in one replay, so any painted prompt means it has loaded. Where the list
        // opens (top, middle or bottom) does not matter here; the checks below only need old turns unmounted.
        await expect(page.locator('.acp-message-user').first()).toBeVisible({ timeout: 10000 });

        // The test only means something if older turns are really unmounted.
        await expect.poll(() => page.locator('[data-turn-key]').count()).toBeLessThan(TURN_COUNT);
        await expect(page.locator('.acp-message-user', { hasText: demoResumeUserPrompt(MARKED_TURNS[0]) })).toHaveCount(0);

        await page.keyboard.press('Control+f');
        const conversationSearch = page.getByRole('search').getByLabel('Find in conversation');
        await expect(conversationSearch).toBeFocused();
        await conversationSearch.fill(QUERY);

        const count = page.locator('.acp-search-count');
        await expect(count).toHaveText(`1 / ${EXPECTED_MATCHES}`);
        // First match is in an unmounted turn: the list must scroll there and paint the highlight.
        await expect.poll(() => currentHighlight(page)).toEqual({ text: QUERY, inView: true });
        await expect(page.locator('.acp-message-user', { hasText: demoResumeUserPrompt(MARKED_TURNS[0]) })).toHaveCount(1);

        // Step forward through every match, including the jump to the second marked turn.
        for (let match = 2; match <= EXPECTED_MATCHES; match++) {
            await conversationSearch.press('Enter');
            await expect(count).toHaveText(`${match} / ${EXPECTED_MATCHES}`);
            await expect.poll(() => currentHighlight(page)).toEqual({ text: QUERY, inView: true });
        }

        // Wrap around to the first match, then go backwards across the unmounted gap.
        await conversationSearch.press('Enter');
        await expect(count).toHaveText(`1 / ${EXPECTED_MATCHES}`);
        await expect.poll(() => currentHighlight(page)).toEqual({ text: QUERY, inView: true });

        await conversationSearch.press('Shift+Enter');
        await expect(count).toHaveText(`${EXPECTED_MATCHES} / ${EXPECTED_MATCHES}`);
        await expect.poll(() => currentHighlight(page)).toEqual({ text: QUERY, inView: true });

        await conversationSearch.press('Escape');
        await expect(page.getByRole('search')).not.toBeVisible();
    });
});
