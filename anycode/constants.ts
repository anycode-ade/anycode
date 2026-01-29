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
// if curent port is 5173 then use 3000 else use current port
const port = window.location.port === '5173' ? '3000' : window.location.port;
export const BACKEND_URL = `${window.location.protocol}//${window.location.hostname}:${port}`;

// File change batching delay in milliseconds
export const BATCH_DELAY_MS = 30;
