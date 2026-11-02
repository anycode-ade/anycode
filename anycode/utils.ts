// Tells DynamicBackground and mounted panels that a warp started. Callers clear
// window.__ANYCODE_IS_WARPING__ when the warp ends.
export const announceWarp = (): void => {
    (window as any).__ANYCODE_IS_WARPING__ = true;
    (window as any).__ANYCODE_WARP_TIMESTAMP__ = Date.now();
    window.dispatchEvent(new CustomEvent('anycode:warp-speed'));
};

export const normalizePath = (path: string): string => {
    return path.replace(/\\/g, '/');
};

export const pathBelongsToProject = (path: string, root: string): boolean => {
    const normalizedPath = normalizePath(path);
    const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
    // A relative root ('.') is the VFS root, so every relative path belongs to it.
    if (normalizedRoot === '.') return !/^([A-Za-z]:)?\//.test(normalizedPath);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
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
    'bash': 'bash',
    'shell': 'bash',
    'zsh': 'bash',
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

export const formatRelativeTime = (timestamp: number): string => {
    const seconds = Math.round((timestamp * 1000 - Date.now()) / 1000);
    const absoluteSeconds = Math.abs(seconds);
    const unit = absoluteSeconds < 60 ? 'second'
        : absoluteSeconds < 3600 ? 'minute'
            : absoluteSeconds < 86400 ? 'hour'
                : absoluteSeconds < 2592000 ? 'day'
                    : absoluteSeconds < 31536000 ? 'month' : 'year';
    const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : unit === 'day' ? 86400 : unit === 'month' ? 2592000 : 31536000;
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
};

// Short form for tight spots: "28m", "3h", "2d".
const COMPACT_TIME_UNITS = [
    { seconds: 31536000, label: 'y' },
    { seconds: 2592000, label: 'mo' },
    { seconds: 86400, label: 'd' },
    { seconds: 3600, label: 'h' },
    { seconds: 60, label: 'm' },
];

export const formatRelativeTimeCompact = (timestamp: number): string => {
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
    const unit = COMPACT_TIME_UNITS.find((item) => elapsed >= item.seconds);
    return unit ? `${Math.floor(elapsed / unit.seconds)}${unit.label}` : 'now';
};

// GitHub avatar for a commit author; noreply emails map to the username.
export const getAvatarUrl = (email: string): string | null => {
    const match = email.trim().match(
        /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i,
    );

    if (!match) {
        const normalizedEmail = email.trim();
        return normalizedEmail
            ? `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(normalizedEmail)}&s=128`
            : null;
    }

    const username = match[1];
    return `https://github.com/${encodeURIComponent(username)}.png?size=128`;
};

export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const nativeRandomUUID: (() => string) | null = ((): (() => string) | null => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID.bind(crypto);
        }
    } catch {
        // Ignore errors accessing crypto.randomUUID
    }
    return null;
})();

/**
 * Generates an RFC 4122 version 4 UUID.
 * Works in both secure contexts (HTTPS, localhost) and insecure contexts (HTTP over remote IP/domain)
 * where `crypto.randomUUID` is not available in the browser.
 */
export const generateUUID = (): string => {
    if (nativeRandomUUID) {
        return nativeRandomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// Polyfill window.crypto.randomUUID if absent so any third-party code also benefits from it.
if (typeof window !== 'undefined' && window.crypto && typeof (window.crypto as any).randomUUID !== 'function') {
    try {
        Object.defineProperty(window.crypto, 'randomUUID', {
            value: generateUUID,
            configurable: true,
            writable: true,
        });
    } catch {
        // Ignore if window.crypto is non-extensible
    }
}


