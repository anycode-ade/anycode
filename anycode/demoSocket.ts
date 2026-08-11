// demoSocket.ts - In-memory Mock Socket for Anycode Live Demo

type EventHandler = (...args: any[]) => void;

interface VfsNode {
    path: string;
    name: string;
    is_dir: boolean;
    content?: string;
}

const SCROLL_DEMO_CONTENT = Array.from({ length: 25 }, (_, section) => {
    const start = section * 10;
    return `# Section ${section + 1}: generated records\n\n` +
        Array.from({ length: 10 }, (_, item) => {
            const index = start + item + 1;
            return `def process_record_${index}(payload: dict[str, object]) -> dict[str, object]:\n` +
                `    """Normalize record ${index} for the demo pipeline."""\n` +
                `    record = {\n` +
                `        "id": ${index},\n` +
                `        "name": payload.get("name", "record-${index}"),\n` +
                `        "active": bool(payload.get("active", True)),\n` +
                `        "score": round(float(payload.get("score", 0.0)), 2),\n` +
                `    }\n` +
                `    return record\n\n`;
        }).join('');
}).join('');

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
    'scroll-demo.py': {
        path: 'scroll-demo.py',
        name: 'scroll-demo.py',
        is_dir: false,
        content: `"""Long file used to exercise virtual scrolling in the live demo."""\n\n${SCROLL_DEMO_CONTENT}`,
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

const notifyGitChange = (socket: DemoSocket, targetPath: string) => {
    const node = DEMO_VFS[targetPath];
    const original = ORIGINAL_VFS_CONTENTS[targetPath];

    if (!node) {
        DEMO_CHANGED_FILES.set(targetPath, { path: targetPath, status: 'deleted', staged: false });
    } else if (original === undefined) {
        DEMO_CHANGED_FILES.set(targetPath, { path: targetPath, status: 'added', staged: false });
    } else if (node.content !== original) {
        const existing = DEMO_CHANGED_FILES.get(targetPath);
        DEMO_CHANGED_FILES.set(targetPath, {
            path: targetPath,
            status: 'modified',
            staged: existing ? existing.staged : false,
        });
    } else {
        DEMO_CHANGED_FILES.delete(targetPath);
    }

    const changedItem = DEMO_CHANGED_FILES.get(targetPath);
    const gitUpdatePayload = {
        kind: 'patch',
        branch: 'main',
        files: changedItem
            ? [{ path: targetPath, status: changedItem.status, staged: changedItem.staged }]
            : [{ path: targetPath, status: 'removed', staged: false }],
    };

    socket.emitLocal('git:update', gitUpdatePayload);
};

const applyEditsToContent = (currentText: string, edits: any[]): string => {
    let result = currentText;
    for (const edit of edits) {
        if (!edit || typeof edit.start !== 'number' || typeof edit.text !== 'string') continue;
        const start = edit.start;
        const text = edit.text;

        if (edit.operation === 'insert') {
            result = result.slice(0, start) + text + result.slice(start);
        } else if (edit.operation === 'remove') {
            result = result.slice(0, start) + result.slice(start + text.length);
        }
    }
    return result;
};

// Dynamically import all 27+ real theme JSON files from the project themes/ directory via Vite glob!
const themeModules = import.meta.glob<Record<string, any>>('../themes/*.json', { eager: true });

const THEME_FILES_MAP: Record<string, any> = {};
const THEME_LIST: { name: string; fileName: string }[] = [];

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

export class DemoSocket {
    public connected: boolean = true;
    public active: boolean = true;
    public id: string = 'demo-socket-id';

    private listeners: Map<string, Set<EventHandler>> = new Map();
    private terminalBuffer: string = '';
    private terminalCurrentDir: string = '.';
    private agentNames: Map<string, string> = new Map();

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
        this.emitLocal('disconnect', 'client disconnect');
        return this;
    }

    public emit(event: string, ...args: any[]): this {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const payload = args[0] || {};

        this.handleEvent(event, payload, callback);
        return this;
    }

    private emitLocal(event: string, ...args: any[]): void {
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
                    callback?.({
                        success: true,
                        content: node.content ?? '',
                        path: targetPath,
                        original: { content: node.content ?? '', is_new: false, status: 'ok' },
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
                    if (typeof payload.content === 'string') {
                        DEMO_VFS[key].content = payload.content;
                    } else if (Array.isArray(payload.edits) && payload.edits.length > 0) {
                        DEMO_VFS[key].content = applyEditsToContent(DEMO_VFS[key].content || '', payload.edits);
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
                    branch: 'main',
                    files: Array.from(DEMO_CHANGED_FILES.values()),
                });
                break;
            }

            case 'git:branches': {
                callback?.({
                    success: true,
                    branches: [{ name: 'main', is_current: true }],
                });
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
                    if (DEMO_VFS[path] && DEMO_VFS[path].content !== undefined) {
                        ORIGINAL_VFS_CONTENTS[path] = DEMO_VFS[path].content!;
                    }
                });
                DEMO_CHANGED_FILES.clear();
                this.emitLocal('git:update', { kind: 'full', branch: 'main', files: [] });
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

                setTimeout(() => {
                    this.emitLocal(`terminal:data:${termName}`, banner);
                    this.emitLocal('terminal:data', { terminal_id: termName, data: banner });
                }, 50);
                break;
            }

            case 'terminal:input': {
                const termName = payload?.name || payload?.terminal_id || 'terminal-1';
                const inputData = payload?.input ?? payload?.data ?? '';
                const channel = `terminal:data:${termName}`;

                const emitData = (str: string) => {
                    this.emitLocal(channel, str);
                    this.emitLocal('terminal:data', { terminal_id: termName, data: str });
                };

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
                callback?.({
                    status: 'ok',
                    success: true,
                    agent_id: agentId,
                    session_id: sessionId,
                });
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

            case 'acp:prompt': {
                const agentId = payload?.agent_id || 'demo-agent-1';
                const agentName = this.agentNames.get(agentId) || 'AI Agent';
                const userPrompt = payload?.prompt || '';
                const lowerPrompt = userPrompt.toLowerCase();
                const toolCallId = `tool-${Date.now()}`;

                callback?.({ status: 'ok', success: true });

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

            case 'acp:stop':
            case 'acp:cancel':
            case 'acp:undo':
            case 'acp:reconnect':
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
}
