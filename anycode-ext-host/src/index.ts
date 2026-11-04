import * as path from 'path';
import * as fs from 'fs';
import { RpcConnection } from './rpc';
import { ExtHostWorkspace } from './api/workspace';
import { ExtHostLanguages } from './api/languages';
import { ExtHostWindow } from './api/window';
import { ExtHostCommands } from './api/commands';
import { ExtHostEnv } from './api/env';
import { ExtHostExtensionContext } from './api/context';
import { createVsCodeApi } from './api/vscode';

const rawStderrWrite = process.stderr.write.bind(process.stderr);
function extHostLog(...args: any[]) {
  rawStderrWrite(args.map(a => typeof a === 'object' ? (a?.stack || JSON.stringify(a)) : String(a)).join(' ') + '\n');
}

// Catch unhandled errors in extensions to prevent crashing the extension host process
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EPIPE') return;
  extHostLog('[ext-host] Uncaught exception in extension host:', err?.stack || err);
});

process.on('unhandledRejection', (reason: any) => {
  extHostLog('[ext-host] Unhandled promise rejection in extension host:', reason?.stack || reason);
});

process.stdout.on('error', (err: any) => {
  if (err?.code === 'EPIPE') return;
  extHostLog('[ext-host] stdout error:', err);
});

process.stderr.on('error', (err: any) => {
  if (err?.code === 'EPIPE') return;
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.stdin.on('close', () => {
  process.exit(0);
});

// Setup Module._load interceptor for require('vscode')
const Module = require('module');
const originalLoad = Module._load;

const rpc = new RpcConnection(process.stdin, process.stdout);
const workspace = new ExtHostWorkspace(rpc);
const languages = new ExtHostLanguages(workspace, rpc);
const window = new ExtHostWindow(workspace, rpc);
const commands = new ExtHostCommands(window, rpc);
const env = new ExtHostEnv(rpc);

interface ActiveExtension {
  id: string;
  extensionPath: string;
  context: ExtHostExtensionContext;
  exports: any;
  deactivate?: () => void | Promise<void>;
}

const activeExtensions = new Map<string, ActiveExtension>();
let storageDirectory = path.join(process.cwd(), '.anycode-ext-storage');

const vscodeApi = createVsCodeApi(
  workspace,
  languages,
  window,
  commands,
  env,
  (id: string) => {
    const found = activeExtensions.get(id) || activeExtensions.get(id.toLowerCase());
    return found ? found.context.extension : undefined;
  },
  () => Array.from(activeExtensions.values()).map((e) => e.context.extension)
);

Module._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'vscode') {
    return vscodeApi;
  }
  return originalLoad.apply(this, arguments);
};

// Register JSON-RPC handlers from Backend
rpc.onRequest('extHost/init', async (params: { workspaceRoot?: string; storageDir?: string; configuration?: Record<string, any> }) => {
  if (params.workspaceRoot) {
    workspace.setWorkspaceRoot(params.workspaceRoot);
  }
  if (params.storageDir) {
    storageDirectory = params.storageDir;
  }
  if (params.configuration) {
    workspace.updateConfiguration(params.configuration);
  }
  return { success: true };
});

rpc.onRequest('extHost/activateExtension', async (params: { id: string; extensionPath: string; mainFile?: string }) => {
  const { id, extensionPath, mainFile } = params;
  if (activeExtensions.has(id)) {
    return { success: true, alreadyActive: true };
  }

  if (!mainFile) {
    return { success: true, declarativeOnly: true };
  }

  const fullMainPath = path.isAbsolute(mainFile) ? mainFile : path.join(extensionPath, mainFile);
  if (!fs.existsSync(fullMainPath)) {
    throw new Error(`Extension main entry point does not exist: ${fullMainPath}`);
  }

  const context = new ExtHostExtensionContext(id, extensionPath, storageDirectory);

  try {
    const activeItem: ActiveExtension = {
      id,
      extensionPath,
      context,
      exports: undefined,
    };
    activeExtensions.set(id, activeItem);

    // Register default configuration from package.json contributes
    const pkg = context.extension.packageJSON;
    if (pkg?.contributes?.configuration) {
      const cfgs = Array.isArray(pkg.contributes.configuration)
        ? pkg.contributes.configuration
        : [pkg.contributes.configuration];
      for (const cfg of cfgs) {
        if (cfg?.properties) {
          for (const [propKey, propVal] of Object.entries<any>(cfg.properties)) {
            if (propVal?.default !== undefined) {
              workspace.setDefaultConfiguration(propKey, propVal.default);
            }
          }
        }
      }
    }

    const extModule = require(fullMainPath);
    let exports: any = undefined;
    if (extModule && typeof extModule.activate === 'function') {
      exports = await extModule.activate(context);
    }

    activeItem.exports = exports;
    activeItem.deactivate = extModule?.deactivate;

    return { success: true };
  } catch (err: any) {
    activeExtensions.delete(id);
    extHostLog(`[ext-host] Failed to activate extension ${id}:`, err?.stack || err);
    throw new Error(`Failed to activate ${id}: ${err?.message || String(err)}`);
  }
});

