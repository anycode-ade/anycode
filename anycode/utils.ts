export const normalizePath = (path: string): string => {
    return path.replace(/\\/g, '/');
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
    return parts.slice(0, -1).join('/') || '.';
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
    'tsx': 'typescript',
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
