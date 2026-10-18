import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Search from './Search';

describe('Search project selector', () => {
    it('shows the selected workspace project before the search mode tabs inside the input', () => {
        const noop = vi.fn();
        const html = renderToStaticMarkup(
            React.createElement(Search, {
                id: 'search',
                wsRef: { current: null },
                isConnected: true,
                projects: [
                    { id: 'alpha', name: 'Alpha', root: '/workspace/alpha' },
                    { id: 'beta', name: 'Beta', root: '/workspace/beta' },
                ],
                projectId: 'beta',
                onProjectChange: noop,
                inputValue: '',
                onInputValueChange: noop,
                onEnter: noop,
                onCancel: noop,
                onMatchClick: noop,
                onFileClick: noop,
                results: [],
                searchEnded: true,
            }),
        );

        expect(html).toContain('aria-label="Project"');
        expect(html).toContain('value="alpha"');
        expect(html).toContain('value="beta" selected=""');
        expect(html.indexOf('class="search-input-controls"')).toBeLessThan(html.indexOf('aria-label="Project"'));
        expect(html.indexOf('aria-label="Project"')).toBeLessThan(html.indexOf('class="search-mode-toggle"'));
    });
});
