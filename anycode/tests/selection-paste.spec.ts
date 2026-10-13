import { test, expect, type Page, type Locator } from '@playwright/test';

const isMac = process.platform === 'darwin';
const pasteShortcut = isMac ? 'Meta+v' : 'Control+v';
const undoShortcut = isMac ? 'Meta+z' : 'Control+z';
const redoShortcut = isMac ? 'Meta+Shift+z' : 'Control+Shift+z';

/**
 * Helper to select a character range within a given line locator using DOM Range & Selection.
 */
async function selectTextRangeInLine(lineLocator: Locator, startOffset: number, endOffset: number) {
    await lineLocator.evaluate((el, { start, end }) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let currentOffset = 0;
        let startNode: Node | null = null;
        let startNodeOffset = 0;
        let endNode: Node | null = null;
        let endNodeOffset = 0;

        let node = walker.nextNode();
        while (node) {
            const len = node.textContent?.length || 0;
            if (!startNode && currentOffset + len >= start) {
                startNode = node;
                startNodeOffset = start - currentOffset;
            }
            if (!endNode && currentOffset + len >= end) {
                endNode = node;
                endNodeOffset = end - currentOffset;
                break;
            }
            currentOffset += len;
            node = walker.nextNode();
        }

        if (startNode && endNode) {
            const range = document.createRange();
            range.setStart(startNode, startNodeOffset);
            range.setEnd(endNode, endNodeOffset);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }, { start: startOffset, end: endOffset });
}

/**
 * Helper to dispatch a native ClipboardEvent('paste') with text/plain data.
 */
async function dispatchNativePaste(codeLocator: Locator, text: string) {
    await codeLocator.evaluate((el, pasteText) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', pasteText);
        const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
        });
        el.dispatchEvent(event);
    }, text);
}

