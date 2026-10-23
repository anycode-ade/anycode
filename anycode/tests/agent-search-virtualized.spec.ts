import { test, expect, type Page } from '@playwright/test';

// Enough turns that the virtualized list keeps only the bottom of the chat mounted.
const TURN_COUNT = 30;
const QUERY = 'needle';
// Turns whose prompt contains QUERY.
const MARKED_TURNS = [2, 24];
// Per marked turn the user prompt, the demo's thought block and the demo's reply all echo the prompt.
const EXPECTED_MATCHES = MARKED_TURNS.length * 3;

const promptFor = (turn: number) => (MARKED_TURNS.includes(turn) ? `note ${turn} ${QUERY}` : `note ${turn}`);

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

    test('finds, scrolls to and highlights matches outside the mounted window', async ({ page }) => {
        await page.goto('/');
        // Demo mode seeds the Demo Agent on first run, so no agent setup is needed.
        await page.getByTitle('Start Demo Agent in').click();
        const promptInput = page.getByPlaceholder('Ask anything...');
        await expect(promptInput).toBeEnabled({ timeout: 10000 });

        for (let turn = 1; turn <= TURN_COUNT; turn++) {
            await promptInput.fill(promptFor(turn));
            await promptInput.press('Enter');
            await expect(page.locator('.acp-message-user', { hasText: promptFor(turn) }).last()).toBeVisible({ timeout: 10000 });
            await expect(page.locator('.acp-message-markdown').last().getByText(/Demo Mode Notice/i)).toBeVisible({ timeout: 15000 });
        }

        // The test only means something if older turns are really unmounted.
        await expect.poll(() => page.locator('[data-turn-key]').count()).toBeLessThan(TURN_COUNT);
        await expect(page.locator('.acp-message-user', { hasText: promptFor(MARKED_TURNS[0]) })).toHaveCount(0);

        await page.keyboard.press('Control+f');
        const conversationSearch = page.getByRole('search').getByLabel('Find in conversation');
        await expect(conversationSearch).toBeFocused();
        await conversationSearch.fill(QUERY);

        const count = page.locator('.acp-search-count');
        await expect(count).toHaveText(`1 / ${EXPECTED_MATCHES}`);
        // First match is in an unmounted turn: the list must scroll there and paint the highlight.
        await expect.poll(() => currentHighlight(page)).toEqual({ text: QUERY, inView: true });
        await expect(page.locator('.acp-message-user', { hasText: promptFor(MARKED_TURNS[0]) })).toHaveCount(1);

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
