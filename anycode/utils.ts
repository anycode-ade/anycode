export const normalizePath = (path: string): string => {
    return path.replace(/\\/g, '/');
};

export const uriToFilePath = (uriOrPath: string): string => {
    if (!uriOrPath || !uriOrPath.startsWith('file://')) return uriOrPath;

    const rawPath = uriOrPath.slice('file://'.length);
    try {
        const decodedPath = decodeURIComponent(rawPath);
        // file:///C:/... is the canonical URI form for Windows, but the
        // local filesystem path must be C:/..., without the URI root slash.
        return /^\/[A-Za-z]:\//.test(decodedPath)
            ? decodedPath.slice(1)
            : decodedPath;
    } catch {
        return /^\/[A-Za-z]:\//.test(rawPath)
            ? rawPath.slice(1)
            : rawPath;
    }
};

let currentWorkspaceRoot: string | null = null;

export const setWorkspaceRoot = (root: string | null): void => {
    currentWorkspaceRoot = root ? normalizePath(root) : null;
};

export const getWorkspaceRoot = (): string | null => {
    return currentWorkspaceRoot;
};

export const toRelativeDisplayPath = (filePath: string, workspaceRoot?: string | null): string => {
    if (!filePath) return '';
    const cleanPath = uriToFilePath(filePath);
    const normalized = normalizePath(cleanPath);
    const root = (workspaceRoot ? normalizePath(workspaceRoot) : null) ?? currentWorkspaceRoot;
    if (root) {
        if (normalized === root) return '.';
        if (normalized.startsWith(root + '/')) {
            return normalized.slice(root.length + 1);
        }
    }
    const repoMatch = normalized.match(/(?:^|\/)(?:anycode|workspace|project)\/(.+)$/);
    if (repoMatch) {
        return repoMatch[1];
    }
    return normalized;
};

export const toFileUri = (filePath: string, lineRange?: [number, number]): string => {
    if (!filePath) return '';
    const cleanPath = uriToFilePath(filePath);
    const normalized = normalizePath(cleanPath);
    const hash = lineRange
        ? `#L${lineRange[0]}${lineRange[1] !== lineRange[0] ? `-L${lineRange[1]}` : ''}`
        : '';

    if (/^[A-Za-z]:\//.test(normalized)) {
        return `file:///${normalized}${hash}`;
    }

    if (normalized.startsWith('/')) {
        return `file://${normalized}${hash}`;
    }

    return `file://${normalized}${hash}`;
};

export const getFileName = (path: string): string => {
    const normalized = normalizePath(path);
    const parts = normalized.split('/');
    return parts[parts.length - 1] || 'untitled';
};

export const getParentPath = (path: string): string => {
    const normalized = normalizePath(path);
    const parts = normalized.split('/');
    if (parts.length <= 1) return '.';
    const parent = parts.slice(0, -1).join('/');
    if (!parent && normalized.startsWith('/')) return '/';
    return parent || '.';
};

export const joinPath = (...parts: string[]): string => {
    return parts
        .filter(p => p && p !== '.')
        .map(p => normalizePath(p))
        .join('/');
};

// File extensions mapping
export const LANGUAGE_EXTENSIONS: { [key: string]: string } = {
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'javascript',
    'tsx': 'tsx',
    'py': 'python',
    'cpp': 'cpp',
    'c': 'c',
    'java': 'java',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'rs': 'rust',
    'go': 'go',
    'sh': 'bash',
    'kt': 'kotlin',
    'cs': 'csharp',
    'h': 'c',
    'zig': 'zig',
    'lua': 'lua',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'md': 'markdown',
    'markdown': 'markdown',
    'php': 'php',
    'rb': 'ruby',
    'vue': 'vue',
    'dockerfile': 'dockerfile',
    'sql': 'sql',
};

export const EDITOR_SUPPORTED_LANGUAGES = new Set(Object.values(LANGUAGE_EXTENSIONS));

export const getLanguageFromFileName = (fileName: string): string => {
    const normalizedName = fileName.toLowerCase();
    if (normalizedName === 'dockerfile' || normalizedName.startsWith('dockerfile.')) {
        return 'dockerfile';
    }

    const ext = normalizedName.split('.').pop();
    return LANGUAGE_EXTENSIONS[ext || ''] || '';
};

export const copyTextToClipboard = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Fall back to the legacy API when clipboard permissions are unavailable.
        }
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();

    try {
        if (!document.execCommand('copy')) {
            throw new Error('Copy command was rejected');
        }
    } finally {
        textArea.remove();
    }
};
