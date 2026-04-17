import { FileState } from './types';

export const DEFAULT_FILE: FileState = {
    id: 'welcome.js',
    name: 'welcome.js',
    language: 'javascript',
};

export const DEFAULT_FILE_CONTENT = 
`// Welcome to Anycode Editor!

// This is a default file created for you. You can:
// - Open files from the file tree on the left  
// - Edit files in the main editor area
// - undo changes with meta + z, redo meta + shift + z 
// - copy/paste meta + c/ meta + v
// - cut on meta + x, duplicate on meta + d
// - comment line on meta + /
// - Save changes using the meta + s button
// - Open Files panel with contol + 1
// - Open Terminal panel with contol + 2

console.log('Happy coding! 🚀');

function hello() {
    return 'Hello, World!';
}

// Try editing this file!
`;

// Backend connection settings
const PROTOCOL = window.location.protocol === 'file:' ? 'http:' : window.location.protocol;
const HOSTNAME = window.location.hostname || 'localhost';
const CURRENT_PORT = window.location.port;
const DEV_PORTS = new Set(['5173', '5174', '5175', '4173']);

function uniqueUrls(urls: string[]): string[] {
    return Array.from(new Set(urls.filter(Boolean)));
}

export const BACKEND_URL_CANDIDATES = uniqueUrls([
    typeof import.meta !== 'undefined' ? String(import.meta.env?.VITE_BACKEND_URL || '') : '',
    ...(DEV_PORTS.has(CURRENT_PORT) ? [`${PROTOCOL}//${HOSTNAME}:3000`] : []),
    ...(CURRENT_PORT ? [`${PROTOCOL}//${HOSTNAME}:${CURRENT_PORT}`] : []),
    `${PROTOCOL}//${HOSTNAME}:3000`,
    `${PROTOCOL}//localhost:3000`,
]);

export const BACKEND_URL = BACKEND_URL_CANDIDATES[0] || `${PROTOCOL}//localhost:3000`;

// File change batching delay in milliseconds
export const BATCH_DELAY_MS = 30;
