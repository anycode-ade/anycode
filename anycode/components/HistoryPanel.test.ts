import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel';

describe('HistoryPanel project selector', () => {
    it('shows workspace projects and marks the history project as selected', () => {
        const noop = vi.fn();
        const html = renderToStaticMarkup(
            React.createElement(HistoryPanel, {
                projects: [
                    { id: 'alpha', name: 'Alpha', root: '/workspace/alpha' },
                    { id: 'beta', name: 'Beta', root: '/workspace/beta' },
                ],
                selectedProjectId: 'beta',
                historyProjectId: 'beta',
                onProjectChange: noop,
                commits: [],
                filesByCommit: {},
                hasMore: false,
                loading: false,
                loaded: true,
                filesLoading: {},
                historyPath: null,
                activeFilePath: null,
                onRefresh: noop,
                onLoadMore: noop,
                onSearch: noop,
                onClearSearch: noop,
                onCancelSearch: noop,
                onCommitExpand: noop,
                onFileClick: noop,
                onReviewCommit: noop,
                onShowRepository: noop,
                onShowFile: noop,
            }),
        );

        expect(html).toContain('aria-label="Project"');
        expect(html).toContain('value="alpha"');
        expect(html).toContain('value="beta" selected=""');
        expect(html.indexOf('aria-label="Project"')).toBeLessThan(html.indexOf('Repository'));
    });
});
