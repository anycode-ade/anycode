export const normalizePath = (path: string): string => {
    return path.replace(/\\/g, '/');
};

export const uriToFilePath = (uriOrPath: string): string => {
    if (!uriOrPath || !uriOrPath.startsWith('file://')) return uriOrPath;

    const rawPath = uriOrPath.slice('file://'.length);
    try {
        const decodedPath = decodeURIComponent(rawPath);
        return /^\/[A-Za-z]:\//.test(decodedPath)
            ? decodedPath.slice(1)
            : decodedPath;
    } catch {
        return /^\/[A-Za-z]:\//.test(rawPath)
            ? rawPath.slice(1)
            : rawPath;
    }
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
            // Fall back to legacy
        }
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
    } finally {
        textArea.remove();
    }
};

export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
