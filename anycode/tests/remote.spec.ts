import { test, expect, type Page } from '@playwright/test';

const openRemotePanel = async (page: Page) => {
    const existing = page.locator('.layout-dock-panel--remote:visible').first();
    if (await existing.count() > 0) return existing;

    const filesPanel = page.getByRole('region', { name: 'Files' });
    const addEmptyTabButton = filesPanel.getByRole('button', { name: 'Add Empty Tab' });
    await filesPanel.locator('.layout-header-actions').hover();
    await addEmptyTabButton.click({ force: true });

    const picker = page.locator('.layout-panel-picker').last();
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.getByRole('button', { name: 'Remote', exact: true }).click();

    const remotePanel = page.locator('.layout-dock-panel--remote:visible').first();
    await expect(remotePanel).toBeVisible({ timeout: 10000 });
    return remotePanel;
};

test.describe('Remote Panel Demo Mode E2E Tests', () => {
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

    test('should open Remote panel and render seeded servers with status badges and projects', async ({ page }) => {
        const remotePanel = await openRemotePanel(page);

        // Sidebar title shows Servers (2)
        const sidebarTitle = remotePanel.locator('.remote-sidebar-title');
        await expect(sidebarTitle).toHaveText('Servers (2)');

        // Seeded server: Local
        const localServer = remotePanel.locator('.remote-server-row').filter({ hasText: 'Local' });
        await expect(localServer).toBeVisible();
        await expect(localServer.locator('.remote-status-dot.online')).toBeVisible();
        await expect(localServer.locator('.remote-badge').filter({ hasText: 'local' })).toBeVisible();

        // Seeded server: eu-west-gpu
        const remoteServer = remotePanel.locator('.remote-server-row').filter({ hasText: 'eu-west-gpu' });
        await expect(remoteServer).toBeVisible();
        await expect(remoteServer.locator('.remote-status-dot.online')).toBeVisible();
        await expect(remoteServer.locator('.remote-badge.ok')).toContainText('ms');

        // Projects under servers
        await expect(remotePanel.locator('.remote-project-name').filter({ hasText: 'anycode-demo' })).toBeVisible();
        await expect(remotePanel.locator('.remote-project-name').filter({ hasText: 'gpu-inference' })).toBeVisible();
    });

    test('should add a new server via modal, verify sidebar update, reconnect, and remove it with armed confirmation', async ({ page }) => {
        const remotePanel = await openRemotePanel(page);

        // Click Add server button in header
        const addServerBtn = remotePanel.locator('.remote-sidebar-header button[title="Add server"]');
        await addServerBtn.click();

        // Popover modal appears
        const modal = page.locator('.remote-popover').filter({ hasText: 'Connect Anycode Server' });
        await expect(modal).toBeVisible();

        // Fill in name and URL
        await modal.locator('input').first().fill('us-east-worker');
        await modal.locator('input[type="text"], input:not([type="password"])').nth(1).fill('http://10.0.2.15:3000');
        await modal.getByRole('button', { name: 'Connect Server' }).click();

        // Verify server count is 3 and new server is listed
        await expect(remotePanel.locator('.remote-sidebar-title')).toHaveText('Servers (3)');
        const newServerRow = remotePanel.locator('.remote-server-row').filter({ hasText: 'us-east-worker' });
        await expect(newServerRow).toBeVisible();

        // Select the server to view in main pane
        await newServerRow.click();
        const mainCard = remotePanel.locator('.remote-main .remote-card').filter({ hasText: 'us-east-worker' });
        await expect(mainCard).toBeVisible();

        // Reconnect server
        const reconnectBtn = mainCard.getByRole('button', { name: 'Reconnect' });
        await expect(reconnectBtn).toBeVisible();
        await reconnectBtn.click();
        await expect(mainCard.locator('.remote-badge.ok')).toBeVisible();

        // Remove server with armed double click
        await newServerRow.hover();
        const removeServerBtn = newServerRow.locator('button[title="Disconnect & remove server"]');
        await expect(removeServerBtn).toBeVisible();
        await removeServerBtn.click({ force: true });

        // Armed confirmation
        await expect(newServerRow.locator('button.is-armed')).toBeVisible();
        await expect(newServerRow.locator('button[title="Click again to remove server"]')).toBeVisible();
        await newServerRow.locator('button.is-armed').click({ force: true });

        // Verify count back to 2 and server removed
        await expect(remotePanel.locator('.remote-sidebar-title')).toHaveText('Servers (2)');
        await expect(remotePanel.locator('.remote-server-row').filter({ hasText: 'us-east-worker' })).toHaveCount(0);
    });

    test('should sync a project and create a worktree via modal', async ({ page }) => {
        const remotePanel = await openRemotePanel(page);

        // Select eu-west-gpu
        const remoteServerRow = remotePanel.locator('.remote-server-row').filter({ hasText: 'eu-west-gpu' });
        await remoteServerRow.click();

        // Open Add Project modal from server view
        const addProjectBtn = remotePanel.locator('.remote-main').getByRole('button', { name: 'Project' });
        await addProjectBtn.click();
        const addProjModal = page.locator('.remote-popover').filter({ hasText: 'Add Project on eu-west-gpu' });
        await expect(addProjModal).toBeVisible();

        // Click Sync for anycode-demo
        const syncRow = addProjModal.locator('.remote-sync-project-row').filter({ hasText: 'anycode-demo' });
        await expect(syncRow).toBeVisible();
        await syncRow.getByRole('button', { name: 'Sync' }).click();
        await expect(syncRow.locator('.remote-badge.ok')).toBeVisible();
        await addProjModal.getByRole('button', { name: 'Close' }).first().click();

        // Verify anycode-demo appears under eu-west-gpu in sidebar
        const euWestGroup = remotePanel.locator('.remote-server-group').filter({ hasText: 'eu-west-gpu' });
        const syncedProjectInTree = euWestGroup.locator('.remote-project-row').filter({ hasText: 'anycode-demo' });
        await expect(syncedProjectInTree).toBeVisible();

        // Select gpu-inference project to view worktrees
        const gpuProjRow = remotePanel.locator('.remote-project-row').filter({ hasText: 'gpu-inference' });
        await gpuProjRow.click();

        // Check initial worktree wt-cuda-1
        await expect(remotePanel.locator('.remote-worktree-branch').filter({ hasText: 'agent/fix-cuda-alloc' })).toBeVisible();

        // Open Create Worktree modal
        const worktreeBtn = remotePanel.locator('.remote-card-actions').getByRole('button', { name: 'Worktree', exact: true });
        await worktreeBtn.click();

        const wtModal = page.locator('.remote-popover').filter({ hasText: 'New Worktree on eu-west-gpu' });
        await expect(wtModal).toBeVisible();

        // Fill branch name
        await wtModal.locator('input.remote-input').fill('agent/playwright-test-wt');
        await wtModal.getByRole('button', { name: 'Create Worktree' }).click();

        // Verify new worktree appears in the list
        await expect(remotePanel.locator('.remote-section-title').filter({ hasText: 'Worktrees' })).toContainText('(2)');
        await expect(remotePanel.locator('.remote-worktree-branch').filter({ hasText: 'agent/playwright-test-wt' })).toBeVisible();
    });

    test('should start a remote agent, send a prompt, observe streaming output and queueing when busy', async ({ page }) => {
        const remotePanel = await openRemotePanel(page);

        // Select gpu-inference project
        const gpuProjRow = remotePanel.locator('.remote-project-row').filter({ hasText: 'gpu-inference' });
        await gpuProjRow.click();

        // Click Start Agent
        const startAgentBtn = remotePanel.locator('.remote-card-actions').getByRole('button', { name: 'Start Agent' });
        await startAgentBtn.click();

        const startModal = page.locator('.remote-popover').filter({ hasText: 'Start Agent' });
        await expect(startModal).toBeVisible();

        // Click Claude Code agent card
        const agentCard = startModal.locator('.acp-start-card').filter({ hasText: 'Claude Code' }).first();
        await expect(agentCard).toBeVisible();
        await agentCard.click();

        // Agent session opens
        const promptInput = page.getByPlaceholder('Ask anything...');
        await expect(promptInput).toBeVisible({ timeout: 10000 });
        await expect(promptInput).toBeEnabled({ timeout: 10000 });

        // Send first prompt
        await promptInput.fill('Optimize CUDA kernels');
        await promptInput.press('Enter');

        // Immediately send second prompt while first is busy / streaming
        await promptInput.fill('Profile memory throughput');
        await promptInput.press('Enter');

        // Verify the second prompt entered queue (queued badge visible)
        await expect(page.locator('.acp-queue-badge, .acp-queue-indicator, [title*="queue"]').first()).toBeVisible({ timeout: 5000 });

        // Observe the first prompt being processed and completed
        await expect(page.locator('.acp-content, .acp-message, .acp-message-content').getByText('Optimize CUDA kernels').first()).toBeVisible();

        // Observe the second prompt being processed and completed
        await expect(page.locator('.acp-content, .acp-message, .acp-message-content').getByText('Profile memory throughput').first()).toBeVisible({ timeout: 10000 });
    });

    test('should open worktree diff pill in Multibuffer Review, test pull worktree modal, and remove worktree with armed confirmation', async ({ page }) => {
        const remotePanel = await openRemotePanel(page);

        // Select gpu-inference project
        const gpuProjRow = remotePanel.locator('.remote-project-row').filter({ hasText: 'gpu-inference' });
        await gpuProjRow.click();

        // Verify initial worktree card has diff pill (+14 -3)
        const diffPill = remotePanel.locator('.remote-worktree-card .remote-diff-pill').first();
        await expect(diffPill).toBeVisible();
        await expect(diffPill.locator('.remote-diff-added')).toHaveText('+14');
        await expect(diffPill.locator('.remote-diff-removed')).toHaveText('-3');

        // Click diff pill to open Multibuffer diff review
        await diffPill.click();

        // Multibuffer review header/panel is visible
        await expect(page.locator('.multibuffer-panel').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.multibuffer-panel').getByText('inference.py').first()).toBeVisible({ timeout: 10000 });

        // Switch back to Remote panel tab
        const remoteTab = page.getByRole('tab', { name: /^Remote$/i }).first();
        if (await remoteTab.count() > 0) {
            await remoteTab.click();
        } else {
            await openRemotePanel(page);
        }

        // Test PullWorktreeModal
        const wtCard = remotePanel.locator('.remote-worktree-card').first();
        await wtCard.hover();
        const pullBtn = wtCard.locator('button[title*="Pull"]');
        await expect(pullBtn).toBeVisible();
        await pullBtn.click({ force: true });

        const pullModal = page.locator('.remote-popover').filter({ hasText: 'Pull Worktree from eu-west-gpu' });
        await expect(pullModal).toBeVisible();
        const submitPullBtn = pullModal.getByRole('button', { name: /Pull.*Worktree/i });
        await expect(submitPullBtn).toBeEnabled({ timeout: 5000 });
        await submitPullBtn.click();

        // Verify result displayed in modal
        await expect(pullModal.getByText('Worktree Created Locally')).toBeVisible();
        await expect(pullModal.getByText('Pulled Changes')).toBeVisible();
        await pullModal.locator('.remote-modal-footer').getByRole('button', { name: 'Close' }).click();

        // Create a new worktree so we can test armed removal without active agent
        const worktreeBtn = remotePanel.locator('.remote-card-actions').getByRole('button', { name: 'Worktree', exact: true });
        await worktreeBtn.click();
        const wtModal = page.locator('.remote-popover').filter({ hasText: 'New Worktree on eu-west-gpu' });
        await wtModal.locator('input.remote-input').fill('agent/to-delete');
        await wtModal.getByRole('button', { name: 'Create Worktree' }).click();

        const wtCardToDelete = remotePanel.locator('.remote-worktree-card').filter({ hasText: 'agent/to-delete' });
        await expect(wtCardToDelete).toBeVisible();

        // Armed remove confirmation on worktree
        await wtCardToDelete.hover();
        const removeWtBtn = wtCardToDelete.locator('button[title="Remove git worktree"]');
        await expect(removeWtBtn).toBeVisible();
        await removeWtBtn.click({ force: true });

        // Button becomes armed
        await expect(wtCardToDelete.locator('button.is-armed')).toBeVisible();
        await expect(wtCardToDelete.locator('button[title="Click again to remove worktree"]')).toBeVisible();
        await wtCardToDelete.locator('button.is-armed').click({ force: true });

        // Worktree is removed
        await expect(remotePanel.locator('.remote-worktree-card').filter({ hasText: 'agent/to-delete' })).toHaveCount(0);
    });
});
