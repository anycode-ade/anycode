import { Disposable } from './types';
import type { ExtHostWindow } from './window';
import type { RpcConnection } from '../rpc';
import { extHostLog } from '../logger';

export class ExtHostCommands {
  private _commands = new Map<string, (...args: any[]) => any>();
  private _contexts = new Map<string, any>();

  constructor(private _window: ExtHostWindow, private _rpc: RpcConnection) {
    this.registerBuiltinCommands();
  }

  private registerBuiltinCommands(): void {
    this._commands.set('setContext', async (key: string, value: any) => {
      this._contexts.set(key, value);
      this._rpc.sendNotification('commands/setContext', { key, value });
      return value;
    });

    this._commands.set('getContext', async (key: string) => {
      return this._contexts.get(key);
    });

    this._commands.set('vscode.open', async (uri: any, options?: any) => {
      return this._rpc.sendRequest('commands/openUri', { uri: uri?.toString?.() || uri, options });
    });

    this._commands.set('vscode.openWith', async (uri: any, viewId: string, options?: any) => {
      return this._rpc.sendRequest('commands/openWith', { uri: uri?.toString?.() || uri, viewId, options });
    });

    this._commands.set('vscode.diff', async (left: any, right: any, title?: string, options?: any) => {
      return this._rpc.sendRequest('commands/diff', { left: left?.toString?.(), right: right?.toString?.(), title, options });
    });

    this._commands.set('cursorMove', async () => {});
    this._commands.set('editorScroll', async () => {});
  }

  registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any): Disposable {
    extHostLog('commands', `registerCommand: ${command}`);
    const bound = thisArg ? callback.bind(thisArg) : callback;
    this._commands.set(command, bound);
    this._rpc.sendNotification('commands/registerCommand', { command });

    return new Disposable(() => {
      this._commands.delete(command);
      this._rpc.sendNotification('commands/unregisterCommand', { command });
    });
  }

  registerTextEditorCommand(
    command: string,
    callback: (textEditor: any, edit: any, ...args: any[]) => any,
    thisArg?: any
  ): Disposable {
    return this.registerCommand(
      command,
      async (...args: any[]) => {
        const editor = this._window.activeTextEditor;
        if (!editor) return;
        return editor.edit((editBuilder) => {
          callback.apply(thisArg, [editor, editBuilder, ...args]);
        });
      },
      thisArg
    );
  }

  async executeCommand<T = any>(command: string, ...rest: any[]): Promise<T | undefined> {
    extHostLog('commands', `executeCommand: ${command}`, rest);
    const handler = this._commands.get(command);
    if (handler) {
      try {
        return await handler(...rest);
      } catch (err) {
        extHostLog('commands', `executeCommand ${command} threw:`, err);
        throw err;
      }
    }

    // Forward to backend
    return this._rpc.sendRequest('commands/executeCommand', { command, args: rest });
  }

  async getCommands(filterInternal?: boolean): Promise<string[]> {
    const local = Array.from(this._commands.keys());
    try {
      const remote: string[] = await this._rpc.sendRequest('commands/getCommands');
      const all = new Set([...local, ...remote]);
      return Array.from(all);
    } catch {
      return local;
    }
  }

  async execute(command: string, args: any[] = []): Promise<any> {
    const handler = this._commands.get(command);
    if (!handler) {
      throw new Error(`Command '${command}' not found in extension host`);
    }
    return handler(...args);
  }
}
