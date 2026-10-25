import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import {
    addRemoteProject,
    browseServerDirectory,
    closeRemoteWorkspace,
    removeRemoteRecentWorkspace,
    removeRemoteProject,
    selectRemoteProject,
    type ServerDirectoryListing,
    type WorkspaceState,
} from './workspace';

const fakeSocket = (reply: unknown) => {
    const emit = vi.fn((_event: string, _payload: unknown, acknowledge: (response: unknown) => void) => {
        acknowledge(reply);
    });
    return { socket: { emit } as unknown as Socket, emit };
};

describe('remote workspace API', () => {
    it('browses a server directory using the requested server path', async () => {
        const listing: ServerDirectoryListing = {
            path: '/srv/projects',
            name: 'projects',
            parent: '/srv',
            directories: [{ name: 'api', path: '/srv/projects/api' }],
        };
        const { socket, emit } = fakeSocket({ success: true, ...listing });

        await expect(browseServerDirectory(socket, '/srv')).resolves.toMatchObject(listing);
        expect(emit).toHaveBeenCalledWith('workspace:browse', { path: '/srv' }, expect.any(Function));
    });

    it('adds only the selected server path and surfaces backend revalidation errors', async () => {
        const state: WorkspaceState = {
            projects: [{ id: '/srv/projects/api', name: 'api', root: '/srv/projects/api' }],
            active_project_id: '/srv/projects/api',
            recent_workspaces: [],
        };
        const { socket, emit } = fakeSocket({ success: true, ...state });
        await expect(addRemoteProject(socket, '/srv/projects/api')).resolves.toMatchObject(state);
        expect(emit).toHaveBeenCalledWith(
            'workspace:add-project',
            { path: '/srv/projects/api' },
            expect.any(Function),
        );

        const invalid = fakeSocket({ success: false, error: 'Directory does not exist' });
        await expect(addRemoteProject(invalid.socket, '/srv/missing')).rejects.toThrow(
            'Directory does not exist',
        );
    });

    it('keeps project selection and close actions on their explicit Socket.IO events', async () => {
        const state: WorkspaceState = {
            projects: [],
            active_project_id: null,
            recent_workspaces: [],
        };
        const { socket, emit } = fakeSocket({ success: true, ...state });

        await selectRemoteProject(socket, '/srv/projects/api');
        await removeRemoteProject(socket, '/srv/projects/api');
        await closeRemoteWorkspace(socket);

        expect(emit.mock.calls.map(([event, payload]) => [event, payload])).toEqual([
            ['workspace:select-project', { project_id: '/srv/projects/api' }],
            ['workspace:remove-project', { project_id: '/srv/projects/api' }],
            ['workspace:close', {}],
        ]);
    });

    it('removes a recent server path without changing project lifecycle', async () => {
        const { socket, emit } = fakeSocket({ success: true, recent_workspaces: [] });

        await expect(removeRemoteRecentWorkspace(socket, '/srv/projects/old')).resolves.toEqual([]);
        expect(emit).toHaveBeenCalledWith(
            'workspace:remove-recent',
            { path: '/srv/projects/old' },
            expect.any(Function),
        );
    });
});
