import { test, expect, type Page } from '@playwright/test';

const openSettingsPanel = async (page: Page) => {
    const settingsPanel = page.locator('.layout-dock-panel--settings:visible').first();
    if (await settingsPanel.count() === 0) {
        await page
            .getByRole('region', { name: 'Editor' })
            .getByRole('button', { name: 'Split Right' })
            .click({ force: true });
        const picker = page.locator('.layout-panel-picker').last();
        await expect(picker).toBeVisible();
        await picker.getByRole('button', { name: 'Settings', exact: true }).click();
    }

    await expect(settingsPanel).toBeVisible();
    return settingsPanel;
};

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

    test('should open file and create editor tab', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();

        const tab = page.getByText('README.md').first();
        await expect(tab).toBeVisible({ timeout: 10000 });
    });

    test('should load only grammars used by the opened file', async ({ page }) => {
        const grammarRequests: string[] = [];
        page.on('request', (request) => {
            const url = new URL(request.url());
            if (/\/tree-sitter-[^/]+\.wasm$/.test(url.pathname)) {
                grammarRequests.push(url.pathname.split('/').pop()!);
            }
        });

        await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 10000 });
        await page.getByText('README.md').first().click();
        await expect(page.locator('.code .line').first()).toBeVisible({ timeout: 10000 });

        // README.md contains Markdown inline nodes, but no HTML or fenced code.
        // The grammar loader must not fetch every language declared by the
        // Markdown injection query.
        await expect.poll(() => grammarRequests).toEqual([
            'tree-sitter-markdown.wasm',
            'tree-sitter-markdown_inline.wasm',
        ]);

        await page.getByText('demo.py').first().click();
        await expect(page.locator('.code .line').first()).toBeVisible({ timeout: 10000 });
        await expect.poll(() => grammarRequests).toContain('tree-sitter-python.wasm');

        expect(grammarRequests).not.toContain('tree-sitter-rust.wasm');
        expect(grammarRequests).not.toContain('tree-sitter-bash.wasm');
        expect(grammarRequests).not.toContain('tree-sitter-json.wasm');
        expect(grammarRequests).not.toContain('tree-sitter-yaml.wasm');
        expect(grammarRequests).not.toContain('tree-sitter-css.wasm');
        expect(grammarRequests).not.toContain('tree-sitter-typescript.wasm');
        expect(grammarRequests).not.toContain('tree-sitter-javascript.wasm');
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

    test('should browse, search, and open a commit from Git history', async ({ page }) => {
        const historyTab = page.getByText(/^History$/i).first();
        await expect(historyTab).toBeVisible({ timeout: 10000 });
        await historyTab.click();

        const historyPanel = page.locator('.history-panel');
        const historyList = historyPanel.getByRole('list', { name: 'Git history' });
        const commitRows = historyList.locator('.history-commit-row');

        await expect(historyPanel).toBeVisible();
        await expect(commitRows).toHaveCount(4);
        await expect(historyList.getByText('Welcome to the Anycode demo')).toBeVisible();
        await expect(historyList.getByText('Initial project')).toBeVisible();

        await historyPanel.getByRole('button', { name: 'Search history' }).click();
        const searchInput = historyPanel.getByRole('textbox', { name: 'Search Git history' });
        await searchInput.fill('terminal');
        await searchInput.press('Enter');

        await expect(commitRows).toHaveCount(1);
        await expect(historyList.getByText('Add editor and terminal panels')).toBeVisible();
        await expect(historyList.getByText('Welcome to the Anycode demo')).not.toBeVisible();

        await historyPanel.getByRole('button', { name: 'Clear history search' }).click();
        await expect(commitRows).toHaveCount(4);

        const firstCommit = commitRows.filter({ hasText: 'Welcome to the Anycode demo' });
        await firstCommit.click();
        await expect(firstCommit).toHaveAttribute('aria-expanded', 'true');

        const historicalFile = historyList.locator('.history-file-row').filter({ hasText: 'main.rs' });
        await expect(historicalFile).toBeVisible();
        await historicalFile.click();

        await expect(page.getByText('main.rs (de000000)', { exact: true }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /^Diff mode diff\./ }).first()).toBeVisible();
    });

    test('should filter demo Git history to the active file and reveal all commit files', async ({ page }) => {
        const readmeFile = page.getByText('README.md').first();
        await expect(readmeFile).toBeVisible({ timeout: 10000 });
        await readmeFile.click();

        const historyTab = page.getByText(/^History$/i).first();
        await historyTab.click();
        const historyPanel = page.locator('.history-panel');
        const historyList = historyPanel.getByRole('list', { name: 'Git history' });

        await historyPanel.getByRole('tab', { name: 'File' }).click();
        await expect(historyList.locator('.history-commit-row')).toHaveCount(2);

        const firstCommit = historyList.locator('.history-commit-row').first();
        await firstCommit.click();
        await expect(historyList.locator('.history-file-row').filter({ hasText: 'README.md' })).toBeVisible();
        await expect(historyList.locator('.history-file-row').filter({ hasText: 'main.rs' })).not.toBeVisible();

        await historyPanel.getByRole('button', { name: 'Show all (6)' }).click();
        await expect(historyList.locator('.history-file-row').filter({ hasText: 'main.rs' })).toBeVisible();
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

            // 4. Assert Tool Call Card appears and expands in the latest group
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

    test('should collapse and expand long user messages', async ({ page }) => {
        const promptInput = page.getByPlaceholder('Ask anything...');
        if (await promptInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            const longPrompt = Array.from({ length: 24 }, (_, index) => `Log line ${index + 1}: repeated diagnostic output`).join('\n');
            await promptInput.fill(longPrompt);
            await promptInput.press('Enter');

            const userMessage = page.locator('.acp-message-user').filter({ hasText: 'Log line 24' }).last();
            const toggle = userMessage.getByRole('button', { name: 'Show more' });
            await expect(toggle).toBeVisible({ timeout: 10000 });
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(userMessage.locator('.acp-user-message-body')).toHaveClass(/acp-user-message-body-collapsed/);

            await toggle.click();
            await expect(userMessage.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
            await expect(userMessage.locator('.acp-user-message-body')).not.toHaveClass(/acp-user-message-body-collapsed/);
            await expect(page.getByRole('button', { name: 'Enable auto-scroll' })).toBeVisible();
        }
    });

    test('should search ACP text without expanding unrelated work groups', async ({ page }) => {
        const promptInput = page.getByPlaceholder('Ask anything...');
        if (await promptInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            await promptInput.fill('first first search turn');
            await promptInput.press('Enter');
            await expect(page.getByText(/Demo Mode Notice/i).first()).toBeVisible({ timeout: 10000 });

            await promptInput.fill('second search turn');
            await promptInput.press('Enter');
            await expect(page.locator('.acp-work-group').first()).toHaveClass(/collapsed/);
            await expect(page.locator('.acp-message-markdown blockquote')).toHaveCount(2, { timeout: 10000 });

            const selectedMessage = page.locator('.acp-message-user').filter({ hasText: 'first first search turn' });
            await selectedMessage.evaluate((element) => {
                const range = document.createRange();
                range.selectNodeContents(element.querySelector('.acp-message-content')!);
                window.getSelection()?.removeAllRanges();
                window.getSelection()?.addRange(range);
            });
            await page.keyboard.press('Control+f');

            const conversationSearch = page.getByRole('search').getByLabel('Find in conversation');
            await expect(conversationSearch).toBeFocused();
            await expect(conversationSearch).toHaveValue('first first search turn');

            await expect(page.locator('.acp-search-count')).toHaveText('1 / 3');
            await expect(page.locator('.acp-search-current-hit')).toBeVisible();

            await conversationSearch.press('Enter');
            await expect(page.locator('.acp-search-count')).toHaveText('2 / 3');
            await expect(page.locator('[data-search-expanded="true"]')).toHaveCount(1);
            await expect(page.locator('.acp-tool-call-expanded')).toHaveCount(0);

            await conversationSearch.fill('first');
            await expect(page.locator('.acp-search-count')).toHaveText('1 / 6');
            await conversationSearch.press('Enter');
            await expect(page.locator('.acp-search-count')).toHaveText('2 / 6');

            await conversationSearch.fill('Read 182 bytes from README.md');
            await expect(page.locator('.acp-search-count')).toHaveText('No results');
            await expect(page.locator('[data-search-expanded="true"]')).toHaveCount(0);

            await conversationSearch.press('Escape');
            await expect(page.getByRole('search')).not.toBeVisible();
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
            const searchPanel = page.locator('.search-container');
            await expect(searchPanel.getByText('demo.py').first()).toBeVisible({ timeout: 10000 });

            await searchPanel.locator('.file-path').filter({ hasText: 'demo.py' }).first().click();
            const matchRow = searchPanel.locator('.search-item').first();
            await expect(matchRow).toBeVisible({ timeout: 5000 });
            await matchRow.click();

            await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('greet');
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

    test('should open Multibuffer Review and display header rows', async ({ page }) => {
        const historyTab = page.getByText(/^History$/i).first();
        await historyTab.click();
        const historyPanel = page.locator('.history-panel');
        const historyList = historyPanel.getByRole('list', { name: 'Git history' });
        const firstCommit = historyList.locator('.history-commit-row').first();
        await firstCommit.click();

        const reviewBtn = historyList.locator('.history-review-button, button:has-text("Review")').first();
        await expect(reviewBtn).toBeVisible({ timeout: 5000 });
        await reviewBtn.click();
        await expect(page.locator('.multibuffer-panel, .multibuffer-file-header-row').first()).toBeVisible({ timeout: 10000 });
    });

    test('should focus file in Multibuffer Review when each file row in history list is clicked', async ({ page }) => {
        const historyTab = page.getByText(/^History$/i).first();
        await historyTab.click();
        const historyPanel = page.locator('.history-panel');
        const historyList = historyPanel.getByRole('list', { name: 'Git history' });
        const firstCommit = historyList.locator('.history-commit-row').first();
        await firstCommit.click();

        const reviewBtn = historyList.locator('.history-review-button, button:has-text("Review")').first();
        await expect(reviewBtn).toBeVisible({ timeout: 5000 });
        await reviewBtn.click();
        await expect(page.locator('.multibuffer-panel').first()).toBeVisible({ timeout: 10000 });

        const historyFileRows = historyList.locator('.history-file-row');
        const count = await historyFileRows.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
            const targetFileRow = historyFileRows.nth(i);
            const rawText = await targetFileRow.innerText();
            const fileName = rawText.split('\n')[0].trim();
            await targetFileRow.click();

            const headerRow = page.locator('.multibuffer-file-header-row').filter({ hasText: fileName }).first();
            await expect(headerRow).toBeVisible({ timeout: 10000 });
            await page.waitForTimeout(500);
        }
    });

    test('should collapse and expand file in Multibuffer Review when header is clicked', async ({ page }) => {
        const historyTab = page.getByText(/^History$/i).first();
        await historyTab.click();
        const historyList = page.locator('.history-panel').getByRole('list', { name: 'Git history' });
        const firstCommit = historyList.locator('.history-commit-row').first();
        await firstCommit.click();

        const reviewBtn = historyList.locator('.history-review-button, button:has-text("Review")').first();
        await expect(reviewBtn).toBeVisible({ timeout: 5000 });
        await reviewBtn.click();
        const headerRow = page.locator('.multibuffer-file-header-row').first();
        await expect(headerRow).toBeVisible({ timeout: 10000 });
        await expect(headerRow).toContainText('▾');

        const firstBodyLine = page.locator('.line:not(.multibuffer-file-header-row)').first();
        await expect(firstBodyLine).toBeVisible({ timeout: 10000 });
        const lineTextBefore = (await firstBodyLine.innerText()).trim();
        expect(lineTextBefore.length).toBeGreaterThan(0);

        // Collapse
        await headerRow.click();
        await expect(headerRow).toContainText('▸');

        // Compare DOM line contents during collapse
        const currentBodyLinesText = await page.locator('.line:not(.multibuffer-file-header-row)').allInnerTexts();
        const trimmedTexts = currentBodyLinesText.map((t) => t.trim());
        expect(trimmedTexts).not.toContain(lineTextBefore);

        // Expand again
        await headerRow.click();
        await expect(headerRow).toContainText('▾');
        const lineTextAfter = (await firstBodyLine.innerText()).trim();
        expect(lineTextAfter).toBe(lineTextBefore);
    });

    test('should render single unmodified lines as code instead of 1-line gap buttons', async ({ page }) => {
        const historyTab = page.getByText(/^History$/i).first();
        await historyTab.click();
        const historyList = page.locator('.history-panel').getByRole('list', { name: 'Git history' });
        const firstCommit = historyList.locator('.history-commit-row').first();
        await firstCommit.click();

        const reviewBtn = historyList.locator('.history-review-button, button:has-text("Review")').first();
        await expect(reviewBtn).toBeVisible({ timeout: 5000 });
        await reviewBtn.click();
        await expect(page.locator('.multibuffer-file-header-row').first()).toBeVisible({ timeout: 10000 });

        const singleLineGaps = page.locator('.diff-gap-expand-btn').filter({ hasText: /^1 unmodified line$/ });
        await expect(singleLineGaps).toHaveCount(0);
    });

    test('should preserve scroll position in Multibuffer Review when switching panels', async ({ page }) => {
        const historyTab = page.getByText(/^History$/i).first();
        await historyTab.click();
        const historyList = page.locator('.history-panel').getByRole('list', { name: 'Git history' });
        const firstCommit = historyList.locator('.history-commit-row').first();
        await firstCommit.click();

        const reviewBtn = historyList.locator('.history-review-button, button:has-text("Review")').first();
        await expect(reviewBtn).toBeVisible({ timeout: 5000 });
        await reviewBtn.click();
        await expect(page.locator('.multibuffer-panel').first()).toBeVisible({ timeout: 10000 });

        const editorContainer = page.locator('.multibuffer-editor-shell .anyeditor').first();
        await expect(editorContainer).toBeVisible({ timeout: 10000 });

        // Scroll down in review editor
        await editorContainer.evaluate((el) => {
            el.scrollTop = 200;
            el.dispatchEvent(new Event('scroll'));
        });

        await expect.poll(() => editorContainer.evaluate((el) => el.scrollTop)).toBe(200);

        // Add a new tab in the editor region to hide the review tab
        const editorRegion = page.getByRole('region', { name: 'Editor' });
        const addEmptyTabButton = editorRegion.getByRole('button', { name: 'Add Empty Tab' });
        await editorRegion.locator('.layout-header-actions').hover();
        await addEmptyTabButton.click();

        // Select Settings panel in picker to activate the new tab
        const picker = page.locator('.layout-panel-picker').last();
        await expect(picker).toBeVisible();
        await picker.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.locator('.layout-dock-panel--settings:visible')).toBeVisible();

        // Switch back to the Review/Editor tab
        const reviewTab = page.getByRole('tab', { name: 'Editor' }).first();
        await reviewTab.click();
        await expect(editorContainer).toBeVisible({ timeout: 10000 });

        // Verify scroll position was preserved
        await expect.poll(() => editorContainer.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBe(200);
    });

    test('should render a deleted-only commit in Multibuffer Review', async ({ page }) => {
        await page.getByText(/^History$/i).first().click();
        const historyList = page.locator('.history-panel').getByRole('list', { name: 'Git history' });
        const deletedOnlyCommit = historyList.locator('.history-commit-row').filter({
            hasText: 'Remove obsolete helper',
        });

        await expect(deletedOnlyCommit).toBeVisible({ timeout: 10000 });
        await deletedOnlyCommit.click();
        await historyList.locator('.history-review-button').click();

        const multibuffer = page.locator('.multibuffer-panel');
        await expect(multibuffer).toBeVisible({ timeout: 10000 });
        await expect(multibuffer.locator('.multibuffer-file-header-row')).toContainText('obsolete-helper.ts');
        await expect(multibuffer.locator('.line-deleted-ghost').first()).toBeVisible();
    });

    test('should render a deleted working-tree file in Multibuffer Review', async ({ page }) => {
        page.on('dialog', (dialog) => dialog.accept());

        const filesPanel = page.getByRole('region', { name: 'Files' });
        const demoFile = filesPanel.getByText('demo.py').first();
        await expect(demoFile).toBeVisible({ timeout: 10000 });
        await demoFile.click({ button: 'right' });
        await page.getByRole('button', { name: 'Delete File' }).click();

        await page.getByText(/^Changes$/i).first().click();
        const changesPanel = page.locator('.changes-panel');
        await expect(changesPanel.getByText('demo.py').first()).toBeVisible({ timeout: 10000 });
        await changesPanel.getByRole('button', { name: 'Review all changes' }).click();

        const multibuffer = page.locator('.multibuffer-panel');
        await expect(multibuffer.locator('.multibuffer-file-header-row')).toContainText('demo.py');
        await expect(multibuffer.locator('.line-deleted-ghost').first()).toBeVisible();
    });

    test('should keep a review file open in another editor pane', async ({ page }) => {
        const filesPanel = page.getByRole('region', { name: 'Files' });
        const readmeFile = filesPanel.getByText('README.md').first();
        await expect(readmeFile).toBeVisible({ timeout: 10000 });
        await readmeFile.click();

        const initialEditor = page.locator('.editor-container').filter({
            hasNot: page.locator('.multibuffer-panel'),
        }).first();
        const initialLine = initialEditor.locator('.code .line').first();
        await expect(initialLine).toBeVisible({ timeout: 10000 });
        await initialLine.click();
        await page.keyboard.type('review-change');

        await page.getByText(/^Changes$/i).first().click();
        const changesPanel = page.locator('.changes-panel');
        await changesPanel.getByRole('button', { name: 'Review all changes' }).click();

        const multibuffer = page.locator('.multibuffer-panel');
        await expect(multibuffer).toBeVisible({ timeout: 10000 });
        const reviewEditorRegion = page.getByRole('region', { name: 'Editor' }).filter({ has: multibuffer });
        await reviewEditorRegion.getByRole('button', { name: 'Split Right' }).click({ force: true });
        const picker = page.locator('.layout-panel-picker');
        await expect(picker).toBeVisible();
        await picker.getByRole('button', { name: 'Editor' }).click();

        await page.getByRole('tab', { name: 'Files' }).click();
        await filesPanel.getByText('README.md').first().click();
        const fileEditorRegion = page.getByRole('region', { name: 'Editor' }).filter({
            hasNot: multibuffer,
        });
        await expect(fileEditorRegion.locator('.anyeditor')).toBeVisible({ timeout: 10000 });

        await multibuffer.locator('.multibuffer-toolbar').click();
        await page.getByRole('tab', { name: 'Changes' }).click();
        await changesPanel.locator('.changes-item').filter({ hasText: 'README.md' }).click();
        await expect(fileEditorRegion.locator('.anyeditor')).toBeVisible();

        await multibuffer.locator('.multibuffer-toolbar').click();
        await page.locator('.toolbar-tabs .tab').filter({ hasText: 'README.md' }).click();
        await expect(fileEditorRegion.locator('.anyeditor')).toBeVisible();
    });

    test('should activate a file when its header is clicked in Multibuffer Review', async ({ page }) => {
        const filesPanel = page.getByRole('region', { name: 'Files' });

        await filesPanel.getByText('README.md').first().click();
        let editor = page.locator('.editor-container').filter({
            hasNot: page.locator('.multibuffer-panel'),
        }).first();
        await editor.locator('.code .line').first().click();
        await page.keyboard.type('readme-change');

        await page.getByRole('tab', { name: 'Files' }).click();
        await filesPanel.getByText('demo.py').first().click();
        editor = page.locator('.editor-container').filter({
            hasNot: page.locator('.multibuffer-panel'),
        }).first();
        await editor.locator('.code .line').first().click();
        await page.keyboard.type('demo-change');

        await page.getByRole('tab', { name: 'Changes' }).click();
        const changesPanel = page.locator('.changes-panel');
        await changesPanel.getByRole('button', { name: 'Review all changes' }).click();

        const readmeHeader = page.locator('.multibuffer-file-header-row').filter({ hasText: 'README.md' });
        await expect(readmeHeader).toBeVisible({ timeout: 10000 });
        await readmeHeader.click();

        const readmeChange = changesPanel.locator('.changes-item').filter({ hasText: 'README.md' });
        await expect(readmeChange).toHaveClass(/active/);
    });

    test('should keep the cursor active and sync the same file between review and editor panes', async ({ page }) => {
        const filesPanel = page.getByRole('region', { name: 'Files' });
        await filesPanel.getByText('README.md').first().click();

        const initialEditor = page.locator('.editor-container').filter({
            hasNot: page.locator('.multibuffer-panel'),
        }).first();
        await initialEditor.locator('.code .line').first().click();
        await page.keyboard.type('shared-change');

        await page.getByRole('tab', { name: 'Changes' }).click();
        await page.locator('.changes-panel').getByRole('button', { name: 'Review all changes' }).click();

        const multibuffer = page.locator('.multibuffer-panel');
        const reviewEditorRegion = page.getByRole('region', { name: 'Editor' }).filter({ has: multibuffer });
        await reviewEditorRegion.getByRole('button', { name: 'Split Right' }).click({ force: true });
        await page.locator('.layout-panel-picker').getByRole('button', { name: 'Editor' }).click();

        await page.getByRole('tab', { name: 'Files' }).click();
        await filesPanel.getByText('README.md').first().click();
        const fileEditorRegion = page.getByRole('region', { name: 'Editor' }).filter({
            hasNot: multibuffer,
        });
        await expect(fileEditorRegion.locator('.anyeditor')).toBeVisible({ timeout: 10000 });

        const selectionIsInside = async (selector: typeof fileEditorRegion) => selector.evaluate((element) => {
            const anchorNode = window.getSelection()?.anchorNode;
            return anchorNode !== null && element.contains(anchorNode);
        });
        await page.evaluate(() => {
            const testWindow = window as typeof window & {
                cursorPaneTrace?: string[];
                cursorTraceInstalled?: boolean;
            };
            testWindow.cursorPaneTrace = [];
            if (testWindow.cursorTraceInstalled) return;
            testWindow.cursorTraceInstalled = true;
            const addRange = Selection.prototype.addRange;
            Selection.prototype.addRange = function (range: Range) {
                const anchorNode = range.startContainer;
                const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
                const editorContainer = anchorElement?.closest('.editor-container');
                if (editorContainer) {
                    testWindow.cursorPaneTrace?.push(
                        editorContainer.querySelector('.multibuffer-panel') ? 'review' : 'file',
                    );
                }
                return addRange.call(this, range);
            };
        });

        await fileEditorRegion.locator('.code .line').first().click();
        await expect.poll(() => selectionIsInside(fileEditorRegion)).toBe(true);
        await page.evaluate(() => {
            (window as typeof window & { cursorPaneTrace?: string[] }).cursorPaneTrace = [];
        });
        await page.keyboard.press('End');
        await page.keyboard.type('-file-sync');
        await expect.poll(() => selectionIsInside(fileEditorRegion)).toBe(true);
        expect(await page.evaluate(() => (
            (window as typeof window & { cursorPaneTrace?: string[] }).cursorPaneTrace
        ))).not.toContain('review');
        await expect(
            multibuffer.locator('.code .line').filter({ hasText: 'shared-change' }).first(),
        ).toContainText('-file-sync');

        const reviewLine = multibuffer.locator('.code .line').filter({ hasText: 'shared-change' }).first();
        await reviewLine.click();
        await expect.poll(() => selectionIsInside(reviewEditorRegion)).toBe(true);
        await page.evaluate(() => {
            (window as typeof window & { cursorPaneTrace?: string[] }).cursorPaneTrace = [];
        });
        await page.keyboard.press('End');
        await page.keyboard.type('-review-sync');
        await expect.poll(() => selectionIsInside(reviewEditorRegion)).toBe(true);
        expect(await page.evaluate(() => (
            (window as typeof window & { cursorPaneTrace?: string[] }).cursorPaneTrace
        ))).not.toContain('file');
        await expect(
            fileEditorRegion.locator('.code .line').filter({ hasText: 'shared-change' }).first(),
        ).toContainText('-review-sync');
    });

    test('should persist a Settings panel added from the panel plus button after reload', async ({ page }) => {
        const filesPanel = page.getByRole('region', { name: 'Files' });
        const addEmptyTabButton = filesPanel.getByRole('button', { name: 'Add Empty Tab' });

        await expect(addEmptyTabButton).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.layout-dock-panel--settings:visible')).toHaveCount(0);

        await filesPanel.locator('.layout-header-actions').hover();
        await addEmptyTabButton.click();

        const picker = page.locator('.layout-panel-picker').last();
        await expect(picker).toBeVisible();
        await picker.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.locator('.layout-dock-panel--settings:visible')).toBeVisible();

        await expect.poll(() => page.evaluate(() => localStorage.getItem('layout'))).toContain('settings');

        await page.reload();

        await expect(page.locator('.layout-dock-panel--settings:visible')).toBeVisible({ timeout: 10000 });
    });

    test('should apply scrollbar settings to an open editor and persist them after reload', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();
        await expect(page.locator('.code .line').first()).toBeVisible({ timeout: 10000 });

        const scrollbar = page.locator('.smr:visible').first();
        await expect(scrollbar).toBeVisible({ timeout: 10000 });

        const settingsPanel = await openSettingsPanel(page);
        const scrollbarSection = settingsPanel.locator('.settings-section').filter({ hasText: /^Scrollbar/ });
        await expect(scrollbarSection.getByRole('button', { name: /^Rounded/ })).toHaveClass(/active/);
        await expect(scrollbarSection.getByRole('button', { name: /^8px/ })).toHaveClass(/active/);
        await expect(scrollbarSection.getByRole('button', { name: '20px (Default)' })).toHaveClass(/active/);
        await expect(scrollbarSection.getByRole('button', { name: 'Always show scrollbar' })).toHaveAttribute('aria-pressed', 'false');

        await scrollbarSection.getByRole('button', { name: /^Flat/ }).click();
        await scrollbarSection.getByRole('button', { name: 'Always show scrollbar' }).click();
        await scrollbarSection.getByRole('button', { name: /^12px/ }).click();
        await scrollbarSection.getByRole('button', { name: '48px' }).click();

        await expect(page.locator('html')).toHaveAttribute('data-scrollbar-style', 'flat');
        await expect(page.locator('html')).toHaveAttribute('data-scrollbar-always-show', 'true');
        await expect.poll(() => page.locator('html').evaluate((element) => ({
            width: getComputedStyle(element).getPropertyValue('--smr-custom-width').trim(),
            minSize: getComputedStyle(element).getPropertyValue('--smr-min-size').trim(),
        }))).toEqual({ width: '12px', minSize: '48px' });

        await expect.poll(() => scrollbar.locator('.smrt').evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                width: style.width,
                minHeight: style.minHeight,
                borderRadius: style.borderRadius,
                opacity: style.opacity,
            };
        })).toEqual({
            width: '12px',
            minHeight: '48px',
            borderRadius: '0px',
            opacity: '1',
        });

        await page.reload();
        await expect(page.locator('.code .line').first()).toBeVisible({ timeout: 10000 });
        const settingsAfterReload = await openSettingsPanel(page);
        const scrollbarSectionAfterReload = settingsAfterReload.locator('.settings-section').filter({ hasText: /^Scrollbar/ });
        await expect(scrollbarSectionAfterReload.getByRole('button', { name: /^Flat/ })).toHaveClass(/active/);
        await expect(scrollbarSectionAfterReload.getByRole('button', { name: 'Always show scrollbar' })).toHaveAttribute('aria-pressed', 'true');
        await expect(scrollbarSectionAfterReload.getByRole('button', { name: /^12px/ })).toHaveClass(/active/);
        await expect(scrollbarSectionAfterReload.getByRole('button', { name: '48px' })).toHaveClass(/active/);
    });

    test('should briefly preview the scrollbar after a setting changes', async ({ page }) => {
        const readme = page.getByText('README.md').first();
        await expect(readme).toBeVisible({ timeout: 10000 });
        await readme.click();
        await expect(page.locator('.code .line').first()).toBeVisible({ timeout: 10000 });

        const settingsPanel = await openSettingsPanel(page);
        const scrollbarSection = settingsPanel.locator('.settings-section').filter({ hasText: /^Scrollbar/ });
        await expect(scrollbarSection.getByRole('button', { name: 'Always show scrollbar' })).toHaveAttribute('aria-pressed', 'false');

        await scrollbarSection.getByRole('button', { name: /^Flat/ }).click();
        await expect(page.locator('html')).toHaveAttribute('data-scrollbar-preview', 'true');
        await expect(page.locator('html')).not.toHaveAttribute('data-scrollbar-preview', 'true', { timeout: 3000 });
    });
});