rpc.onRequest('extHost/deactivateExtension', async (params: { id: string }) => {
  const ext = activeExtensions.get(params.id);
  if (!ext) return { success: true };

  try {
    if (typeof ext.deactivate === 'function') {
      await ext.deactivate();
    }
  } catch (err) {
    console.error(`Error in deactivate for ${params.id}:`, err);
  }

  for (const sub of ext.context.subscriptions) {
    try {
      sub.dispose();
    } catch {}
  }

  activeExtensions.delete(params.id);
  return { success: true };
});

// Document lifecycle
rpc.onNotification('textDocument/didOpen', (params: { uri: string; languageId: string; version: number; text: string }) => {
  workspace.handleDocumentOpened(params.uri, params.languageId, params.version, params.text);
});

rpc.onNotification('textDocument/didChange', (params: { uri: string; version: number; changes: any[]; fullText?: string }) => {
  workspace.handleDocumentChanged(params.uri, params.version, params.changes, params.fullText);
});

rpc.onNotification('textDocument/didSave', (params: { uri: string }) => {
  workspace.handleDocumentSaved(params.uri);
});

rpc.onNotification('textDocument/didClose', (params: { uri: string }) => {
  workspace.handleDocumentClosed(params.uri);
});

rpc.onNotification('window/activeEditorChanged', (params: { uri: string | null }) => {
  window.setActiveTextEditor(params.uri);
});

// LSP Providers
rpc.onRequest('textDocument/completion', async (params: { uri: string; line: number; character: number; context?: any }) => {
  return languages.provideCompletions(params.uri, params.line, params.character, params.context);
});

rpc.onRequest('textDocument/hover', async (params: { uri: string; line: number; character: number }) => {
  return languages.provideHover(params.uri, params.line, params.character);
});

rpc.onRequest('textDocument/definition', async (params: { uri: string; line: number; character: number }) => {
  return languages.provideDefinition(params.uri, params.line, params.character);
});

rpc.onRequest('textDocument/formatting', async (params: { uri: string; options: any }) => {
  return languages.provideFormatting(params.uri, params.options);
});

rpc.onRequest('textDocument/codeAction', async (params: { uri: string; range: any; context?: any }) => {
  return languages.provideCodeActions(params.uri, params.range, params.context);
});

// Command execution
rpc.onRequest('commands/executeCommand', async (params: { command: string; args?: any[] }) => {
  return commands.execute(params.command, params.args || []);
});

// TreeView & Webview
rpc.onRequest('treeView/getChildren', async (params: { viewId: string; elementId?: string }) => {
  return window.getTreeItemChildren(params.viewId, params.elementId);
});

rpc.onRequest('webviewView/resolve', async (params: { viewId: string; panelId: string }) => {
  return window.resolveWebviewView(params.viewId, params.panelId);
});

rpc.onNotification('webview/onMessage', (params: { panelId: string; message: any }) => {
  window.handleWebviewMessage(params.panelId, params.message);
});

rpc.onNotification('workspace/didChangeWorkspaceFolders', (params: { workspaceRoot: string }) => {
  if (params.workspaceRoot) {
    workspace.setWorkspaceRoot(params.workspaceRoot);
  }
});

// Ready notification
rpc.sendNotification('extHost/ready', { pid: process.pid, version: '1.96.0' });
