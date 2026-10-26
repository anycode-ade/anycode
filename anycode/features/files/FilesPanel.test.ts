import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FilesPanel } from './FilesPanel';

describe('FilesPanel project selector', () => {
    it('uses the visible project root as the selector and shows only its tree', () => {
        const noop = vi.fn();
        const html = renderToStaticMarkup(
            React.createElement(FilesPanel, {
                fileTree: [
                    {
                        id: 'project:alpha',
                        name: 'Alpha',
                        path: '/workspace/alpha',
                        project_id: 'alpha',
                        type: 'directory',
                        isExpanded: true,
                        children: [{
                            id: '/workspace/alpha/alpha-only.txt',
                            name: 'alpha-only.txt',
                            path: '/workspace/alpha/alpha-only.txt',
                            project_id: 'alpha',
                            type: 'file',
                        }],
                    },
                    {
                        id: 'project:beta',
                        name: 'Beta',
                        path: '/workspace/beta',
                        project_id: 'beta',
                        type: 'directory',
                        isExpanded: true,
                        children: [{
                            id: '/workspace/beta/beta-only.txt',
                            name: 'beta-only.txt',
                            path: '/workspace/beta/beta-only.txt',
                            project_id: 'beta',
                            type: 'file',
                        }],
                    },
                ],
                activeNodeId: 'project:beta',
                focusRequestToken: null,
                onActivateNode: noop,
                onToggle: noop,
                onSelect: noop,
                onOpenFile: noop,
                onLoadFolder: noop,
                onFocusEditor: noop,
                onNavigateByKey: () => false,
                projects: [
                    { id: 'alpha', name: 'Alpha', root: '/workspace/alpha' },
                    { id: 'beta', name: 'Beta', root: '/workspace/beta' },
                ],
                activeProjectId: 'beta',
                onSelectProject: noop,
                onAddProject: noop,
            }),
        );

        expect(html.match(/aria-label="Switch project"/g)).toHaveLength(1);
        // Only the chevron is a button; the project name must not open the menu.
        expect(html).not.toMatch(/<button[^>]*>\s*<span class="project-switcher-name"/);
        expect(html).toContain('class="tree-project-selector"');
        expect(html).toContain('project-root-selector');
        expect(html).toMatch(/project-root-selector[^"]*active/);
        expect(html).toContain('class="project-switcher"');
        expect(html).toContain('project-switcher-name" title="Beta">Beta<');
        expect(html).toContain('aria-haspopup="menu"');
        expect(html).not.toContain('tree-add-project');
        expect(html).not.toContain('files-project-toolbar');
        expect(html).not.toContain('Select project');
        expect(html).toContain('beta-only.txt');
        expect(html).not.toContain('alpha-only.txt');
    });

    it('disables the project chevron while the add-folder picker is open', () => {
        const noop = vi.fn();
        const render = (isAddingProject: boolean) => renderToStaticMarkup(
            React.createElement(FilesPanel, {
                fileTree: [{ id: 'project:alpha', name: 'Alpha', path: '/workspace/alpha', project_id: 'alpha', type: 'directory', isExpanded: true, children: [] }],
                activeNodeId: null,
                focusRequestToken: null,
                onActivateNode: noop,
                onToggle: noop,
                onSelect: noop,
                onOpenFile: noop,
                onLoadFolder: noop,
                onFocusEditor: noop,
                onNavigateByKey: () => false,
                projects: [
                    { id: 'alpha', name: 'Alpha', root: '/workspace/alpha' },
                    { id: 'beta', name: 'Beta', root: '/workspace/beta' },
                ],
                activeProjectId: 'alpha',
                onSelectProject: noop,
                onAddProject: noop,
                isAddingProject,
            }),
        );

        expect(render(false)).not.toMatch(/project-switcher-trigger" disabled/);
        expect(render(true)).toMatch(/class="project-switcher-trigger"[^>]*disabled/);
    });
});