test.describe('Editor Selection, Paste & Replacement E2E Tests', () => {
    test.beforeEach(async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

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

        // Open demo.py for testing
        const demoPy = page.getByText('demo.py').first();
        await expect(demoPy).toBeVisible({ timeout: 10000 });
        await demoPy.click();

        await expect(page.locator('.anyeditor .code .line').first()).toBeVisible({ timeout: 10000 });
    });

    test.afterEach(async ({ page }) => {
        const errors = (page as any)._pageErrors || [];
        expect(errors, `Uncaught page errors were detected: ${errors.join('; ')}`).toHaveLength(0);
    });

    test('1. Double-click word selection followed by keyboard paste replaces the word', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await expect(greetSpan).toHaveText('greet');

        // Double click 'greet' to select it
        await greetSpan.dblclick();

        // Write replacement text to clipboard
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('calculate_total');
        });

        // Paste via shortcut
        await page.keyboard.press(pasteShortcut);

        // Assert 'greet' was replaced with 'calculate_total'
        await expect(firstLine).toContainText('def calculate_total(name: str) -> str:');
        await expect(firstLine).not.toContainText('greet');
    });

    test('2. Reproduction of Andrew Fedotov bug: replace 9.0 with 10.0 in TargetFramework tag', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        await firstLine.click();

        // Prepare line with <TargetFramework>net9.0</TargetFramework>
        await page.keyboard.press('Enter');
        const newLine = page.locator('.anyeditor .code .line').nth(1);
        await newLine.click();
        await page.keyboard.type('<TargetFramework>net9.0</TargetFramework>');
        await expect(newLine).toContainText('<TargetFramework>net9.0</TargetFramework>');

        // Select '9.0' inside the tag (offset 20 to 23 in "<TargetFramework>net9.0</TargetFramework>")
        const fullText = await newLine.innerText();
        const startIdx = fullText.indexOf('9.0');
        expect(startIdx).toBeGreaterThan(0);
        await selectTextRangeInLine(newLine, startIdx, startIdx + 3);

        // Put '10.0' in clipboard
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('10.0');
        });

        // Paste over selection
        await page.keyboard.press(pasteShortcut);

        // Must become net10.0, NOT net9.10.00!
        await expect(newLine).toContainText('<TargetFramework>net10.0</TargetFramework>');
        await expect(newLine).not.toContainText('net9.10.00');
        await expect(newLine).not.toContainText('net9.0');
    });

    test('3. Native clipboard paste event (context menu / browser paste) replaces active selection', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const codeContainer = page.locator('.anyeditor .code').first();

        // Double click 'greet'
        const greetSpan = firstLine.locator('.function').first();
        await greetSpan.dblclick();

        // Dispatch native paste event (as happens when right-clicking and clicking Paste)
        await dispatchNativePaste(codeContainer, 'execute_command');

        // Verify replacement
        await expect(firstLine).toContainText('def execute_command(name: str) -> str:');
        await expect(firstLine).not.toContainText('greet');
    });

    test('4. Typing text over selection replaces the selected range', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await greetSpan.dblclick();

        // Type directly on the keyboard over selection
        await page.keyboard.type('run');

        // Verify 'greet' is replaced by 'run'
        await expect(firstLine).toContainText('def run(name: str) -> str:');
        await expect(firstLine).not.toContainText('greet');
    });

    test('5. Backspace key over selection deletes the selected text without breaking line', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await greetSpan.dblclick();

        // Press Backspace
        await page.keyboard.press('Backspace');

        // 'greet' deleted, leaving 'def (name: str) -> str:'
        await expect(firstLine).toContainText('def (name: str) -> str:');
        await expect(firstLine).not.toContainText('greet');
    });

    test('6. Delete key over selection deletes the selected text', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await greetSpan.dblclick();

        // Press Delete
        await page.keyboard.press('Delete');

        // 'greet' deleted, leaving 'def (name: str) -> str:'
        await expect(firstLine).toContainText('def (name: str) -> str:');
        await expect(firstLine).not.toContainText('greet');
    });

    test('7. Shift + Click creates selection range and paste replaces it', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();

        // Click on the 'def' keyword at position { x: 5, y: 10 }
        const keywordSpan = firstLine.locator('.keyword').first();
        await keywordSpan.click({ position: { x: 5, y: 10 } });

        // Shift + Click on the punctuation bracket '(' to select "def greet"
        const bracketSpan = firstLine.locator('.punctuation').first();
        await bracketSpan.click({ position: { x: 5, y: 10 }, modifiers: ['Shift'] });

        // Set clipboard text
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('async fn handler');
        });

        // Paste over Shift+Click selection
        await page.keyboard.press(pasteShortcut);

        // Verify replacement
        await expect(firstLine).toContainText('async fn handler');
        await expect(firstLine).not.toContainText('def greet');
    });

    test('8. Paste multi-line text over single-line selection creates multiple lines', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await greetSpan.dblclick();

        // Multi-line replacement
        const multilineText = 'first_func():\n    pass\ndef second_func';
        await page.evaluate(async (text) => {
            await navigator.clipboard.writeText(text);
        }, multilineText);

        await page.keyboard.press(pasteShortcut);

        // Lines should reflect the multiline replacement
        await expect(page.locator('.anyeditor .code .line').nth(0)).toContainText('def first_func():');
        await expect(page.locator('.anyeditor .code .line').nth(1)).toContainText('pass');
        await expect(page.locator('.anyeditor .code .line').nth(2)).toContainText('def second_func(name: str) -> str:');
    });

    test('9. DOM selection rescue: paste recovers active DOM selection even if editor selection was uninitialized', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();

        // Set native DOM selection on 'str' parameter type without editor mousedown
        const typeSpan = firstLine.locator('.type').first();
        await expect(typeSpan).toHaveText('str');

        await typeSpan.evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        });

        // Verify DOM selection contains 'str'
        const selectedText = await page.evaluate(() => window.getSelection()?.toString());
        expect(selectedText).toBe('str');

        // Paste 'int' over selection
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('int');
        });
        await page.keyboard.press(pasteShortcut);

        // Verify 'str' was replaced with 'int'
        await expect(firstLine).toContainText('(name: int)');
        await expect(firstLine).not.toContainText('(name: str)');
    });

    test('10. Undo and Redo accurately restore and re-apply paste over selection', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await greetSpan.dblclick();

        // Paste 'welcome'
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('welcome');
        });
        await page.keyboard.press(pasteShortcut);
        await expect(firstLine).toContainText('def welcome(name: str) -> str:');

        // Undo (Cmd+Z / Ctrl+Z)
        await page.keyboard.press(undoShortcut);
        await expect(firstLine).toContainText('def greet(name: str) -> str:');
        await expect(firstLine).not.toContainText('welcome');

        // Redo (Cmd+Shift+Z / Ctrl+Shift+Z)
        await page.keyboard.press(redoShortcut);
        await expect(firstLine).toContainText('def welcome(name: str) -> str:');
        await expect(firstLine).not.toContainText('greet');
    });

    test('11. Triple-click whole line selection followed by paste replaces the entire line', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();

        // Triple click to select the entire line
        await firstLine.click({ clickCount: 3 });

        // Paste replacement line
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('# Replaced entire first line');
        });
        await page.keyboard.press(pasteShortcut);

        // Verify entire line was replaced
        await expect(firstLine).toHaveText('# Replaced entire first line');
        await expect(firstLine).not.toContainText('def greet');
    });

    test('12. Cut and paste replacement: cuts selected text and pastes it over another selection', async ({ page }) => {
        const cutShortcut = isMac ? 'Meta+x' : 'Control+x';
        const firstLine = page.locator('.anyeditor .code .line').first();

        // Double click 'def'
        const keywordSpan = firstLine.locator('.keyword').first();
        await keywordSpan.dblclick();

        // Cut 'def'
        await page.keyboard.press(cutShortcut);
        await expect(firstLine).toContainText('greet(name: str)');
        await expect(firstLine).not.toContainText('def greet');

        // Double click 'name'
        const paramSpan = firstLine.locator('.variable').first();
        await paramSpan.dblclick();

        // Paste 'def' over 'name'
        await page.keyboard.press(pasteShortcut);
        await expect(firstLine).toContainText('(def: str)');
        await expect(firstLine).not.toContainText('(name: str)');
    });

    test('13. Backward selection (right-to-left) is replaced correctly by paste', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await expect(greetSpan).toHaveText('greet');

        // Set backwards DOM selection (anchor at end of 'greet', focus at start)
        await greetSpan.evaluate((el) => {
            const textNode = el.firstChild || el;
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.setBaseAndExtent(textNode, 5, textNode, 0);
        });

        // Verify backwards selection in DOM
        const backwardText = await page.evaluate(() => window.getSelection()?.toString());
        expect(backwardText).toBe('greet');

        // Paste 'init' over backward selection
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('init');
        });
        await page.keyboard.press(pasteShortcut);

        // Verify replacement
        await expect(firstLine).toContainText('def init(name: str) -> str:');
        await expect(firstLine).not.toContainText('greet');
    });

    test('14. Cross-line selection replacement: selecting across newline merges lines with pasted text', async ({ page }) => {
        const line0 = page.locator('.anyeditor .code .line').nth(0);
        const line1 = page.locator('.anyeditor .code .line').nth(1);

        // Select from end of line 0 (str:) to start of line 1 (""")
        await page.evaluate(() => {
            const lines = document.querySelectorAll('.anyeditor .code .line');
            if (lines.length < 2) return;
            const line0El = lines[0];
            const line1El = lines[1];

            const walker0 = document.createTreeWalker(line0El, NodeFilter.SHOW_TEXT);
            let lastTextNode0: Node | null = null;
            let n = walker0.nextNode();
            while (n) {
                lastTextNode0 = n;
                n = walker0.nextNode();
            }

            const walker1 = document.createTreeWalker(line1El, NodeFilter.SHOW_TEXT);
            const firstTextNode1 = walker1.nextNode();

            if (lastTextNode0 && firstTextNode1) {
                const range = document.createRange();
                range.setStart(lastTextNode0, 0);
                range.setEnd(firstTextNode1, firstTextNode1.textContent?.length || 0);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            }
        });

        // Paste replacement that joins the lines with a comment
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('any: # replaced docstring');
        });
        await page.keyboard.press(pasteShortcut);

        // Line 0 should contain the merged text
        await expect(line0).toContainText('any: # replaced docstring');
    });

    test('15. Pasting complex code with XML tags and quotes accurately replaces selection', async ({ page }) => {
        const firstLine = page.locator('.anyeditor .code .line').first();
        const greetSpan = firstLine.locator('.function').first();
        await greetSpan.dblclick();

        const xmlSnippet = '<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />';
        await page.evaluate(async (snippet) => {
            await navigator.clipboard.writeText(snippet);
        }, xmlSnippet);

        await page.keyboard.press(pasteShortcut);

        await expect(firstLine).toContainText(xmlSnippet);
        await expect(firstLine).not.toContainText('greet');
    });
});
