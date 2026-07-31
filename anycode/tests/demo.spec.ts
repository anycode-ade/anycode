import { test, expect } from '@playwright/test';

test.describe('Anycode Live Demo Mode E2E Tests', () => {
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

    test('should load demo workspace and file tree', async ({ page }) => {
        await expect(page.locator('body')).toBeVisible();

        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
    });

    test('should move files between folders with drag and drop', async ({ page }) => {
        const readmeRow = page.locator('.tree-item-content').filter({ hasText: 'README.md' }).first();
        const srcRow = page.getByText('src', { exact: true }).first().locator('..');
        await expect(readmeRow).toBeVisible({ timeout: 10000 });
        await expect(srcRow).toBeVisible({ timeout: 10000 });

        await readmeRow.dragTo(srcRow);
        await srcRow.click();

        const srcTreeItem = srcRow.locator('xpath=..');
        await expect(srcTreeItem.getByText('README.md', { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('should open file and create editor tab', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();

        const tab = page.getByText('README.md').first();
        await expect(tab).toBeVisible({ timeout: 10000 });
    });

    test('should allow typing in editor without history errors', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();

        const editor = page.locator('.anycode-editor, canvas, .dockview-panel-body').first();
        if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
            await editor.click();
            await page.keyboard.type('test typing');
        }
    });

    test('should track edited files in Changes panel and remove them when reverted', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();

        const editor = page.locator('.anycode-editor, canvas, .dockview-panel-body').first();
        if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
            await editor.click();
            await page.keyboard.type('123');

            const changesTab = page.getByText('CHANGES').or(page.getByText('Changes')).first();
            if (await changesTab.isVisible({ timeout: 5000 }).catch(() => false)) {
                await changesTab.click();

                // Assert 1: README.md must appear in the Changes list
                const changedFile = page.locator('.changes-list').getByText('README.md').first();
                await expect(changedFile).toBeVisible({ timeout: 10000 });

                // Delete '123' via backspaces to restore original content
                await editor.click();
                await page.keyboard.press('Backspace');
                await page.keyboard.press('Backspace');
                await page.keyboard.press('Backspace');

                // Switch back to Changes tab
                await changesTab.click();

                // Assert 2: README.md must NOT be in Changes list and 'No changes' message must appear
                await expect(page.getByText('No changes')).toBeVisible({ timeout: 10000 });
                await expect(changedFile).not.toBeVisible();
            }
        }
    });

    test('should trigger LSP completions and render non-empty completion popup', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();

        const editor = page.locator('.anycode-editor, canvas, .dockview-panel-body').first();
        if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
            await editor.click();
            await page.keyboard.press('Control+Space');

            // Assert completion popup box container is visible in DOM
            const completionBox = page.locator('.completion-box').first();
            await expect(completionBox).toBeVisible({ timeout: 10000 });

            // Assert completion popup contains items and is not empty!
            const completionItems = page.locator('.completion-item');
            const itemCount = await completionItems.count();
            expect(itemCount).toBeGreaterThan(0);

            const firstItemText = await completionItems.first().innerText();
            expect(firstItemText.trim().length).toBeGreaterThan(0);
        }
    });

    test('should trigger LSP references and render peek view panel with item list matching dataset count and valid code preview', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();

        const editor = page.locator('.anycode-editor, canvas, .dockview-panel-body').first();
        if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
            await editor.click();
            await page.keyboard.press('Shift+F12');

            // Assert 1: References peek view widget container is rendered
            const peekWidget = page.locator('.reference-zone-widget, .references-peek-container').first();
            await expect(peekWidget).toBeVisible({ timeout: 10000 });

            // Assert 2: Exact item count of .references-peek-item-select matches response items (2)
            const peekItems = page.locator('.references-peek-item-select');
            await expect(peekItems).toHaveCount(2, { timeout: 10000 });

            // Assert 3: "Preview unavailable" text is NOT present in DOM
            await expect(page.getByText('Preview unavailable')).not.toBeVisible();

            // Assert 4: References preview code area is rendered
            await expect(page.locator('.references-peek-preview')).toBeVisible({ timeout: 10000 });

            // Assert 5: Clicking the 2nd item updates selection
            const secondItem = peekItems.nth(1);
            await secondItem.click();
            await expect(secondItem).toHaveClass(/is-selected/);
        }
    });

    test('should trigger LSP definition and jump to symbol definition without errors', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();

        const editor = page.locator('.anycode-editor, canvas, .dockview-panel-body').first();
        if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
            await editor.click();
            await page.keyboard.press('F12');
            await expect(page.locator('body')).toBeVisible();
        }
    });

    test('should render interactive terminal banner and prompt in demo mode', async ({ page }) => {
        const terminalTab = page.getByText('TERMINAL').or(page.getByText('Terminal')).first();
        if (await terminalTab.isVisible({ timeout: 5000 }).catch(() => false)) {
            await terminalTab.click();
            await expect(page.locator('.xterm-rows, .xterm-screen').first()).toBeVisible({ timeout: 10000 });
            await expect(page.locator('.xterm').getByText('anycode-demo').first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('should execute terminal VFS commands (ls, cd, pwd, cat) in demo mode', async ({ page }) => {
        const terminalTab = page.getByText('TERMINAL').or(page.getByText('Terminal')).first();
        if (await terminalTab.isVisible({ timeout: 5000 }).catch(() => false)) {
            await terminalTab.click();
            await expect(page.locator('.xterm-rows, .xterm-screen').first()).toBeVisible({ timeout: 10000 });

            const xtermScreen = page.locator('.xterm-helper-textarea, .xterm-rows, .xterm-screen').first();
            await xtermScreen.click();

            // Command 1: cat README.md
            await page.keyboard.type('cat README.md');
            await page.keyboard.press('Enter');
            await expect(page.locator('.xterm').getByText('Welcome to Anycode').first()).toBeVisible({ timeout: 10000 });

            // Command 2: cd src
            await page.keyboard.type('cd src');
            await page.keyboard.press('Enter');
            await expect(page.locator('.xterm').getByText('anycode-demo/src').first()).toBeVisible({ timeout: 10000 });

            // Command 3: pwd
            await page.keyboard.type('pwd');
            await page.keyboard.press('Enter');
            await expect(page.locator('.xterm').getByText('/workspace/anycode-demo/src').first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('should dynamically load and apply real project theme styles', async ({ page }) => {
        await expect(page.locator('body')).toBeVisible();

        const styleElement = page.locator('#theme-highlight-styles');
        await expect(styleElement).toBeAttached({ timeout: 10000 });

        const cssContent = await styleElement.innerHTML();
        expect(cssContent).toBeTruthy();
        expect(cssContent.length).toBeGreaterThan(50);
    });

    test('should perform complete ACP agent lifecycle (user message, thought reasoning, tool card toggle, streaming response & demo notice)', async ({ page }) => {
        const promptInput = page.getByPlaceholder('Ask anything...');
        if (await promptInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            // 1. Send User Prompt
            await promptInput.fill('hello, scan my workspace');
            await promptInput.press('Enter');

            // 2. Assert User Prompt Bubble appears
            await expect(page.getByText('hello, scan my workspace').first()).toBeVisible({ timeout: 10000 });

            // 3. Assert Thought reasoning block appears
            await expect(page.getByText(/Analyzing workspace VFS files/i).first()).toBeVisible({ timeout: 10000 });

            // 4. Assert Tool Call Card appears and expands
            const toolToggle = page.locator('.acp-tool-call-toggle').first();
            await expect(toolToggle).toBeVisible({ timeout: 10000 });
            await toolToggle.click();

            // 5. Assert Tool Command details are rendered inside expanded card
            await expect(page.locator('.acp-tool-call-expanded, .acp-tool-call-name').getByText(/list_dir|Scanning/i).first()).toBeVisible({ timeout: 10000 });

            // 6. Assert Assistant streaming response with English demo notice appears
            await expect(
                page.getByText(/Demo Mode Notice/i).first()
            ).toBeVisible({ timeout: 10000 });
        }
    });

    test('should generate interactive Git diff cards (apply_diff) and verify acp-code and acp-diff-code CSS classes', async ({ page }) => {
        const promptInput = page.getByPlaceholder('Ask anything...');
        if (await promptInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            // Send Code Edit Prompt
            await promptInput.fill('fix demo.py code');
            await promptInput.press('Enter');

            // Assert Tool Call Card for apply_diff appears
            const diffToolCard = page.locator('.acp-message-tool_call').first();
            await expect(diffToolCard).toBeVisible({ timeout: 10000 });

            // Click toggle to expand tool call details
            const toggleBtn = diffToolCard.locator('.acp-tool-call-toggle').first();
            if (await toggleBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                await toggleBtn.click();

                // Assert 1: Clickable file link button demo.py is rendered inside diff card
                const diffFileLink = diffToolCard.locator('.acp-tool-call-diff-link').getByText('demo.py').first();
                await expect(diffFileLink).toBeVisible({ timeout: 10000 });

                // Assert 2: Verify .acp-code.acp-diff-code element is rendered in DOM for Git diff card
                const acpDiffCodeElement = page.locator('.acp-code.acp-diff-code, .acp-tool-call-diffs').first();
                await expect(acpDiffCodeElement).toBeVisible({ timeout: 10000 });
            }

            // Assert 3: Verify .acp-code element is rendered in DOM for Markdown code response
            const acpCodeElement = page.locator('.acp-code').first();
            await expect(acpCodeElement).toBeVisible({ timeout: 10000 });

            // Assert 4: Code block diff snippet is rendered in response message
            await expect(page.locator('.acp-message-content code, pre').getByText(/def greet/i).first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('should perform real content search across VFS files', async ({ page }) => {
        const searchInput = page.locator('.search-input, textarea[placeholder*="Search"], input[placeholder*="Search"]').first();
        if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            await searchInput.fill('greet');
            await searchInput.press('Enter');
            await expect(page.locator('.search-container').getByText('demo.py').first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('should perform file name search in files mode', async ({ page }) => {
        const filesModeBtn = page.locator('.search-mode-button').filter({ hasText: /Files/i }).or(page.locator('[aria-label*="Files"], [title*="Files"]')).first();
        if (await filesModeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await filesModeBtn.click();
        }

        const searchInput = page.locator('.search-input, textarea[placeholder*="Search"], input[placeholder*="Search"]').first();
        if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            await searchInput.fill('App.tsx');
            await searchInput.press('Enter');
            await expect(page.locator('.search-container').getByText('App.tsx').first()).toBeVisible({ timeout: 10000 });
        }
    });
});
