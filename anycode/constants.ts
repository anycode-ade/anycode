// Backend connection settings
// if curent port is 5173 then use 3000 else use current port
const port = window.location.port === '5173' ? '3000' : window.location.port;
export const BACKEND_URL = `${window.location.protocol}//${window.location.hostname}:${port}`;

// File change batching delay in milliseconds
export const BATCH_DELAY_MS = 30;
