import * as types from './types';
import type { ExtHostWorkspace } from './workspace';
import type { ExtHostLanguages } from './languages';
import type { ExtHostWindow } from './window';
import type { ExtHostCommands } from './commands';
import type { ExtHostEnv } from './env';

export function createVsCodeApi(
  workspace: ExtHostWorkspace,
  languages: ExtHostLanguages,
  window: ExtHostWindow,
  commands: ExtHostCommands,
  env: ExtHostEnv,
  getExtension?: (id: string) => any,
  getAllExtensions?: () => any[]
): any {
  const api: any = {
    ...types,
    workspace,
    languages,
    window,
    commands,
    env,
    version: '1.96.0',
    UIKind: {
      Desktop: 1,
      Web: 2,
    },
    l10n: {
      bundle: undefined as Record<string, string> | undefined,
      uri: undefined as types.Uri | undefined,
      t: (messageOrOptions: string | { message: string; args?: any[] }, ...args: any[]): string => {
        let message = typeof messageOrOptions === 'string' ? messageOrOptions : messageOrOptions.message;
        let formatArgs = typeof messageOrOptions === 'object' && messageOrOptions.args ? messageOrOptions.args : args;
        if (formatArgs && formatArgs.length > 0) {
          for (let i = 0; i < formatArgs.length; i++) {
            message = message.replace(new RegExp(`\\{${i}\\}`, 'g'), String(formatArgs[i]));
          }
        }
        return message;
      },
    },
    extensions: {
      getExtension: (id: string) => (getExtension ? getExtension(id) : undefined),
      get all() {
        return getAllExtensions ? getAllExtensions() : [];
      },
      onDidChange: new types.EventEmitter().event,
    },
    authentication: {
      getSession: async () => undefined,
      getSessions: async () => [],
      onDidChangeSessions: new types.EventEmitter().event,
    },
    tasks: {
      registerTaskProvider: (_type: string, _provider: any) => new types.Disposable(() => {}),
      fetchTasks: async (_filter?: any) => [],
      executeTask: async (task: any) => ({
        task,
        terminate: () => {},
      }),
      onDidStartTask: new types.EventEmitter<any>().event,
      onDidEndTask: new types.EventEmitter<any>().event,
      onDidStartTaskProcess: new types.EventEmitter<any>().event,
      onDidEndTaskProcess: new types.EventEmitter<any>().event,
      taskExecutions: [],
    },
    scm: {
      createSourceControl: (id: string, label: string, rootUri?: types.Uri) => ({
        id,
        label,
        rootUri,
        inputBox: { value: '', placeholder: '' },
        count: 0,
        quickDiffProvider: undefined,
        createResourceGroup: (groupId: string, groupLabel: string) => ({
          id: groupId,
          label: groupLabel,
          resourceStates: [],
          dispose: () => {},
        }),
        dispose: () => {},
      }),
      inputBox: { value: '' },
    },
    comments: {
      createCommentController: (id: string, label: string) => ({
        id,
        label,
        commentingRangeProvider: undefined,
        createCommentThread: () => ({
          dispose: () => {},
        }),
        dispose: () => {},
      }),
    },
    notebooks: {
      createNotebookController: () => ({ dispose: () => {} }),
      registerNotebookCellStatusBarItemProvider: () => new types.Disposable(() => {}),
      onDidChangeNotebookCellExecutionState: new types.EventEmitter<any>().event,
    },
    ExtensionMode: {
      Production: 1,
      Development: 2,
      Test: 3,
    },
    ColorThemeKind: {
      Light: 1,
      Dark: 2,
      HighContrast: 3,
      HighContrastLight: 4,
    },
    EndOfLine: {
      LF: 1,
      CRLF: 2,
    },
  };
  api.default = api;
  api.__esModule = true;
  return api;
}
