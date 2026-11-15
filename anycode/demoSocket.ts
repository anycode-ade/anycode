// demoSocket.ts - In-memory Mock Socket for Anycode Live Demo
import { Code } from 'anycode-editor';
import { DEMO_RESUME_SESSION_ID, buildDemoResumeHistory } from './demoSessionHistory';
import type {
    RemoteServerView,
    RemoteProjectInfo,
    NodeAgentSummary,
    RemoteWorktreeEntry,
    WorktreeDiffResponse,
    RemoteGitStateInfo,
    PullProjectResult,
    CreateWorktreeResult,
    RemoteBrowseResponse,
} from './features/remote/types';
import type {
    AcpAgent,
    AcpRegistryAgentSummary,
    AcpQueuedMessage,
    AcpSelectOption,
} from './types';

type EventHandler = (...args: any[]) => void;

interface VfsNode {
    path: string;
    name: string;
    is_dir: boolean;
    content?: string;
    code?: Code;
}

function getNodeContent(node: VfsNode): string {
    if (node.code) {
        return node.code.getContent();
    }
    return node.content ?? '';
}

function getNodeLines(node: VfsNode): string[] {
    if (node.code) {
        return node.code.getLines();
    }
    return typeof node.content === 'string' ? node.content.split('\n') : [];
}

function generateDemoScrollContent(targetLines: number = 1000000): string {
    const lines: string[] = [
        '/** Long TypeScript file used to exercise virtual scrolling with 1,000,000 lines in demo mode. */',
        '// Generated records for stress testing virtual scrolling and tree-sitter',
        '',
    ];
    let recordIndex = 1;
    while (lines.length + 10 <= targetLines) {
        lines.push(
            `export function processRecord${recordIndex}(payload: Record<string, unknown>): Record<string, unknown> {`,
            `    /** Normalize record ${recordIndex} for the demo pipeline. */`,
            `    const record: Record<string, unknown> = {`,
            `        id: ${recordIndex},`,
            `        name: payload.name ?? "record-${recordIndex}",`,
            `        active: Boolean(payload.active ?? true),`,
            `        score: Number(payload.score ?? 0),`,
            `    };`,
            `    return record;`,
            `}`
        );
        if (lines.length < targetLines) {
            lines.push('');
        }
        recordIndex++;
    }
    while (lines.length < targetLines) {
        lines.push(`export const item_${lines.length + 1} = ${lines.length + 1};`);
    }
    return lines.join('\n') + '\n';
}

const SCROLL_DEMO_CONTENT = generateDemoScrollContent(1000000);

// Same channel the backend uses for terminal output: terminal:data:<session>:<name>.
function terminalDataChannel(payload: any): string {
    const name = payload?.name || payload?.terminal_id || 'terminal-1';
    return `terminal:data:${payload?.session}:${name}`;
}

const DEMO_PROJECT_ID = 'demo-project';

// Every workspace event answers with this single fixed project rooted at the VFS root ('.'),
// matching the relative VFS paths. Workspace mutations are no-ops in demo mode.
const DEMO_WORKSPACE_STATE = {
    projects: [{ id: DEMO_PROJECT_ID, name: 'anycode-demo', root: '.' }],
    active_project_id: DEMO_PROJECT_ID,
    recent_workspaces: [] as unknown[],
};

const DEMO_VFS: Record<string, VfsNode> = {
    '.': { path: '.', name: '.', is_dir: true },
    'src': { path: 'src', name: 'src', is_dir: true },
    'src/main.rs': {
        path: 'src/main.rs',
        name: 'main.rs',
        is_dir: false,
        content: `fn main() {
    println!("Hello from Anycode Live Demo!");
    
    let numbers = vec![1, 2, 3, 4, 5];
    let sum: i32 = numbers.iter().sum();
    println!("Sum of numbers: {}", sum);
}
`,
    },
    'src/App.tsx': {
        path: 'src/App.tsx',
        name: 'App.tsx',
        is_dir: false,
        content: `import React, { useState } from 'react';

export const App: React.FC = () => {
    const [count, setCount] = useState<number>(0);

    return (
        <div className="demo-container">
            <h1>Welcome to Anycode IDE Demo</h1>
            <p>Fast WebAssembly & Tree-Sitter editor</p>
            <button onClick={() => setCount(c => c + 1)}>
                Clicks: {count}
            </button>
        </div>
    );
};
`,
    },
    'demo.py': {
        path: 'demo.py',
        name: 'demo.py',
        is_dir: false,
        content: `def greet(name: str) -> str:
    """Return a greeting message."""
    return f"Hello, {name}! Welcome to Anycode Live Demo."

if __name__ == "__main__":
    msg = greet("Developer")
    print(msg)
`,
    },
    'scroll-demo.ts': {
        path: 'scroll-demo.ts',
        name: 'scroll-demo.ts',
        is_dir: false,
        content: `/** Long file used to exercise virtual scrolling in the live demo. */\n\n${SCROLL_DEMO_CONTENT}`,
    },
    'README.md': {
        path: 'README.md',
        name: 'README.md',
        is_dir: false,
        content: `# Anycode Live Demo

Welcome to **Anycode** — a high-performance web IDE with custom WASM Tree-Sitter rendering!

## Features
- **Tree-Sitter Syntax Highlighting**: Runs client-side in WebAssembly
- **Virtual DOM Editor**: Renders visible lines efficiently
- **Mock Terminal & Search**: Complete browser-only experience
- **AI Agent Integration**: ACP protocol support
`,
    },
};

// Original VFS contents tracker for Git diffs and modifications
const ORIGINAL_VFS_CONTENTS: Record<string, string> = {};
Object.entries(DEMO_VFS).forEach(([path, node]) => {
    if (!node.is_dir && node.content !== undefined) {
        ORIGINAL_VFS_CONTENTS[path] = node.content;
    }
});

interface DemoGitFile {
    path: string;
    status: 'modified' | 'added' | 'deleted';
    staged: boolean;
}

const DEMO_CHANGED_FILES = new Map<string, DemoGitFile>();

const DEMO_HISTORY_COMMITS = [
    {
        hash: 'de00000000000000000000000000000000000001',
        parents: ['de00000000000000000000000000000000000002'],
        summary: 'Welcome to the Anycode demo',
        message: 'Welcome to the Anycode demo',
        author_name: 'Anycode',
        author_email: 'demo@anycode.dev',
        timestamp: 1735689600,
        timezone_offset: 0,
    },
    {
        hash: 'de00000000000000000000000000000000000002',
        parents: ['de00000000000000000000000000000000000003'],
        summary: 'Add editor and terminal panels',
        message: 'Add editor and terminal panels',
        author_name: 'Anycode',
        author_email: 'demo@anycode.dev',
        timestamp: 1735603200,
        timezone_offset: 0,
    },
    {
        hash: 'de00000000000000000000000000000000000003',
        parents: [],
        summary: 'Initial project',
        message: 'Initial project',
        author_name: 'Anycode',
        author_email: 'demo@anycode.dev',
        timestamp: 1735516800,
        timezone_offset: 0,
    },
    {
        hash: 'de00000000000000000000000000000000000004',
        parents: [],
        summary: 'Remove obsolete helper',
        message: 'Remove obsolete helper',
        author_name: 'Anycode',
        author_email: 'demo@anycode.dev',
        timestamp: 1735430400,
        timezone_offset: 0,
    },
];
let demoCommitSequence = 5;

type DemoHistoryFile = {
    path: string;
    status: 'modified' | 'added' | 'deleted';
    added: number;
    removed: number;
    binary: boolean;
};

const DEMO_HISTORY_FILES: Record<string, DemoHistoryFile[]> = {
    [DEMO_HISTORY_COMMITS[0].hash]: [
        { path: 'src/main.rs', status: 'modified', added: 30, removed: 2, binary: false },
        { path: 'README.md', status: 'modified', added: 15, removed: 0, binary: false },
        { path: 'src/App.tsx', status: 'modified', added: 25, removed: 3, binary: false },
        { path: 'src/utils.ts', status: 'modified', added: 30, removed: 1, binary: false },
        { path: 'src/logger.ts', status: 'added', added: 40, removed: 0, binary: false },
        { path: 'src/config.ts', status: 'modified', added: 20, removed: 2, binary: false },
    ],
    [DEMO_HISTORY_COMMITS[1].hash]: [
        { path: 'src/main.rs', status: 'modified', added: 8, removed: 2, binary: false },
        { path: 'src/App.tsx', status: 'modified', added: 12, removed: 1, binary: false },
    ],
    [DEMO_HISTORY_COMMITS[2].hash]: Object.keys(ORIGINAL_VFS_CONTENTS).map((path) => ({
        path,
        status: 'added' as const,
        added: 1,
        removed: 0,
        binary: false,
    })),
    [DEMO_HISTORY_COMMITS[3].hash]: [
        { path: 'src/obsolete-helper.ts', status: 'deleted', added: 0, removed: 4, binary: false },
    ],
};

let demoCurrentBranch = 'main';
const demoBranches: string[] = ['main'];

const notifyGitChange = (socket: DemoSocket, targetPath: string) => {
    const node = DEMO_VFS[targetPath];
    const original = ORIGINAL_VFS_CONTENTS[targetPath];

    if (!node) {
        DEMO_CHANGED_FILES.set(targetPath, { path: targetPath, status: 'deleted', staged: false });
    } else if (original === undefined) {
        DEMO_CHANGED_FILES.set(targetPath, { path: targetPath, status: 'added', staged: false });
    } else {
        // Compare content, not Code.versionId: the version only grows, so reverting edits would stay "modified".
        const isModified = getNodeContent(node) !== original;
        if (isModified) {
            const existing = DEMO_CHANGED_FILES.get(targetPath);
            DEMO_CHANGED_FILES.set(targetPath, {
                path: targetPath,
                status: 'modified',
                staged: existing ? existing.staged : false,
            });
        } else {
            DEMO_CHANGED_FILES.delete(targetPath);
        }
    }

    const changedItem = DEMO_CHANGED_FILES.get(targetPath);
    // The backend stamps project_id on every git:update; the Changes panel only reads per-project git state.
    const gitUpdatePayload = {
        kind: 'patch',
        project_id: DEMO_PROJECT_ID,
        branch: demoCurrentBranch,
        files: changedItem
            ? [{ path: targetPath, status: changedItem.status, staged: changedItem.staged }]
            : [{ path: targetPath, status: 'removed', staged: false }],
    };

    socket.emitLocal('git:update', gitUpdatePayload);
};

const applyEditsToNode = (node: VfsNode, edits: any[]): void => {
    if (!node.code) {
        node.code = new Code(node.content || '', node.name, 'text');
    }
    for (const edit of edits) {
        if (!edit || typeof edit.start !== 'number' || typeof edit.text !== 'string') continue;
        const start = edit.start;
        const text = edit.text;

        if (edit.operation === 'insert') {
            node.code.insert(text, start);
        } else if (edit.operation === 'remove') {
            node.code.remove(start, text.length);
        }
    }
    node.content = undefined;
};

