import { EventEmitter, Uri } from './types';
import type { RpcConnection } from '../rpc';
import { extHostLog } from '../logger';

export class ExtHostEnv {
  readonly appName = 'Anycode';
  readonly appRoot = process.cwd();
  readonly language = 'en';
  readonly uriScheme = 'vscode';
  readonly machineId = 'anycode-machine-id-0000-0000-0000';
  readonly sessionId = 'anycode-session-id-0000-0000-0000';
  readonly uiKind = 1; // UIKind.Desktop
  readonly isTelemetryEnabled = false;
  readonly isNewAppInstall = false;
  readonly appHost = 'desktop';
  readonly shell = process.env.SHELL || '/bin/zsh';
  readonly remoteName = undefined;

  private _onDidChangeTelemetryEnabled = new EventEmitter<boolean>();
  readonly onDidChangeTelemetryEnabled = this._onDidChangeTelemetryEnabled.event;

  private _onDidChangeShell = new EventEmitter<string>();
  readonly onDidChangeShell = this._onDidChangeShell.event;

  constructor(private _rpc: RpcConnection) {}

  readonly clipboard = {
    readText: async (): Promise<string> => {
      return this._rpc.sendRequest('env/readClipboard');
    },
    writeText: async (value: string): Promise<void> => {
      await this._rpc.sendRequest('env/writeClipboard', { value });
    },
  };

  async openExternal(target: Uri | string): Promise<boolean> {
    const uriStr = typeof target === 'string' ? target : target.toString();
    extHostLog('env', `openExternal called with: ${uriStr}`);
    try {
      const res = await this._rpc.sendRequest('env/openExternal', { uri: uriStr });
      return res !== false;
    } catch (e) {
      extHostLog('env', `openExternal failed:`, e);
      return false;
    }
  }

  async asExternalUri(target: Uri): Promise<Uri> {
    extHostLog('env', `asExternalUri called with: ${target?.toString?.() || target}`);
    return target;
  }

  createTelemetryLogger(sender?: any, options?: any) {
    const emitter = new EventEmitter<any>();
    return {
      logUsage: (eventName: string, data?: Record<string, any>) => {
        try {
          sender?.sendEventData?.(eventName, data);
        } catch {}
      },
      logError: (errorOrEventName: any, data?: Record<string, any>) => {
        try {
          if (typeof errorOrEventName === 'string') {
            sender?.sendEventData?.(errorOrEventName, data);
          } else {
            sender?.sendErrorData?.(errorOrEventName, data);
          }
        } catch {}
      },
      onDidChangeEnableStates: emitter.event,
      isUsageEnabled: true,
      isErrorsEnabled: true,
      dispose: () => {
        try {
          sender?.flush?.();
        } catch {}
      },
    };
  }
}
