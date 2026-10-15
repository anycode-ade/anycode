import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './index.css'
import { setWasmBasePath } from 'anycode-react';
import { initAutoUpdater } from './updater';
import { getWorkspaceState } from './workspace';

// In demo mode (GitHub Pages), set WASM base path relative to the deployed subpath.
// import.meta.env.BASE_URL is automatically set to './' by Vite when base: './' is configured.
// This ensures tree-sitter-*.wasm files are loaded from the correct path, not from '/'.
setWasmBasePath(import.meta.env.BASE_URL);

// Check for updates when running in Tauri desktop environment
initAutoUpdater();

const root = ReactDOM.createRoot(document.getElementById("root")!);

// The active workspace is owned by the backend. Read it before the first render so a page
// reload (which re-runs the webview init script) shows the current state, not the startup one.
getWorkspaceState().then((state) => {
  root.render(
  // <React.StrictMode>
    <App initialWorkspace={state.current_workspace} />
  // </React.StrictMode>
  );
});
