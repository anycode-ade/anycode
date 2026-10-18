import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChangesPanel, GitActionState } from './ChangesPanel';

describe('ChangesPanel project selector', () => {
    it('shows all workspace projects and selects the chosen project', () => {
        const noop = vi.fn();
        const html = renderToStaticMarkup(
            React.createElement(ChangesPanel, {
                files: [],
                projects: [
                    { id: 'alpha', name: 'Alpha', root: '/workspace/alpha' },
                    { id: 'beta', name: 'Beta', root: '/workspace/beta' },
                ],
                selectedProjectId: 'beta',
                onProjectChange: noop,
                active: null,
                branch: '',
                branches: [],
                isSwitchingBranch: false,
                onFileClick: noop,
                onRefresh: noop,
                onBranchChange: vi.fn(async () => true),
                onCreateBranch: vi.fn(async () => true),
                onCommit: vi.fn(async () => true),
                onPush: noop,
                pushStatus: { state: GitActionState.Idle },
                onFetch: noop,
                onPull: noop,
                onRevert: noop,
                onStage: noop,
                onUnstage: noop,
                onOpenMultibuffer: noop,
            }),
        );

        expect(html).toContain('aria-label="Project"');
        expect(html).toContain('value="alpha"');
        expect(html).toContain('value="beta" selected=""');
    });
});