// Dynamically import all 27+ real theme JSON files from the project themes/ directory via Vite glob!
const themeModules = import.meta.glob<Record<string, any>>('../themes/*.json', { eager: true });

const THEME_FILES_MAP: Record<string, any> = {};
const THEME_LIST: { id?: string; name: string; fileName: string; themeName?: string }[] = [];

Object.entries(themeModules).forEach(([filePath, mod]) => {
    const fileName = filePath.split('/').pop() || '';
    const themeJson = (mod as any).default || mod;
    THEME_FILES_MAP[fileName] = themeJson;

    if (themeJson && Array.isArray(themeJson.themes)) {
        themeJson.themes.forEach((t: any) => {
            const themeName = t.name || fileName.replace('.json', '');
            const id = `${fileName}:${themeName}`;
            THEME_LIST.push({
                id,
                name: themeName,
                fileName,
                themeName,
            });
        });
    }
});

interface DemoRunningAgent {
    id: string;
    name: string;
    session_id: string;
    project_id: string | null;
}


const createInitialRemoteServers = (): RemoteServerView[] => [
    {
        id: 'local',
        name: 'Local',
        url: 'http://127.0.0.1:3000',
        open_url: 'http://127.0.0.1:3000',
        is_local: true,
        status: 'online',
        ping_ms: 1,
        info: {
            name: 'Local',
            os: 'macos',
            arch: 'arm64',
            version: '0.1.0',
        },
        projects: [
            { id: DEMO_PROJECT_ID, name: 'anycode-demo', root: '.' },
        ],
        agents: [],
    },
    {
        id: 'srv-demo-1',
        name: 'eu-west-gpu',
        url: 'http://10.0.1.42:3000',
        open_url: 'http://10.0.1.42:3000',
        is_local: false,
        status: 'online',
        ping_ms: 18,
        info: {
            name: 'eu-west-gpu',
            os: 'linux',
            arch: 'x86_64',
            version: '0.1.0',
        },
        projects: [
            {
                id: 'proj-gpu-1',
                name: 'gpu-inference',
                root: '/home/ubuntu/gpu-inference',
            },
            {
                id: 'proj-models-2',
                name: 'model-weights',
                root: '/data/models',
            },
        ],
        agents: [
            {
                id: 'claude-1',
                project_id: 'proj-gpu-1',
                name: 'Claude 3.7 Sonnet',
                session_id: 'sess-remote-claude-1',
                is_processing: false,
                queue: [],
                worktree_path: '/home/ubuntu/gpu-inference-wt-1',
                worktree_branch: 'agent/fix-cuda-alloc',
                diff_added: 14,
                diff_removed: 3,
                diff_files: 2,
            },
        ],
    },
];

const createInitialRemoteWorktrees = (): Map<string, RemoteWorktreeEntry[]> => {
    const map = new Map<string, RemoteWorktreeEntry[]>();
    map.set('srv-demo-1::proj-gpu-1', [
        {
            id: 'wt-cuda-1',
            path: '/home/ubuntu/gpu-inference-wt-1',
            branch: 'agent/fix-cuda-alloc',
            head_sha: 'd3adb33f00000001',
            short_sha: 'd3adb33',
            commits_ahead: 1,
            dirty_count: 0,
            is_dirty: false,
            base_sha: '0000000000000000',
            is_main: false,
            diff_added: 14,
            diff_removed: 3,
            diff_files: 2,
        },
    ]);
    return map;
};

const DEFAULT_REMOTE_CONFIGURED_AGENTS: AcpAgent[] = [
    {
        id: 'claude',
        name: 'Claude Code',
        command: 'claude-code-acp',
        args: [],
        description: 'Anthropic Claude Code via ACP',
        profile: 'claude',
    },
    {
        id: 'codex',
        name: 'Codex ACP',
        command: 'codex-acp',
        args: [],
        description: 'OpenAI Codex agent via ACP',
        profile: 'codex',
    },
];

const DEFAULT_LOCAL_CONFIGURED_AGENTS: AcpAgent[] = [
    {
        id: 'demo-agent',
        name: 'Demo Agent',
        command: 'demo-acp',
        args: [],
        description: 'Local demo mock agent',
    },
];

const DEFAULT_REMOTE_REGISTRY_AGENTS: AcpRegistryAgentSummary[] = [
    {
        id: 'claude-code-acp',
        name: 'Claude Code',
        version: '0.2.14',
        description: 'Anthropic Claude Code CLI ACP bridge',
        authors: ['Anthropic', 'Anycode'],
        distribution_type: 'binary',
        is_supported: true,
        has_update: false,
        is_installed: true,
        installed_version: '0.2.14',
        installed_path: 'claude-code-acp',
        binary_target: {
            archive: 'claude-code-acp-linux-x64.tar.gz',
            cmd: 'claude-code-acp',
            args: [],
        },
    },
    {
        id: 'codex-acp',
        name: 'Codex ACP',
        version: '0.1.8',
        description: 'OpenAI Codex reasoning and code generation agent',
        authors: ['OpenAI', 'Anycode'],
        distribution_type: 'binary',
        is_supported: true,
        has_update: false,
        is_installed: true,
        installed_version: '0.1.8',
        installed_path: 'codex-acp',
        binary_target: {
            archive: 'codex-acp-linux-x64.tar.gz',
            cmd: 'codex-acp',
            args: [],
        },
    },
    {
        id: 'gemini-acp',
        name: 'Gemini CLI',
        version: '1.2.0',
        description: 'Google DeepMind Gemini agent for coding',
        authors: ['Google DeepMind'],
        distribution_type: 'binary',
        is_supported: true,
        has_update: false,
        is_installed: false,
        binary_target: {
            archive: 'gemini-acp-linux-x64.tar.gz',
            cmd: 'gemini-acp',
            args: [],
        },
    },
];

export class DemoSocket {
    public connected: boolean = true;
    public active: boolean = true;
    public id: string = 'demo-socket-id';

    private listeners: Map<string, Set<EventHandler>> = new Map();
    private terminalBuffer: string = '';
    private terminalCurrentDir: string = '.';
    private agentNames: Map<string, string> = new Map();
    private runningAgents: Map<string, DemoRunningAgent> = new Map();
    public remoteServers: RemoteServerView[] = createInitialRemoteServers();
    private remoteWorktrees: Map<string, RemoteWorktreeEntry[]> = createInitialRemoteWorktrees();
    private remoteConfiguredAgents: Map<string, AcpAgent[]> = new Map([
        ['local', [...DEFAULT_LOCAL_CONFIGURED_AGENTS]],
        ['srv-demo-1', [...DEFAULT_REMOTE_CONFIGURED_AGENTS]],
    ]);
    private remoteRegistryAgents: Map<string, AcpRegistryAgentSummary[]> = new Map([
        ['local', [...DEFAULT_REMOTE_REGISTRY_AGENTS]],
        ['srv-demo-1', [...DEFAULT_REMOTE_REGISTRY_AGENTS]],
    ]);
    private remotePromptTimers: Map<string, ReturnType<typeof setTimeout>[]> = new Map();

    constructor() {
        // Trigger connect event on next tick
        setTimeout(() => {
            this.emitLocal('connect');
        }, 10);
    }

