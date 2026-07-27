import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './index.css'
import { setWasmBasePath } from 'anycode-react';

// In demo mode (GitHub Pages), set WASM base path relative to the deployed subpath.
// import.meta.env.BASE_URL is automatically set to './' by Vite when base: './' is configured.
// This ensures tree-sitter-*.wasm files are loaded from the correct path, not from '/'.
setWasmBasePath(import.meta.env.BASE_URL);

ReactDOM.createRoot(document.getElementById("root")!).render(
  // <React.StrictMode>
    <App />
  // </React.StrictMode>
);