    public on(event: string, handler: EventHandler): this {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);
        return this;
    }

    public off(event: string, handler: EventHandler): this {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
        return this;
    }

    public once(event: string, handler: EventHandler): this {
        const onceWrapper = (...args: any[]) => {
            this.off(event, onceWrapper);
            handler(...args);
        };
        return this.on(event, onceWrapper);
    }

    public connect(): this {
        this.connected = true;
        this.active = true;
        this.emitLocal('connect');
        return this;
    }

    public disconnect(): this {
        this.connected = false;
        this.active = false;
        this.remotePromptTimers.forEach((timers) => timers.forEach(clearTimeout));
        this.remotePromptTimers.clear();
        this.emitLocal('disconnect', 'client disconnect');
        return this;
    }

    public emit(event: string, ...args: any[]): this {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const payload = args[0] || {};

        this.handleEvent(event, payload, callback);
        return this;
    }

    emitLocal(event: string, ...args: any[]): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.forEach((fn) => {
                try {
                    fn(...args);
                } catch (e) {
                    console.error(`Error in event listener for ${event}:`, e);
                }
            });
        }
    }

    private handleEvent(event: string, payload: any, callback: ((res: any) => void) | null): void {
        switch (event) {
            case 'remote:servers:list': {
                callback?.({ success: true, servers: [...this.remoteServers] });
                break;
            }

            case 'remote:servers:add': {
                this.handleRemoteServersAdd(payload, callback);
                break;
            }

            case 'remote:servers:remove': {
                this.handleRemoteServersRemove(payload, callback);
                break;
            }

            case 'remote:servers:reconnect': {
                this.handleRemoteServersReconnect(payload, callback);
                break;
            }

            case 'remote:rpc': {
                this.handleRemoteRpc(payload, callback);
                break;
            }

            case 'workspace:state':
            case 'workspace:select-project':
            case 'workspace:add-project':
            case 'workspace:remove-project':
            case 'workspace:remove-recent':
            case 'workspace:close': {
                callback?.({ success: true, ...DEMO_WORKSPACE_STATE });
                break;
            }

            case 'dir:list': {
                const reqPath = (payload?.path || '.').replace(/^\.\//, '');
                const normPath = reqPath === '' ? '.' : reqPath;
                const prefix = normPath === '.' ? '' : `${normPath}/`;

                const files: string[] = [];
                const dirs: string[] = [];

                Object.values(DEMO_VFS).forEach((node) => {
                    if (node.path === '.' || node.path === normPath) return;
                    if (prefix === '') {
                        if (!node.path.includes('/')) {
                            if (node.is_dir) dirs.push(node.name);
                            else files.push(node.name);
                        }
                    } else if (node.path.startsWith(prefix)) {
                        const rest = node.path.slice(prefix.length);
                        if (!rest.includes('/')) {
                            if (node.is_dir) dirs.push(node.name);
                            else files.push(node.name);
                        }
                    }
                });

                callback?.({
                    name: normPath === '.' ? 'anycode-demo' : normPath.split('/').pop(),
                    relative_path: normPath,
                    fullpath: normPath,
                    files,
                    dirs,
                });
                break;
            }

            case 'file:open': {
                const targetPath = payload?.path || '';
                const cleanPath = targetPath.replace(/^\.\//, '');
                const node = DEMO_VFS[targetPath] || DEMO_VFS[cleanPath] || DEMO_VFS[`./${targetPath}`];
                if (node && !node.is_dir) {
                    const content = getNodeContent(node);
                    const originalContent = ORIGINAL_VFS_CONTENTS[targetPath] ?? ORIGINAL_VFS_CONTENTS[cleanPath] ?? content;
                    callback?.({
                        success: true,
                        content,
                        path: targetPath,
                        original: { content: originalContent, is_new: false, status: 'ok' },
                        history: { items: [], changes: [], index: 0 },
                    });
                } else {
                    callback?.({ success: false, message: 'File not found' });
                }
                break;
            }

            case 'file:save':
            case 'file:change': {
                const targetPath = payload?.path || payload?.file;
                const cleanPath = targetPath?.replace(/^\.\//, '');
                const key = DEMO_VFS[targetPath] ? targetPath : (DEMO_VFS[cleanPath] ? cleanPath : targetPath);

                if (key && DEMO_VFS[key]) {
                    const node = DEMO_VFS[key];
                    if (typeof payload.content === 'string') {
                        if (node.code) {
                            node.code.setContent(payload.content);
                        } else {
                            node.content = payload.content;
                        }
                    } else if (Array.isArray(payload.edits) && payload.edits.length > 0) {
                        applyEditsToNode(node, payload.edits);
                    }
                    notifyGitChange(this, key);
                }
                callback?.({ status: 'ok', success: true });
                break;
            }

            case 'file:create': {
                const parent = payload?.parent_path || '.';
                const cleanParent = parent.replace(/^\.\//, '');
                const name = payload?.name || 'new_file.txt';
                const isFile = payload?.is_file !== false;
                const newPath = cleanParent === '.' || cleanParent === '' ? name : `${cleanParent}/${name}`;

                DEMO_VFS[newPath] = {
                    path: newPath,
                    name,
                    is_dir: !isFile,
                    content: isFile ? '' : undefined,
                };

                if (isFile) {
                    notifyGitChange(this, newPath);
                }

                // Broadcast watcher event to update React file tree UI instantly
                this.emitLocal('watcher:create', { path: newPath, isFile });

                callback?.({
                    status: 'ok',
                    success: true,
                    path: newPath,
                    file: isFile ? newPath : undefined,
                    dir: !isFile ? newPath : undefined,
                });
                break;
            }

            case 'file:delete': {
                const targetPath = payload?.path || '';
                const cleanPath = targetPath.replace(/^\.\//, '');
                const key = DEMO_VFS[targetPath] ? targetPath : (DEMO_VFS[cleanPath] ? cleanPath : targetPath);

                if (key && DEMO_VFS[key]) {
                    const isFile = !DEMO_VFS[key].is_dir;

                    // Delete target node and all sub-nodes if it's a directory
                    Object.keys(DEMO_VFS).forEach((pathKey) => {
                        if (pathKey === key || pathKey.startsWith(`${key}/`)) {
                            delete DEMO_VFS[pathKey];
                            notifyGitChange(this, pathKey);
                        }
                    });

                    // Broadcast watcher event to remove node from React file tree UI
                    this.emitLocal('watcher:remove', { path: key, isFile });
                }

                callback?.({ status: 'ok', success: true });
                break;
            }

            case 'file:rename': {
                const oldPath = payload?.old_path || '';
                const newPath = payload?.new_path || '';
                const cleanOld = oldPath.replace(/^\.\//, '');
                const cleanNew = newPath.replace(/^\.\//, '');

                if (cleanOld && cleanNew) {
                    const oldPrefix = `${cleanOld}/`;
                    const newPrefix = `${cleanNew}/`;

                    Object.keys(DEMO_VFS).forEach((pathKey) => {
                        if (pathKey === cleanOld) {
                            const node = DEMO_VFS[cleanOld];
                            delete DEMO_VFS[cleanOld];
                            node.path = cleanNew;
                            node.name = cleanNew.split('/').pop() || cleanNew;
                            DEMO_VFS[cleanNew] = node;
                            notifyGitChange(this, cleanOld);
                            notifyGitChange(this, cleanNew);
                        } else if (pathKey.startsWith(oldPrefix)) {
                            const node = DEMO_VFS[pathKey];
                            delete DEMO_VFS[pathKey];
                            const subPath = cleanNew + pathKey.slice(cleanOld.length);
                            node.path = subPath;
                            node.name = subPath.split('/').pop() || subPath;
                            DEMO_VFS[subPath] = node;
                            notifyGitChange(this, pathKey);
                            notifyGitChange(this, subPath);
                        }
                    });

                    this.emitLocal('file:rename', { old: cleanOld, new: cleanNew });
                }

                callback?.({ status: 'ok', success: true, old: cleanOld, new: cleanNew });
                break;
            }

            case 'git:status': {
                callback?.({
                    success: true,
                    project_id: DEMO_PROJECT_ID,
                    branch: demoCurrentBranch,
                    files: Array.from(DEMO_CHANGED_FILES.values()),
                });
                break;
            }

            case 'git:branches': {
                callback?.({
                    success: true,
                    branches: demoBranches.map((name) => ({ name, is_current: name === demoCurrentBranch })),
                });
                break;
            }

            case 'git:checkout': {
                const target = payload?.branch;
                if (target && demoBranches.includes(target)) {
                    demoCurrentBranch = target;
                    callback?.({ success: true });
                    this.emitLocal('git:update', { kind: 'full', project_id: DEMO_PROJECT_ID, branch: demoCurrentBranch, files: Array.from(DEMO_CHANGED_FILES.values()) });
                } else {
                    callback?.({ success: false, error: 'Branch not found' });
                }
                break;
            }

            case 'git:create_branch': {
                const newBranch = payload?.branch?.trim();
                if (newBranch) {
                    if (!demoBranches.includes(newBranch)) {
                        demoBranches.push(newBranch);
                    }
                    demoCurrentBranch = newBranch;
                    callback?.({ success: true });
                    this.emitLocal('git:update', { kind: 'full', project_id: DEMO_PROJECT_ID, branch: demoCurrentBranch, files: Array.from(DEMO_CHANGED_FILES.values()) });
                } else {
                    callback?.({ success: false, error: 'Branch name cannot be empty' });
                }
                break;
            }

            case 'git:file-original': {
                const targetPath = payload?.path || '';
                const cleanPath = targetPath.replace(/^\.\//, '');
                const content = ORIGINAL_VFS_CONTENTS[targetPath] ?? ORIGINAL_VFS_CONTENTS[cleanPath] ?? '';
                callback?.({
                    success: true,
                    content,
                });
                break;
            }

            case 'git:history': {
                const offset = payload?.offset ?? 0;
                const limit = payload?.limit ?? 50;
                const requestedPath = String(payload?.path ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
                const matchingCommits = requestedPath
                    ? DEMO_HISTORY_COMMITS.filter((commit) => DEMO_HISTORY_FILES[commit.hash]?.some((file) => file.path === requestedPath || requestedPath.endsWith(`/${file.path}`)))
                    : DEMO_HISTORY_COMMITS;
                const commits = matchingCommits.slice(offset, offset + limit);
                callback?.({ success: true, commits, has_more: false });
                break;
            }

            case 'git:history-search': {
                const requestId = payload?.request_id;
                const query = String(payload?.query ?? '').trim().toLowerCase();
                const mode = payload?.mode ?? 'message';
                const offset = payload?.offset ?? 0;
                const limit = payload?.limit ?? 50;
                const matches = DEMO_HISTORY_COMMITS.filter((commit) => {
                    if (mode === 'hash') return commit.hash.toLowerCase().startsWith(query);
                    if (mode === 'author') {
                        return commit.author_name.toLowerCase().includes(query)
                            || commit.author_email.toLowerCase().includes(query);
                    }
                    return commit.message.toLowerCase().includes(query);
                });
                callback?.({
                    success: true,
                    request_id: requestId,
                    commits: matches.slice(offset, offset + limit),
                    has_more: offset + limit < matches.length,
                });
                break;
            }

            case 'git:history-search-cancel': {
                callback?.({
                    success: true,
                    cancelled: true,
                    request_id: payload?.request_id,
                });
                break;
            }

            case 'git:history-files': {
                const files = DEMO_HISTORY_FILES[String(payload?.hash ?? '')] || [];
                callback?.({
                    success: true,
                    files,
                });
                break;
            }

            case 'git:history-file': {
                const targetPath = payload?.path || '';
                const historyFile = DEMO_HISTORY_FILES[String(payload?.hash ?? '')]
                    ?.find((file) => file.path === targetPath);
                const baseContent = ORIGINAL_VFS_CONTENTS[targetPath] ?? `// File: ${targetPath}\nfunction process_${targetPath.replace(/[^a-zA-Z0-9]/g, '_')}() {\n  return "ok";\n}\n`;
                const logs = Array.from({ length: 25 }, (_, i) => `    console.log("processing item index ${i}:", ${i});`).join('\n');
                const generatedNewContent = `// File: ${targetPath}\n// Generated demo log pipeline\nexport function runDemoPipeline() {\nfor (let i = 0; i < 25; i++) {\n${logs}\n  }\n}\n\n${baseContent}`;
                const generatedOldContent = `// File: ${targetPath}\n// Initial demo file\n${baseContent}`;

                callback?.({
                    success: true,
                    old_content: historyFile?.status === 'added' ? '' : generatedOldContent,
                    new_content: historyFile?.status === 'deleted' ? '' : generatedNewContent,
                    old_binary: false,
                    new_binary: false,
                });
                break;
            }

            case 'git:stage': {
                const targetPath = payload?.path;
                if (targetPath && DEMO_CHANGED_FILES.has(targetPath)) {
                    DEMO_CHANGED_FILES.get(targetPath)!.staged = true;
                    notifyGitChange(this, targetPath);
                }
                callback?.({ success: true });
                break;
            }

            case 'git:unstage': {
                const targetPath = payload?.path;
                if (targetPath && DEMO_CHANGED_FILES.has(targetPath)) {
                    DEMO_CHANGED_FILES.get(targetPath)!.staged = false;
                    notifyGitChange(this, targetPath);
                }
                callback?.({ success: true });
                break;
            }

            case 'git:revert': {
                const targetPath = payload?.path;
                if (targetPath && ORIGINAL_VFS_CONTENTS[targetPath] !== undefined) {
                    DEMO_VFS[targetPath].content = ORIGINAL_VFS_CONTENTS[targetPath];
                    delete DEMO_VFS[targetPath].code;
                    DEMO_CHANGED_FILES.delete(targetPath);
                    notifyGitChange(this, targetPath);
                }
                callback?.({ success: true });
                break;
            }

            case 'git:commit': {
                const changedFiles = Array.from(DEMO_CHANGED_FILES.values());
                const message = String(payload?.message ?? '').trim() || 'Update demo files';
                if (changedFiles.length > 0) {
                    const hash = `de${String(demoCommitSequence++).padStart(38, '0')}`;
                    DEMO_HISTORY_COMMITS.unshift({
                        hash,
                        parents: [DEMO_HISTORY_COMMITS[0]?.hash ?? ''],
                        summary: message,
                        message,
                        author_name: 'You',
                        author_email: 'demo@anycode.dev',
                        timestamp: Math.floor(Date.now() / 1000),
                        timezone_offset: 0,
                    });
                    DEMO_HISTORY_FILES[hash] = changedFiles.map((file) => ({
                        path: file.path,
                        status: file.status,
                        added: file.status === 'deleted' ? 0 : 1,
                        removed: file.status === 'added' ? 0 : 1,
                        binary: false,
                    }));
                }
                DEMO_CHANGED_FILES.forEach((_, path) => {
                    if (DEMO_VFS[path]) {
                        ORIGINAL_VFS_CONTENTS[path] = getNodeContent(DEMO_VFS[path]);
                    }
                });
                DEMO_CHANGED_FILES.clear();
                this.emitLocal('git:update', { kind: 'full', project_id: DEMO_PROJECT_ID, branch: 'main', files: [] });
                callback?.({ success: true });
                break;
            }

            case 'git:push':
            case 'git:pull': {
                callback?.({ success: true, status: 'up_to_date' });
                break;
            }

            case 'theme:list': {
                callback?.(THEME_LIST);
                break;
            }

            case 'theme:get': {
                const reqFileName = payload?.fileName || 'anycode.json';
                const reqThemeName = payload?.themeName || 'anycode';

                const themeFile = THEME_FILES_MAP[reqFileName] || Object.values(THEME_FILES_MAP)[0];
                const themeDef = themeFile?.themes?.find((t: any) => t.name === reqThemeName)
                              || themeFile?.themes?.[0];

                if (themeDef) {
                    callback?.({
                        success: true,
                        theme: themeDef,
                    });
                } else {
                    callback?.({ success: false, error: 'Theme not found' });
                }
                break;
            }

            case 'terminal:start':
            case 'terminal:reconnect':
            case 'terminal:create': {
                const termName = payload?.name || payload?.terminal_id || 'terminal-1';
                callback?.({ status: 'ok', success: true, terminal_id: termName });

                const promptPath = this.terminalCurrentDir === '.' ? 'anycode-demo' : `anycode-demo/${this.terminalCurrentDir}`;
                const banner = `\r\n\x1b[1;32mWelcome to Anycode Live Demo Terminal!\x1b[0m\r\n\x1b[33mNote: This is an in-memory VFS sandbox, not a real OS filesystem.\x1b[0m\r\n\x1b[90m(For real bash/zsh PTY processes, download and run Anycode locally)\x1b[0m\r\n\r\n\x1b[1;34m${promptPath}\x1b[0m $ `;

                const channel = terminalDataChannel(payload);
                setTimeout(() => this.emitLocal(channel, banner), 50);
                break;
            }

            case 'terminal:input': {
                const inputData = payload?.input ?? payload?.data ?? '';
                const channel = terminalDataChannel(payload);

                const emitData = (str: string) => this.emitLocal(channel, str);

                if (inputData === '\r' || inputData === '\n') {
                    const cmd = this.terminalBuffer.trim();
                    this.terminalBuffer = '';
                    let response = '\r\n';

                    const resolveVfsPath = (relPath: string) => {
                        const clean = relPath.replace(/^\.\//, '').replace(/\/$/, '');
                        if (this.terminalCurrentDir === '.') return clean;
                        return clean ? `${this.terminalCurrentDir}/${clean}` : this.terminalCurrentDir;
                    };

                    if (cmd === 'help') {
                        response += '\x1b[33mNote: This is an in-memory VFS sandbox, not a real OS filesystem.\x1b[0m\r\n\x1b[36mAvailable demo commands:\x1b[0m\r\n  cd <dir>   Change directory (cd .. to go up)\r\n  ls [dir]   List VFS workspace files\r\n  cat <file> Display file content\r\n  clear      Clear terminal screen\r\n  pwd        Print working directory\r\n  whoami     Print current user\r\n  help       Show this help message\r\n';
                    } else if (cmd === 'cd' || cmd === 'cd ~' || cmd === 'cd /' || cmd === 'cd /workspace/anycode-demo') {
                        this.terminalCurrentDir = '.';
                    } else if (cmd.startsWith('cd ')) {
                        const targetDir = cmd.slice(3).trim().replace(/^\.\//, '').replace(/\/$/, '');
                        if (targetDir === '..' || targetDir === '../') {
                            if (this.terminalCurrentDir !== '.') {
                                const parts = this.terminalCurrentDir.split('/');
                                parts.pop();
                                this.terminalCurrentDir = parts.length > 0 ? parts.join('/') : '.';
                            }
                        } else if (targetDir === '.' || targetDir === '') {
                            // Stay in current directory
                        } else {
                            const fullTargetPath = resolveVfsPath(targetDir);
                            const node = DEMO_VFS[fullTargetPath];
                            if (node && node.is_dir) {
                                this.terminalCurrentDir = fullTargetPath;
                            } else if (DEMO_VFS[targetDir] && DEMO_VFS[targetDir].is_dir) {
                                this.terminalCurrentDir = targetDir;
                            } else {
                                response += `cd: no such file or directory: ${targetDir}\r\n`;
                            }
                        }
                    } else if (cmd === 'pwd') {
                        const fullPwd = this.terminalCurrentDir === '.' ? '/workspace/anycode-demo' : `/workspace/anycode-demo/${this.terminalCurrentDir}`;
                        response += `${fullPwd}\r\n`;
                    } else if (cmd === 'ls' || cmd.startsWith('ls ')) {
                        const curDir = this.terminalCurrentDir;
                        const prefix = curDir === '.' ? '' : `${curDir}/`;

                        const items: string[] = [];
                        Object.values(DEMO_VFS).forEach((node) => {
                            if (node.path === '.' || node.path === curDir) return;
                            if (prefix === '') {
                                if (!node.path.includes('/')) {
                                    items.push(node.is_dir ? `\x1b[1;34m${node.name}/\x1b[0m` : node.name);
                                }
                            } else if (node.path.startsWith(prefix)) {
                                const rest = node.path.slice(prefix.length);
                                if (!rest.includes('/')) {
                                    items.push(node.is_dir ? `\x1b[1;34m${node.name}/\x1b[0m` : node.name);
                                }
                            }
                        });
                        response += (items.join('  ') || 'No files found') + '\r\n';
                    } else if (cmd.startsWith('cat ')) {
                        const target = cmd.slice(4).trim();
                        const targetPath = resolveVfsPath(target);
                        const fileNode = DEMO_VFS[targetPath] || DEMO_VFS[target];
                        if (fileNode && !fileNode.is_dir && typeof fileNode.content === 'string') {
                            response += fileNode.content.replace(/\n/g, '\r\n') + '\r\n';
                        } else if (fileNode?.is_dir) {
                            response += `cat: ${target}: Is a directory\r\n`;
                        } else {
                            response += `cat: ${target}: No such file or directory\r\n`;
                        }
                    } else if (cmd === 'whoami') {
                        response += 'developer\r\n';
                    } else if (cmd === 'clear') {
                        response = '\x1b[2J\x1b[H';
                    } else if (cmd.length > 0) {
                        response += `\x1b[31manycode-demo: command not found: ${cmd}\x1b[0m (Run 'help' or download Anycode for full PTY bash/zsh)\r\n`;
                    }

                    const promptPath = this.terminalCurrentDir === '.' ? 'anycode-demo' : `anycode-demo/${this.terminalCurrentDir}`;
                    response += `\x1b[1;34m${promptPath}\x1b[0m $ `;
                    emitData(response);
                } else if (inputData === '\x7f' || inputData === '\b') {
                    if (this.terminalBuffer.length > 0) {
                        this.terminalBuffer = this.terminalBuffer.slice(0, -1);
                        emitData('\b \b');
                    }
                } else if (inputData === '\x03') { // Ctrl + C
                    this.terminalBuffer = '';
                    const promptPath = this.terminalCurrentDir === '.' ? 'anycode-demo' : `anycode-demo/${this.terminalCurrentDir}`;
                    emitData(`^C\r\n\x1b[1;34m${promptPath}\x1b[0m $ `);
                } else {
                    this.terminalBuffer += inputData;
                    emitData(inputData);
                }

                callback?.({ status: 'ok', success: true });
                break;
            }

            case 'terminal:resize':
            case 'terminal:close': {
                callback?.({ status: 'ok', success: true });
                break;
            }

            case 'search:start': {
                const pattern = (payload?.pattern || payload?.query || '').toLowerCase();
                const searchResults: any[] = [];
                let totalMatches = 0;

                if (pattern) {
                    Object.values(DEMO_VFS).forEach((node) => {
                        if (!node.is_dir && typeof node.content === 'string') {
                            const lines = node.content.split('\n');
                            const fileMatches: any[] = [];

                            lines.forEach((lineText, idx) => {
                                const lowerLine = lineText.toLowerCase();
                                const colIndex = lowerLine.indexOf(pattern);
                                if (colIndex !== -1) {
                                    fileMatches.push({
                                        line: idx,
                                        column: colIndex,
                                        preview: lineText,
                                    });
                                    totalMatches++;
                                }
                            });

                            if (fileMatches.length > 0) {
                                searchResults.push({
                                    file_path: node.path,
                                    display_path: node.path,
                                    matches: fileMatches,
                                });
                            }
                        }
                    });
                }

                setTimeout(() => {
                    this.emitLocal('search:results', { results: searchResults });
                    this.emitLocal('search:end', { elapsed: 0.05, matches: totalMatches });
                }, 50);
                break;
            }

            case 'search:files:start': {
                const rawQuery = payload?.query || payload?.pattern || '';
                const query = rawQuery.toLowerCase();
                const requestId = payload?.request_id;
                const fileResults: any[] = [];

                if (query) {
                    Object.values(DEMO_VFS).forEach((node) => {
                        if (!node.is_dir && (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query))) {
                            fileResults.push({
                                name: node.name,
                                path: node.path,
                                display_path: node.path,
                                type: 'file',
                            });
                        }
                    });
                }

                setTimeout(() => {
                    this.emitLocal('search:files:results', {
                        query: rawQuery,
                        request_id: requestId,
                        results: fileResults,
                    });
                    this.emitLocal('search:files:end', {
                        query: rawQuery,
                        request_id: requestId,
                    });
                }, 50);
                break;
            }

            case 'acp:start': {
                const agentId = payload?.agent_id || 'demo-agent-1';
                const agentName = payload?.agent_name || payload?.name || 'AI Agent';
                this.agentNames.set(agentId, agentName);

                const sessionId = payload?.resume_session_id || `session-${agentId}`;
                this.runningAgents.set(agentId, {
                    id: agentId,
                    name: agentName,
                    session_id: sessionId,
                    project_id: payload?.project_id ?? null,
                });
                callback?.({
                    status: 'ok',
                    success: true,
                    agent_id: agentId,
                    session_id: sessionId,
                });
                if (payload?.resume_session_id === DEMO_RESUME_SESSION_ID) {
                    // Like the backend: a resumed session replays its stored history after the start ack.
                    setTimeout(() => {
                        this.emitLocal('acp:history', { agent_id: agentId, history: buildDemoResumeHistory() });
                    }, 0);
                }
                break;
            }

            case 'acp:sessions_list': {
                callback?.({
                    status: 'ok',
                    success: true,
                    sessions: [
                        {
                            session_id: 'session-demo-1',
                            cwd: '/workspace/anycode-demo',
                            title: 'Demo AI Agent Session',
                            updated_at: Date.now() - 3600000,
                        },
                    ],
                });
                break;
            }

            case 'acp:queue:update':
            case 'acp:queue:remove':
            case 'acp:queue:move':
            case 'acp:queue:send_now': {
                callback?.({ success: true });
                break;
            }

            case 'acp:prompt': {
                const agentId = payload?.agent_id || 'demo-agent-1';
                const agentName = this.agentNames.get(agentId) || 'AI Agent';
                const userPrompt = payload?.prompt || '';
                const lowerPrompt = userPrompt.toLowerCase();
                const toolCallId = `tool-${Date.now()}`;
                const promptId = `demo-queue-${Date.now()}`;

                callback?.({ status: 'ok', success: true, id: promptId });

                let toolName = 'read_file';
                let toolCmd = 'read_file demo.py';
                let toolTitle = `[${agentName}] Reading workspace file demo.py`;
                let toolOutput = 'Read 238 bytes from demo.py';
                let toolFormatted = 'def greet(name: str) -> str:\n    return f"Hello, {name}! Welcome to Anycode Live Demo."';
                let responseChunks: string[] = [];

                const rootVfsEntries = Object.keys(DEMO_VFS)
                    .filter((k) => k !== '.' && !k.includes('/'))
                    .map((k) => DEMO_VFS[k]);

                const formattedEntries = rootVfsEntries
                    .map((node) => {
                        const icon = node.is_dir ? '📂' : node.name.endsWith('.py') ? '🐍' : node.name.endsWith('.md') ? '📄' : node.name.endsWith('.ts') || node.name.endsWith('.tsx') ? '⚛️' : '📜';
                        const desc = node.is_dir ? ' (directory)' : typeof node.content === 'string' ? ` (${node.content.length} B)` : '';
                        return `- ${icon} \`${node.name}\`${desc}`;
                    })
                    .join('\n');

                const toolEntriesFormatted = rootVfsEntries
                    .map((node) => {
                        const size = node.is_dir ? 'dir' : typeof node.content === 'string' ? `${node.content.length} B` : '0 B';
                        return `${node.name} (${size})`;
                    })
                    .join('\n');

                if (
                    lowerPrompt.includes('привет') ||
                    lowerPrompt.includes('здорово') ||
                    lowerPrompt.includes('здорова') ||
                    lowerPrompt.includes('hello') ||
                    lowerPrompt.includes('hi')
                ) {
                    toolName = 'list_dir';
                    toolCmd = 'list_dir /workspace/anycode-demo';
                    toolTitle = `[${agentName}] Scanning workspace root directory`;
                    toolOutput = `Found ${rootVfsEntries.length} entries in workspace root`;
                    toolFormatted = toolEntriesFormatted;
                    responseChunks = [
                        `Hello! 👋 I am **${agentName}** running in **Demo Mode**!\n\n`,
                        `Scanned your workspace root directory (${rootVfsEntries.length} entries):\n\n`,
                        `${formattedEntries}\n\n`,
                        'Feel free to ask questions, search files, or test the VFS terminal shell!\n\n',
                        `> ℹ️ **Demo Mode Notice**: This is a demo ${agentName} response. For real AI capabilities and full code generation, download and run Anycode locally on your machine.`,
                    ];
                } else if (
                    lowerPrompt.includes('поиск') ||
                    lowerPrompt.includes('search') ||
                    lowerPrompt.includes('find') ||
                    lowerPrompt.includes('где')
                ) {
                    toolName = 'search_files';
                    toolCmd = `search_files "${userPrompt.slice(0, 20)}"`;
                    toolTitle = `[${agentName}] Searching workspace for "${userPrompt.slice(0, 20)}"`;

                    const matchingVfs = Object.values(DEMO_VFS).filter(
                        (node) => !node.is_dir && typeof node.content === 'string' && node.content.toLowerCase().includes(lowerPrompt)
                    );
                    toolOutput = `Found ${matchingVfs.length || 2} matching files`;
                    toolFormatted = matchingVfs.length > 0
                        ? matchingVfs.map((n) => `${n.path}: line 1: match`).join('\n')
                        : 'demo.py: line 5: print(msg)\nsrc/App.tsx: line 12: <Editor />';

                    const searchMatchesText = matchingVfs.length > 0
                        ? matchingVfs.map((node, i) => `${i + 1}. 📄 **\`${node.path}\`** — VFS file match`).join('\n')
                        : '1. 📄 **`demo.py`** — match in function `greet()`\n2. 📄 **`src/App.tsx`** — main application component';

                    responseChunks = [
                        `[${agentName}] Searched workspace for **"${userPrompt}"** across VFS files:\n\n`,
                        `${searchMatchesText}\n\n`,
                        'Click on any file in the left sidebar tree to open it in the editor!\n\n',
                        `> ℹ️ **Demo Mode Notice**: This is a demo ${agentName} response. For real AI capabilities and full code generation, download and run Anycode locally on your machine.`,
                    ];
                } else if (
                    lowerPrompt.includes('код') ||
                    lowerPrompt.includes('правк') ||
                    lowerPrompt.includes('исправ') ||
                    lowerPrompt.includes('edit') ||
                    lowerPrompt.includes('fix') ||
                    lowerPrompt.includes('refactor') ||
                    lowerPrompt.includes('создай') ||
                    lowerPrompt.includes('напиши')
                ) {
                    toolName = 'apply_diff';
                    toolCmd = 'apply_diff demo.py';
                    toolTitle = `[${agentName}] Updating demo.py with improvements`;
                    toolOutput = 'Applied 1 diff block to demo.py';
                    toolFormatted = '@@ -1,5 +1,7 @@\n def greet(name: str) -> str:\n-    return f"Hello, {name}!"\n+    # Added type validation & formatted message\n+    return f"Hello, {name}! Welcome to Anycode Live Demo."';
                    responseChunks = [
                        `[${agentName}] Analyzed your code change request: **"${userPrompt}"**.\n\n`,
                        'Generated code diff update for `demo.py`:\n\n',
                        '```python\n',
                        'def greet(name: str, status: str = "active") -> str:\n',
                        '    """Enhanced greeting function with status indicator."""\n',
                        `    return f"[${agentName}] Hello, {name}! Status: {status}"\n`,
                        '```\n\n',
                        'You can edit `demo.py` directly in the web editor on the left!\n\n',
                        `> ℹ️ **Demo Mode Notice**: This is a demo ${agentName} response. For real AI capabilities and full code generation, download and run Anycode locally on your machine.`,
                    ];
                } else {
                    toolName = 'read_file';
                    toolCmd = 'read_file README.md';
                    toolTitle = `[${agentName}] Reading README.md for context`;
                    toolOutput = 'Read 182 bytes from README.md';
                    toolFormatted = '# Anycode Web IDE\nNext-generation IDE with Rust backend & React frontend.';
                    responseChunks = [
                        `[${agentName}] Response for your query: **"${userPrompt}"**\n\n`,
                        'I inspected the VFS project context in your browser sandbox.\n\n',
                        '- 💡 **Editor**: Custom virtual rendering engine powered by Tree-Sitter WASM.\n',
                        '- ⚡ **Terminal**: Built-in VFS interactive shell supporting `cd`, `ls`, `cat`, `pwd`, and `clear`.\n',
                        '- 🎨 **Themes**: 27 dynamic color themes from VSCode & JetBrains.\n\n',
                        `> ℹ️ **Demo Mode Notice**: This is a demo ${agentName} response. For real AI capabilities and full code generation, download and run Anycode locally on your machine.`,
                    ];
                }

                // Step 1: User message & processing state
                setTimeout(() => {
                    this.emitLocal('acp:message', {
                        agent_id: agentId,
                        item: { role: 'prompt_state', is_processing: true },
                    });

                    this.emitLocal('acp:message', {
                        agent_id: agentId,
                        item: { id: `user-${Date.now()}`, role: 'user', content: userPrompt },
                    });
                }, 50);

                // Step 2: Thought reasoning block
                setTimeout(() => {
                    this.emitLocal('acp:message', {
                        agent_id: agentId,
                        item: {
                            id: `thought-${Date.now()}`,
                            role: 'thought',
                            content: `Analyzing workspace VFS files for user request: "${userPrompt}"...\n`,
                            is_chunk: true,
                        },
                    });
                }, 200);

                const isEditTool = toolName === 'apply_diff';
                const diffContent = isEditTool ? [
                    {
                        type: 'diff',
                        path: 'demo.py',
                        oldText: 'def greet(name: str) -> str:\n    """Return a greeting message."""\n    return f"Hello, {name}! Welcome to Anycode Live Demo."',
                        newText: `def greet(name: str, status: str = "active") -> str:\n    """Enhanced greeting function with status indicator."""\n    # Added status indicator\n    return f"[${agentName}] Hello, {name}! Status: {status}"`,
                    },
                ] : undefined;

                // Step 3: Tool call step
                setTimeout(() => {
                    this.emitLocal('acp:message', {
                        agent_id: agentId,
                        item: {
                            id: toolCallId,
                            role: 'tool_call',
                            name: toolName,
                            command: toolCmd,
                            title: toolTitle,
                            status: 'running',
                            kind: isEditTool ? 'edit' : undefined,
                            content: diffContent,
                            arguments: { prompt: userPrompt },
                        },
                    });
                }, 400);

                // Step 4: Tool call result & Assistant response stream
                setTimeout(() => {
                    this.emitLocal('acp:message', {
                        agent_id: agentId,
                        item: {
                            id: toolCallId,
                            role: 'tool_result',
                            result: {
                                command: toolCmd,
                                output: toolOutput,
                                formatted_output: toolFormatted,
                                kind: isEditTool ? 'edit' : undefined,
                                content: diffContent,
                            },
                        },
                    });

                    responseChunks.forEach((chunk, idx) => {
                        setTimeout(() => {
                            this.emitLocal('acp:message', {
                                agent_id: agentId,
                                item: {
                                    id: `assistant-${Date.now()}`,
                                    role: 'assistant',
                                    content: chunk,
                                    is_chunk: true,
                                },
                            });
                        }, idx * 80);
                    });
                }, 650);

                // Step 5: Finish processing state
                setTimeout(() => {
                    this.emitLocal('acp:message', {
                        agent_id: agentId,
                        item: { role: 'prompt_state', is_processing: false },
                    });
                }, 1400);
                break;
            }

            case 'acp:stop': {
                this.runningAgents.delete(payload?.agent_id);
                callback?.({ status: 'ok', success: true });
                break;
            }

            case 'acp:reconnect': {
                // Like the backend: report running agents so the client keeps their sessions.
                callback?.({ status: 'ok', success: true, agents: [...this.runningAgents.values()] });
                break;
            }

            case 'acp:cancel':
            case 'acp:undo':
            case 'acp:set_model':
            case 'acp:set_reasoning': {
                callback?.({ status: 'ok', success: true });
                break;
            }

            case 'lsp:completion': {
                const targetFile = payload?.file || '';
                const completions: any[] = [
                    {
                        label: 'ℹ️ Demo Mode — Download Anycode for real LSP',
                        insertText: '',
                        detail: 'Demo autocompletion notice',
                        kind: 1,
                    },
                ];

                if (targetFile.endsWith('.py')) {
                    completions.push(
                        { label: 'greet (demo)', insertText: 'greet', detail: 'def greet(name: str) -> str', kind: 3 },
                        { label: 'print (demo)', insertText: 'print', detail: 'print(*values, sep=" ", end="\\n")', kind: 3 },
                        { label: 'len (demo)', insertText: 'len', detail: 'len(obj) -> int', kind: 3 },
                        { label: 'range (demo)', insertText: 'range', detail: 'range(stop) -> range', kind: 3 },
                        { label: 'str (demo)', insertText: 'str', detail: 'str(object="") -> str', kind: 6 },
                        { label: 'int (demo)', insertText: 'int', detail: 'int(x=0) -> int', kind: 6 },
                        { label: 'list (demo)', insertText: 'list', detail: 'list(iterable=()) -> list', kind: 6 },
                        { label: 'dict (demo)', insertText: 'dict', detail: 'dict() -> new empty dictionary', kind: 6 },
                        { label: '__name__ (demo)', insertText: '__name__', detail: 'str', kind: 5 }
                    );
                } else if (targetFile.endsWith('.rs')) {
                    completions.push(
                        { label: 'println! (demo)', insertText: 'println!', detail: 'macro_rules! println', kind: 3 },
                        { label: 'vec! (demo)', insertText: 'vec!', detail: 'macro_rules! vec', kind: 3 },
                        { label: 'main (demo)', insertText: 'main', detail: 'fn main()', kind: 3 },
                        { label: 'String (demo)', insertText: 'String', detail: 'struct String', kind: 6 },
                        { label: 'Vec (demo)', insertText: 'Vec', detail: 'struct Vec<T>', kind: 6 },
                        { label: 'Option (demo)', insertText: 'Option', detail: 'enum Option<T>', kind: 6 },
                        { label: 'Result (demo)', insertText: 'Result', detail: 'enum Result<T, E>', kind: 6 },
                        { label: 'iter (demo)', insertText: 'iter', detail: 'fn iter(&self)', kind: 2 }
                    );
                } else if (targetFile.endsWith('.tsx') || targetFile.endsWith('.ts') || targetFile.endsWith('.jsx') || targetFile.endsWith('.js')) {
                    completions.push(
                        { label: 'useState (demo)', insertText: 'useState', detail: 'function useState<S>(...)', kind: 3 },
                        { label: 'useEffect (demo)', insertText: 'useEffect', detail: 'function useEffect(...)', kind: 3 },
                        { label: 'useCallback (demo)', insertText: 'useCallback', detail: 'function useCallback(...)', kind: 3 },
                        { label: 'useMemo (demo)', insertText: 'useMemo', detail: 'function useMemo(...)', kind: 3 },
                        { label: 'React (demo)', insertText: 'React', detail: 'const React: typeof import("react")', kind: 5 },
                        { label: 'console.log (demo)', insertText: 'console.log', detail: 'console.log(...data: any[])', kind: 3 }
                    );
                } else {
                    completions.push(
                        { label: 'Anycode (demo)', insertText: 'Anycode', detail: 'High-performance IDE', kind: 1 },
                        { label: 'Tree-Sitter (demo)', insertText: 'Tree-Sitter', detail: 'Parser & Syntax highlighter', kind: 1 },
                        { label: 'WebAssembly (demo)', insertText: 'WebAssembly', detail: 'WASM Runtime', kind: 1 }
                    );
                }

                callback?.(completions);
                break;
            }

            case 'lsp:hover': {
                callback?.({
                    status: 'ok',
                    success: true,
                    contents: ['**Demo LSP Hover Signature**\n\n`def greet(name: str) -> str`'],
                });
                break;
            }

            case 'lsp:references': {
                const rawPath = payload?.file || payload?.uri || 'demo.py';
                const node = Object.values(DEMO_VFS).find(
                    (n) => n.path === rawPath || n.name === rawPath || n.path.endsWith(`/${rawPath}`)
                ) || DEMO_VFS['src/main.rs'] || DEMO_VFS['demo.py'];

                const filePath = node.path;
                const lines = typeof node.content === 'string' ? node.content.split('\n') : [];
                const line1Text = lines[0] || 'fn main() {';
                const line2Text = lines.length > 1 ? lines[1] : line1Text;

                callback?.({
                    status: 'ok',
                    success: true,
                    items: [
                        {
                            file: filePath,
                            uri: filePath,
                            containerName: node.name,
                            lineText: line1Text,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: Math.max(1, line1Text.length) },
                            },
                        },
                        {
                            file: filePath,
                            uri: filePath,
                            containerName: node.name,
                            lineText: line2Text,
                            range: {
                                start: { line: Math.min(1, lines.length - 1), character: 0 },
                                end: { line: Math.min(1, lines.length - 1), character: Math.max(1, line2Text.length) },
                            },
                        },
                    ],
                });
                break;
            }

            case 'lsp:definition': {
                const rawPath = payload?.file || payload?.uri || 'demo.py';
                const node = Object.values(DEMO_VFS).find(
                    (n) => n.path === rawPath || n.name === rawPath || n.path.endsWith(`/${rawPath}`)
                ) || DEMO_VFS['src/main.rs'] || DEMO_VFS['demo.py'];

                callback?.([
                    {
                        file: node.path,
                        uri: node.path,
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 5 },
                        },
                    },
                ]);
                break;
            }

            default: {
                // Universal catch-all response
                if (callback) {
                    callback({ status: 'ok', success: true, data: [], items: [] });
                }
                break;
            }
        }
    }

    private getWorktreesForProject(serverId: string, projectId?: string | null): RemoteWorktreeEntry[] {
        const key = `${serverId}::${projectId || ''}`;
        if (!this.remoteWorktrees.has(key)) {
            this.remoteWorktrees.set(key, []);
        }
        return this.remoteWorktrees.get(key)!;
    }

    private getConfiguredAgents(serverId: string): AcpAgent[] {
        if (!this.remoteConfiguredAgents.has(serverId)) {
            this.remoteConfiguredAgents.set(serverId, [...DEFAULT_REMOTE_CONFIGURED_AGENTS]);
        }
        return this.remoteConfiguredAgents.get(serverId)!;
    }

    private getRegistryAgents(serverId: string): AcpRegistryAgentSummary[] {
        if (!this.remoteRegistryAgents.has(serverId)) {
            this.remoteRegistryAgents.set(serverId, [...DEFAULT_REMOTE_REGISTRY_AGENTS]);
        }
        return this.remoteRegistryAgents.get(serverId)!;
    }

    private handleRemoteServersAdd(payload: any, callback: ((res: any) => void) | null): void {
        const url = (payload?.url || '').trim();
        const name = (payload?.name || '').trim() || url.replace(/^https?:\/\//, '').split(/[:/]/)[0] || 'remote-node';
        if (!url) {
            callback?.({ success: false, error: 'Server URL is required' });
            return;
        }
        if (!/^https?:\/\//i.test(url)) {
            callback?.({ success: false, error: 'Server URL must start with http:// or https://' });
            return;
        }

        const id = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        let status: 'online' | 'offline' | 'auth_error' = 'online';
        let error: string | null = null;
        let ping_ms: number | null = 22;

        if (url.includes('offline') || url.includes('unreachable')) {
            status = 'offline';
            error = 'Connection refused (host unreachable)';
            ping_ms = null;
        } else if (url.includes('bad-token') || url.includes('auth-error') || payload?.token === 'invalid') {
            status = 'auth_error';
            error = 'Authentication failed: invalid token';
            ping_ms = null;
        }

        const newServer: RemoteServerView = {
            id,
            name,
            url,
            open_url: url,
            is_local: false,
            status,
            error,
            ping_ms,
            info: status === 'online' ? {
                name,
                os: 'linux',
                arch: 'x86_64',
                version: '0.1.0',
            } : null,
            projects: status === 'online' ? [
                {
                    id: `proj-${id}-1`,
                    name: `${name}-work`,
                    root: `/home/ubuntu/${name}-work`,
                },
            ] : [],
            agents: [],
        };

        this.remoteServers.push(newServer);
        this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
        callback?.({ success: true, server: newServer });
    }

    private handleRemoteServersRemove(payload: any, callback: ((res: any) => void) | null): void {
        const serverId = payload?.server_id;
        const index = this.remoteServers.findIndex((s) => s.id === serverId);
        if (index !== -1) {
            this.remoteServers.splice(index, 1);
            this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
            callback?.({ success: true });
        } else {
            callback?.({ success: false, error: `Server ${serverId} not found` });
        }
    }

    private handleRemoteServersReconnect(payload: any, callback: ((res: any) => void) | null): void {
        const serverId = payload?.server_id;
        const srv = this.remoteServers.find((s) => s.id === serverId);
        if (srv) {
            srv.status = 'connecting';
            srv.error = null;
            this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
            setTimeout(() => {
                srv.status = 'online';
                srv.ping_ms = 19;
                srv.error = null;
                if (!srv.info) {
                    srv.info = {
                        name: srv.name,
                        os: 'linux',
                        arch: 'x86_64',
                        version: '0.1.0',
                    };
                }
                this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
            }, 60);
            callback?.({ success: true });
        } else {
            callback?.({ success: false, error: `Server ${serverId} not found` });
        }
    }

    private runRemoteAgentPrompt(serverId: string, agent: NodeAgentSummary, prompt: string, attachments: any[]): void {
        const server = this.remoteServers.find((s) => s.id === serverId);
        agent.is_processing = true;
        this.emitLocal('remote:acp:message', {
            server_id: serverId,
            agent_id: agent.id,
            item: { role: 'prompt_state', is_processing: true },
        });

        const chunks = [
            `I am **${agent.name}** on remote node **${server?.name || serverId}**.\n\n`,
            `Processing task: "${prompt}".\n\n`,
            `Verified environment on ${server?.info?.os || 'linux'} (${server?.info?.arch || 'x86_64'}). Everything is operational!\n\n`,
            `> ℹ️ **Demo Mode Notice**: Remote agent responded successfully.`,
        ];

        const timerKey = `${serverId}::${agent.id}`;
        const timers: ReturnType<typeof setTimeout>[] = [];
        this.remotePromptTimers.set(timerKey, timers);

        chunks.forEach((chunk, index) => {
            const t = setTimeout(() => {
                this.emitLocal('remote:acp:message', {
                    server_id: serverId,
                    agent_id: agent.id,
                    item: { role: 'assistant', content: chunk, is_chunk: true },
                });
            }, (index + 1) * 120);
            timers.push(t);
        });

        const finishTimer = setTimeout(() => {
            if (agent.worktree_path) {
                agent.diff_added = (agent.diff_added ?? 0) + 4;
                agent.diff_removed = (agent.diff_removed ?? 0) + 1;
                agent.diff_files = Math.max(1, agent.diff_files ?? 1);
                this.emitLocal('remote:acp:diff_stats', {
                    server_id: serverId,
                    agent_id: agent.id,
                    worktree_path: agent.worktree_path,
                    diff_added: agent.diff_added,
                    diff_removed: agent.diff_removed,
                    diff_files: agent.diff_files,
                });
            }

            this.emitLocal('remote:acp:message', {
                server_id: serverId,
                agent_id: agent.id,
                item: { role: 'prompt_state', is_processing: false },
            });
            agent.is_processing = false;
            this.remotePromptTimers.delete(timerKey);

            if (agent.queue.length > 0) {
                const next = agent.queue.shift()!;
                this.emitLocal('remote:acp:queue', {
                    server_id: serverId,
                    agent_id: agent.id,
                    queue: [...agent.queue],
                });
                setTimeout(() => {
                    this.runRemoteAgentPrompt(serverId, agent, next.prompt, next.attachments || []);
                }, 20);
            }
        }, (chunks.length + 1) * 120);
        timers.push(finishTimer);
    }

    private handleRemoteRpc(payload: any, callback: ((res: any) => void) | null): void {
        const { server_id, method, params } = payload || {};
        const server = this.remoteServers.find((s) => s.id === server_id);
        if (!server && method !== 'workspace:browse') {
            callback?.({ success: false, error: `Server ${server_id} not found` });
            return;
        }

        switch (method) {
            case 'workspace:browse': {
                const reqPath = params?.path || '/home/ubuntu';
                const normPath = reqPath.replace(/\/$/, '') || '/';
                const name = normPath.split('/').filter(Boolean).pop() || 'ubuntu';
                const parent = normPath === '/' ? null : normPath.split('/').slice(0, -1).join('/') || '/';
                const res: RemoteBrowseResponse = {
                    path: normPath,
                    name,
                    parent,
                    directories: [
                        { name: 'gpu-inference', path: `${normPath}/gpu-inference` },
                        { name: 'model-weights', path: `${normPath}/model-weights` },
                        { name: 'experiments', path: `${normPath}/experiments` },
                        { name: 'logs', path: `${normPath}/logs` },
                    ],
                };
                callback?.({ success: true, data: res });
                break;
            }

            case 'workspace:add-project': {
                const reqPath = (params?.path || '').trim();
                const name = reqPath.split('/').filter(Boolean).pop() || 'project';
                const newProj: RemoteProjectInfo = {
                    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name,
                    root: reqPath,
                };
                server!.projects.push(newProj);
                this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
                callback?.({ success: true, data: { project: newProj } });
                break;
            }

            case 'workspace:remove-project': {
                const projectId = params?.project_id;
                server!.projects = server!.projects.filter((p) => p.id !== projectId);
                server!.agents = server!.agents.filter((a) => a.project_id !== projectId);
                this.remoteWorktrees.delete(`${server_id}::${projectId}`);
                this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
                callback?.({ success: true, data: {} });
                break;
            }

            case 'workspace:clone': {
                const url = (params?.url || '').trim();
                const name = (url.split('/').pop() || 'cloned-repo').replace(/\.git$/, '');
                const root = params?.target_dir || `/home/ubuntu/${name}`;
                const newProj: RemoteProjectInfo = {
                    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name,
                    root,
                };
                server!.projects.push(newProj);
                this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
                callback?.({ success: true, data: { project: newProj } });
                break;
            }

            case 'remote:sync_project': {
                const reqPath = (params?.path || '').trim();
                const name = (params?.name || '').trim() || reqPath.split('/').filter(Boolean).pop() || 'synced-project';
                const root = params?.target_dir || `/home/ubuntu/${name}`;
                const newProj: RemoteProjectInfo = {
                    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name,
                    root,
                };
                server!.projects.push(newProj);
                this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
                callback?.({ success: true, data: { project: newProj } });
                break;
            }

            case 'workspace:git-info': {
                const reqPath = params?.path || '';
                const isWt = Boolean(reqPath.includes('-wt-'));
                const res: RemoteGitStateInfo = {
                    is_git_repo: true,
                    is_worktree: isWt,
                    has_commits: true,
                    head_sha: 'd3adb33f00000001',
                    branch: isWt ? (reqPath.split('-wt-')[1] ? `agent/${reqPath.split('-wt-')[1]}` : 'worktree') : 'main',
                    branches: ['main', 'dev', 'agent/fix-cuda-alloc'],
                    dirty_count: 1,
                    dirty_files: ['src/inference.py'],
                    commits_ahead: 1,
                    commits_summary: ['fix(cuda): optimize tensor allocation'],
                    diff_added: isWt ? 14 : 3,
                    diff_removed: isWt ? 3 : 1,
                    diff_files: isWt ? 2 : 1,
                    sync_meta: {
                        base_sha: '0000000000000000',
                        branch: 'main',
                        source_root: '.',
                        source_name: 'anycode-demo',
                        synced_at_epoch: 1735689600,
                    },
                };
                callback?.({ success: true, data: res });
                break;
            }

            case 'remote:pull_project': {
                const res: PullProjectResult = {
                    success: true,
                    changed: true,
                    worktree_path: `${params?.local_project_path || '.'}-pulled-wt`,
                    branch: params?.branch || 'agent/pulled-branch',
                    project: {
                        id: 'local-pulled',
                        name: 'pulled-worktree',
                        root: `${params?.local_project_path || '.'}-pulled-wt`,
                    },
                    head_sha: '1234567890abcdef',
                    has_wip: false,
                    commits_count: 2,
                    dirty_count: 0,
                    commits_summary: ['feat: updated inference pipeline', 'fix: cuda allocation logic'],
                    dirty_files: [],
                };
                callback?.({ success: true, data: res });
                break;
            }

            case 'workspace:worktree:create': {
                const projectId = params?.project_id;
                const project = server!.projects.find((p) => p.id === projectId);
                const wtNum = Date.now().toString().slice(-4);
                const branchName = params?.branch || `agent/worktree-${wtNum}`;
                const root = project?.root || '/home/ubuntu/workspace';
                const wtPath = `${root}-wt-${wtNum}`;
                const wtEntry: RemoteWorktreeEntry = {
                    id: `wt-${wtNum}`,
                    path: wtPath,
                    branch: branchName,
                    head_sha: 'd3adb33f00000003',
                    short_sha: 'd3adb33',
                    commits_ahead: 0,
                    dirty_count: params?.include_dirty ? 1 : 0,
                    is_dirty: Boolean(params?.include_dirty),
                    base_sha: '0000000000000000',
                    is_main: false,
                    diff_added: 5,
                    diff_removed: 1,
                    diff_files: 1,
                };
                const list = this.getWorktreesForProject(server_id, projectId);
                list.push(wtEntry);

                if (params?.register_in_workspace) {
                    server!.projects.push({
                        id: `proj-wt-${wtNum}`,
                        name: `${project?.name || 'wt'} (${branchName})`,
                        root: wtPath,
                    });
                    this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
                }

                const result: CreateWorktreeResult = {
                    worktree_path: wtPath,
                    branch: branchName,
                    project: project ? { id: project.id, name: project.name, root: project.root } : undefined,
                    already_present: false,
                };
                callback?.({ success: true, data: result });
                break;
            }

            case 'workspace:worktree:list': {
                const projectId = params?.project_id;
                const list = this.getWorktreesForProject(server_id, projectId);
                callback?.({ success: true, data: { worktrees: [...list] } });
                break;
            }

            case 'workspace:worktree:remove': {
                const projectId = params?.project_id;
                const wtPath = params?.worktree_path;
                const list = this.getWorktreesForProject(server_id, projectId);
                const idx = list.findIndex((w) => w.path === wtPath);
                if (idx !== -1) {
                    list.splice(idx, 1);
                }
                callback?.({ success: true, data: { removed: wtPath } });
                break;
            }

            case 'workspace:worktree:diff': {
                const wtPath = params?.worktree_path || '';
                const res: WorktreeDiffResponse = {
                    worktree_path: wtPath,
                    base_sha: '0000000000000000',
                    branch: 'agent/fix-cuda-alloc',
                    added: 14,
                    removed: 3,
                    truncated: false,
                    files: [
                        {
                            path: 'src/inference.py',
                            status: 'modified',
                            added: 10,
                            removed: 2,
                            is_binary: false,
                            hunks: [
                                {
                                    old_start: 1,
                                    new_start: 1,
                                    lines: [
                                        { kind: 'context', text: 'import torch' },
                                        { kind: 'del', text: 'def allocate_memory():' },
                                        { kind: 'del', text: '    return torch.empty(1024)' },
                                        { kind: 'add', text: 'def allocate_memory(device: str = "cuda"):' },
                                        { kind: 'add', text: '    """Allocate CUDA tensor with caching allocator."""' },
                                        { kind: 'add', text: '    if not torch.cuda.is_available():' },
                                        { kind: 'add', text: '        return torch.empty(1024, device="cpu")' },
                                        { kind: 'add', text: '    return torch.empty(1024, device=device)' },
                                        { kind: 'context', text: '' },
                                        { kind: 'context', text: 'def run():' },
                                        { kind: 'add', text: '    tensor = allocate_memory()' },
                                        { kind: 'add', text: '    print(f"Allocated: {tensor.shape}")' },
                                    ],
                                },
                            ],
                        },
                        {
                            path: 'README.md',
                            status: 'modified',
                            added: 4,
                            removed: 1,
                            is_binary: false,
                            hunks: [
                                {
                                    old_start: 5,
                                    new_start: 5,
                                    lines: [
                                        { kind: 'context', text: '## Requirements' },
                                        { kind: 'del', text: '- CUDA 11.8' },
                                        { kind: 'add', text: '- CUDA 12.1+' },
                                        { kind: 'add', text: '- PyTorch 2.2+' },
                                        { kind: 'add', text: '- NCCL enabled' },
                                        { kind: 'add', text: '- 16GB+ VRAM recommended' },
                                    ],
                                },
                            ],
                        },
                    ],
                };
                callback?.({ success: true, data: res });
                break;
            }

            case 'acp:agents:get': {
                callback?.({ success: true, data: { agents: [...this.getConfiguredAgents(server_id)] } });
                break;
            }

            case 'acp:registry:list': {
                callback?.({ success: true, data: { agents: [...this.getRegistryAgents(server_id)] } });
                break;
            }

            case 'acp:registry:install': {
                const agentId = params?.agent_id;
                const regList = this.getRegistryAgents(server_id);
                const regItem = regList.find((r) => r.id === agentId);
                const installed: AcpAgent = {
                    id: agentId,
                    name: regItem?.name || agentId,
                    command: regItem?.binary_target?.cmd || agentId,
                    args: regItem?.binary_target?.args || [],
                    description: regItem?.description,
                };
                const configured = this.getConfiguredAgents(server_id);
                const existingIdx = configured.findIndex((a) => a.id === agentId);
                if (existingIdx !== -1) {
                    configured[existingIdx] = installed;
                } else {
                    configured.push(installed);
                }
                if (regItem) {
                    regItem.is_installed = true;
                    regItem.installed_version = regItem.version;
                    regItem.installed_path = installed.command;
                }
                callback?.({ success: true, data: { preset: installed } });
                break;
            }

            case 'remote:sync_agent': {
                const agentId = params?.agent_id;
                const regItem = this.getRegistryAgents(server_id).find((r) => r.id === agentId);
                const synced: AcpAgent = {
                    id: agentId,
                    name: regItem?.name || agentId,
                    command: regItem?.binary_target?.cmd || agentId,
                    args: regItem?.binary_target?.args || [],
                    description: regItem?.description || 'Synced agent',
                };
                const configured = this.getConfiguredAgents(server_id);
                if (!configured.some((a) => a.id === agentId)) {
                    configured.push(synced);
                }
                callback?.({
                    success: true,
                    data: {
                        agent: synced,
                        agents: [...configured],
                        installed_from_registry: Boolean(regItem),
                    },
                });
                break;
            }

            case 'acp:agent:remove': {
                const agentId = params?.agent_id;
                const configured = this.getConfiguredAgents(server_id);
                const nextList = configured.filter((a) => a.id !== agentId);
                this.remoteConfiguredAgents.set(server_id, nextList);
                callback?.({ success: true, data: { removed: true, agents: nextList } });
                break;
            }

            case 'acp:sessions_list': {
                callback?.({ success: true, data: { sessions: [] } });
                break;
            }

            case 'acp:reconnect': {
                if (server) {
                    for (const agent of server.agents) {
                        if (agent.id === 'claude-1') {
                            this.emitLocal('remote:acp:history', {
                                server_id,
                                agent_id: agent.id,
                                history: [
                                    {
                                        role: 'session_model_selector',
                                        current_value: 'claude-3-7-sonnet',
                                        options: [
                                            { config_id: 'model', value: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet' },
                                            { config_id: 'model', value: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
                                        ],
                                    },
                                    { role: 'user', content: 'Inspect the GPU memory leak in CUDA allocator' },
                                    {
                                        role: 'assistant',
                                        content: 'I analyzed the CUDA tensor allocations in `src/inference.py`. The tensors were allocated on the default allocator without clearing the cache on OOM. I have added `torch.cuda.empty_cache()` and updated the allocation helper.',
                                    },
                                ],
                            });
                            this.emitLocal('remote:acp:diff_stats', {
                                server_id,
                                agent_id: agent.id,
                                worktree_path: agent.worktree_path,
                                diff_added: 14,
                                diff_removed: 3,
                                diff_files: 2,
                            });
                        }
                        if (agent.queue.length > 0) {
                            this.emitLocal('remote:acp:queue', {
                                server_id,
                                agent_id: agent.id,
                                queue: [...agent.queue],
                            });
                        }
                    }
                }
                callback?.({ success: true, data: { agents: server ? [...server.agents] : [] } });
                break;
            }

            case 'acp:start': {
                const agentId = params?.agent_id || `agent-${Date.now()}`;
                const agentName = params?.agent_name || params?.name || 'AI Agent';
                const project = server!.projects.find((p) => p.id === params?.project_id);

                let wtPath: string | null = params?.worktree_path || null;
                let wtBranch: string | null = params?.worktree_branch || null;

                if (params?.isolate_worktree && !wtPath) {
                    const hash = params?.worktree_name || Math.random().toString(36).slice(2, 10);
                    wtBranch = params?.worktree_branch || `agent/${hash}`;
                    wtPath = `${project?.root || '/home/ubuntu/workspace'}-wt-${hash}`;

                    const projectKey = `${server_id}::${project?.id || ''}`;
                    const list = this.remoteWorktrees.get(projectKey) || [];
                    const wtEntry: RemoteWorktreeEntry = {
                        id: `wt-${hash.slice(0, 8)}`,
                        path: wtPath,
                        branch: wtBranch,
                        head_sha: 'd3adb33f00000004',
                        short_sha: 'd3adb33',
                        commits_ahead: 0,
                        dirty_count: 0,
                        is_dirty: false,
                        base_sha: '0000000000000000',
                        is_main: false,
                        diff_added: 0,
                        diff_removed: 0,
                        diff_files: 0,
                    };
                    list.push(wtEntry);
                    this.remoteWorktrees.set(projectKey, list);
                }

                const summary: NodeAgentSummary = {
                    id: agentId,
                    project_id: params?.project_id ?? null,
                    name: agentName,
                    session_id: params?.resume_session_id || `sess-${server_id}-${agentId}`,
                    is_processing: false,
                    queue: [],
                    worktree_path: wtPath,
                    worktree_branch: wtBranch,
                    diff_added: 0,
                    diff_removed: 0,
                    diff_files: 0,
                };

                const existingIdx = server!.agents.findIndex((a) => a.id === agentId);
                if (existingIdx !== -1) {
                    server!.agents[existingIdx] = summary;
                } else {
                    server!.agents.push(summary);
                }
                this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });

                callback?.({
                    success: true,
                    data: {
                        agent_id: agentId,
                        project_id: params?.project_id,
                        session_id: summary.session_id,
                        worktree_path: wtPath,
                        worktree_branch: wtBranch,
                        diff_added: 0,
                        diff_removed: 0,
                        diff_files: 0,
                        auth_required: false,
                        auth_methods: [],
                    },
                });
                break;
            }

            case 'acp:stop': {
                const agentId = params?.agent_id;
                server!.agents = server!.agents.filter((a) => a.id !== agentId);
                const timerKey = `${server_id}::${agentId}`;
                const timers = this.remotePromptTimers.get(timerKey);
                if (timers) {
                    timers.forEach(clearTimeout);
                    this.remotePromptTimers.delete(timerKey);
                }
                this.emitLocal('remote:servers:updated', { servers: [...this.remoteServers] });
                callback?.({ success: true, data: {} });
                break;
            }

            case 'acp:authenticate': {
                callback?.({
                    success: true,
                    data: { session_id: `sess-${server_id}-${params?.agent_id}-auth` },
                });
                break;
            }

            case 'acp:prompt': {
                const agentId = params?.agent_id;
                const prompt = params?.prompt || '';
                const attachments = params?.attachments || [];
                const agent = server!.agents.find((a) => a.id === agentId);

                if (!agent) {
                    callback?.({ success: false, error: `Agent ${agentId} not found` });
                    return;
                }

                if (agent.is_processing) {
                    const queuedItem: AcpQueuedMessage = {
                        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        prompt,
                        attachments: attachments.length ? attachments : undefined,
                        created_at: Math.floor(Date.now() / 1000),
                    };
                    agent.queue.push(queuedItem);
                    this.emitLocal('remote:acp:queue', {
                        server_id,
                        agent_id: agentId,
                        queue: [...agent.queue],
                    });
                    callback?.({ success: true, data: { id: queuedItem.id } });
                    return;
                }

                callback?.({ success: true, data: {} });
                this.runRemoteAgentPrompt(server_id, agent, prompt, attachments);
                break;
            }

            case 'acp:cancel': {
                const agentId = params?.agent_id;
                const agent = server!.agents.find((a) => a.id === agentId);
                if (agent) {
                    const timerKey = `${server_id}::${agentId}`;
                    const timers = this.remotePromptTimers.get(timerKey);
                    if (timers) {
                        timers.forEach(clearTimeout);
                        this.remotePromptTimers.delete(timerKey);
                    }
                    agent.is_processing = false;
                    this.emitLocal('remote:acp:message', {
                        server_id,
                        agent_id: agentId,
                        item: { role: 'prompt_state', is_processing: false },
                    });
                }
                callback?.({ success: true, data: {} });
                break;
            }

            case 'acp:undo':
            case 'acp:set_model':
            case 'acp:set_reasoning': {
                callback?.({ success: true, data: {} });
                break;
            }

            case 'acp:get_tool_output': {
                callback?.({
                    success: true,
                    data: {
                        output: `[Remote output for ${params?.tool_id || 'tool'}]\nSuccessfully retrieved from ${server!.name}.`,
                    },
                });
                break;
            }

            case 'acp:queue:update': {
                const agentId = params?.agent_id;
                const itemId = params?.item_id;
                const prompt = params?.prompt || '';
                const agent = server!.agents.find((a) => a.id === agentId);
                if (agent) {
                    const item = agent.queue.find((q) => q.id === itemId);
                    if (item) item.prompt = prompt;
                    this.emitLocal('remote:acp:queue', {
                        server_id,
                        agent_id: agentId,
                        queue: [...agent.queue],
                    });
                }
                callback?.({ success: true, data: {} });
                break;
            }

            case 'acp:queue:remove': {
                const agentId = params?.agent_id;
                const itemId = params?.item_id;
                const agent = server!.agents.find((a) => a.id === agentId);
                if (agent) {
                    agent.queue = agent.queue.filter((q) => q.id !== itemId);
                    this.emitLocal('remote:acp:queue', {
                        server_id,
                        agent_id: agentId,
                        queue: [...agent.queue],
                    });
                }
                callback?.({ success: true, data: {} });
                break;
            }

            case 'acp:queue:move': {
                const agentId = params?.agent_id;
                const itemId = params?.item_id;
                const dir = params?.direction;
                const agent = server!.agents.find((a) => a.id === agentId);
                if (agent) {
                    const idx = agent.queue.findIndex((q) => q.id === itemId);
                    if (idx !== -1) {
                        const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
                        if (targetIdx >= 0 && targetIdx < agent.queue.length) {
                            const [item] = agent.queue.splice(idx, 1);
                            agent.queue.splice(targetIdx, 0, item);
                            this.emitLocal('remote:acp:queue', {
                                server_id,
                                agent_id: agentId,
                                queue: [...agent.queue],
                            });
                        }
                    }
                }
                callback?.({ success: true, data: {} });
                break;
            }

            case 'acp:queue:send_now': {
                const agentId = params?.agent_id;
                const itemId = params?.item_id;
                const agent = server!.agents.find((a) => a.id === agentId);
                if (agent) {
                    const idx = agent.queue.findIndex((q) => q.id === itemId);
                    if (idx !== -1) {
                        const [item] = agent.queue.splice(idx, 1);
                        if (!agent.is_processing) {
                            this.emitLocal('remote:acp:queue', {
                                server_id,
                                agent_id: agentId,
                                queue: [...agent.queue],
                            });
                            this.runRemoteAgentPrompt(server_id, agent, item.prompt, item.attachments || []);
                        } else {
                            agent.queue.unshift(item);
                            this.emitLocal('remote:acp:queue', {
                                server_id,
                                agent_id: agentId,
                                queue: [...agent.queue],
                            });
                        }
                    }
                }
                callback?.({ success: true, data: {} });
                break;
            }

            default: {
                callback?.({ success: false, error: `Unknown remote RPC method: ${method}` });
                break;
            }
        }
    }

}
