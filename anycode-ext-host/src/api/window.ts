import {
  CancellationToken,
  CancellationTokenSource,
  Disposable,
  EventEmitter,
  LogLevel,
  Position,
  ProgressLocation,
  Range,
  Selection,
  StatusBarAlignment,
  TextEdit,
  ThemeColor,
  Uri,
  ViewColumn,
} from './types';
import type { ExtHostTextDocument, ExtHostWorkspace } from './workspace';
import type { RpcConnection } from '../rpc';

export interface TextEditorDecorationType extends Disposable {
  readonly key: string;
}

export class ExtHostTextEditor {
  selection: Selection = new Selection(0, 0, 0, 0);
  selections: Selection[] = [this.selection];
  visibleRanges: Range[] = [new Range(0, 0, 100, 0)];

  constructor(
    readonly document: ExtHostTextDocument,
    private _workspace: ExtHostWorkspace,
    private _rpc: RpcConnection
  ) {}

  async edit(callback: (editBuilder: any) => void): Promise<boolean> {
    const edits: TextEdit[] = [];
    const editBuilder = {
      replace: (location: Range | Selection, value: string) => {
        edits.push(new TextEdit(location, value));
      },
      insert: (location: Position, value: string) => {
        edits.push(new TextEdit(new Range(location, location), value));
      },
      delete: (location: Range | Selection) => {
        edits.push(new TextEdit(location, ''));
      },
    };

    callback(editBuilder);

    const serialized = edits.map((e) => ({
      range: {
        start: { line: e.range.start.line, character: e.range.start.character },
        end: { line: e.range.end.line, character: e.range.end.character },
      },
      newText: e.newText,
    }));

    try {
      await this._rpc.sendRequest('workspace/applyEdit', {
        edits: [{ uri: this.document.uri.toString(), edits: serialized }],
      });
      return true;
    } catch {
      return false;
    }
  }

  insertSnippet(snippet: any, location?: Position | Range): Promise<boolean> {
    const text = typeof snippet === 'string' ? snippet : snippet.value;
    return this._rpc.sendRequest('window/insertSnippet', {
      uri: this.document.uri.toString(),
      snippet: text,
      location,
    });
  }

  setDecorations(decorationType: TextEditorDecorationType, rangesOrOptions: (Range | any)[]): void {
    const serialized = rangesOrOptions.map((item) => {
      if (item instanceof Range) {
        return {
          range: {
            start: { line: item.start.line, character: item.start.character },
            end: { line: item.end.line, character: item.end.character },
          },
        };
      }
      return {
        range: item.range
          ? {
              start: { line: item.range.start.line, character: item.range.start.character },
              end: { line: item.range.end.line, character: item.range.end.character },
            }
          : undefined,
        renderOptions: item.renderOptions,
        hoverMessage: item.hoverMessage,
      };
    });

    this._rpc.sendNotification('window/setDecorations', {
      uri: this.document.uri.toString(),
      key: decorationType.key,
      decorations: serialized,
    });
  }

  revealRange(range: Range, revealType?: any): void {
    this._rpc.sendNotification('window/revealRange', {
      uri: this.document.uri.toString(),
      range: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
      },
    });
  }
}

export class ExtHostStatusBarItem implements Disposable {
  text = '';
  tooltip: string | undefined;
  command: string | any;
  color: string | ThemeColor | undefined;
  backgroundColor: ThemeColor | undefined;
  priority: number;
  alignment: StatusBarAlignment;
  private _visible = false;

  constructor(
    readonly id: string,
    alignment = StatusBarAlignment.Left,
    priority = 0,
    private _rpc: RpcConnection
  ) {
    this.alignment = alignment;
    this.priority = priority;
  }

  show(): void {
    this._visible = true;
    this._sync();
  }

  hide(): void {
    this._visible = false;
    this._sync();
  }

  private _sync(): void {
    this._rpc.sendNotification('window/setStatusBar', {
      id: this.id,
      text: this.text,
      tooltip: typeof this.tooltip === 'string' ? this.tooltip : undefined,
      command: typeof this.command === 'string' ? this.command : this.command?.command,
      color: typeof this.color === 'string' ? this.color : this.color?.id,
      alignment: this.alignment,
      priority: this.priority,
      visible: this._visible,
    });
  }

  dispose(): void {
    this.hide();
  }
}

export class ExtHostOutputChannel implements Disposable {
  readonly logLevel = LogLevel.Info;
  private _onDidChangeLogLevel = new EventEmitter<LogLevel>();
  readonly onDidChangeLogLevel = this._onDidChangeLogLevel.event;

  constructor(readonly name: string, private _rpc: RpcConnection) {}

  append(value: string): void {
    this._rpc.sendNotification('window/outputAppend', { name: this.name, value });
  }

  appendLine(value: string): void {
    this.append(value + '\n');
  }

  replace(value: string): void {
    this.clear();
    this.append(value);
  }

  clear(): void {
    this._rpc.sendNotification('window/outputClear', { name: this.name });
  }

  show(): void {
    this._rpc.sendNotification('window/outputShow', { name: this.name });
  }

  hide(): void {}

  trace(message: string, ...args: any[]): void {
    this.appendLine(`[Trace] ${message} ${args.length ? args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : ''}`);
  }

  debug(message: string, ...args: any[]): void {
    this.appendLine(`[Debug] ${message} ${args.length ? args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : ''}`);
  }

  info(message: string, ...args: any[]): void {
    this.appendLine(`[Info] ${message} ${args.length ? args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : ''}`);
  }

  warn(message: string, ...args: any[]): void {
    this.appendLine(`[Warn] ${message} ${args.length ? args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : ''}`);
  }

  error(error: string | Error, ...args: any[]): void {
    const errStr = error instanceof Error ? error.stack || error.message : String(error);
    this.appendLine(`[Error] ${errStr} ${args.length ? args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : ''}`);
  }

  dispose(): void {}
}

export function prepareForJson(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))) {
    return Array.from(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(prepareForJson);
  }
  const res: any = {};
  for (const k of Object.keys(obj)) {
    res[k] = prepareForJson(obj[k]);
  }
  return res;
}

export function reviveBytes(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj[0] === 'bytes') {
      if (obj[1] && typeof obj[1] === 'object' && !(obj[1] instanceof Uint8Array)) {
        const vals = Array.isArray(obj[1]) ? obj[1] : Object.values(obj[1]);
        obj[1] = new Uint8Array(vals);
      }
      return obj;
    }
    for (let i = 0; i < obj.length; i++) {
      obj[i] = reviveBytes(obj[i]);
    }
    return obj;
  }
  for (const k of Object.keys(obj)) {
    obj[k] = reviveBytes(obj[k]);
  }
  return obj;
}

export class ExtHostWebview {
  private _html = '';
  private _options: any;
  private _onDidReceiveMessageEmitter = new EventEmitter<any>();
  readonly onDidReceiveMessage = this._onDidReceiveMessageEmitter.event;

  constructor(
    readonly panelId: string,
    private _rpc: RpcConnection,
    options?: any
  ) {
    this._options = options || {};
  }

  get html(): string {
    return this._html;
  }

  set html(val: string) {
    this._html = val;
    this._rpc.sendNotification('window/setWebviewHtml', {
      panelId: this.panelId,
      html: val,
    });
  }

  get options(): any {
    return this._options;
  }

  set options(opts: any) {
    this._options = opts;
  }

  get cspSource(): string {
    return 'https://file+.vscode-resource.vscode-cdn.net';
  }

  async postMessage(message: any): Promise<boolean> {
    const safeMessage = prepareForJson(message);
    const res = await this._rpc.sendRequest('window/postWebviewMessage', {
      panelId: this.panelId,
      message: safeMessage,
    });
    return res !== false;
  }

  asWebviewUri(localResource: Uri): Uri {
    return Uri.parse(`https://file+.vscode-resource.vscode-cdn.net${localResource.path}`);
  }

  handleMessageReceived(message: any): void {
    const revived = reviveBytes(message);
    this._onDidReceiveMessageEmitter.fire(revived);
  }
}

export class ExtHostWebviewPanel implements Disposable {
  readonly webview: ExtHostWebview;
  private _onDidDisposeEmitter = new EventEmitter<void>();
  readonly onDidDispose = this._onDidDisposeEmitter.event;

  private _onDidChangeViewStateEmitter = new EventEmitter<any>();
  readonly onDidChangeViewState = this._onDidChangeViewStateEmitter.event;

  private _onDidChangeVisibilityEmitter = new EventEmitter<boolean>();
  readonly onDidChangeVisibility = this._onDidChangeVisibilityEmitter.event;

  visible = true;
  active = true;
  viewColumn = 1;
  iconPath: any = undefined;

  constructor(
    readonly viewType: string,
    public title: string,
    readonly panelId: string,
    options: any,
    private _rpc: RpcConnection
  ) {
    this.webview = new ExtHostWebview(panelId, _rpc, options);
  }

  get onDidReceiveMessage() {
    return this.webview.onDidReceiveMessage;
  }

  handleMessageReceived(message: any): void {
    this.webview.handleMessageReceived(message);
  }

  reveal(viewColumn?: any, preserveFocus?: boolean): void {
    this._rpc.sendNotification('window/revealWebview', { panelId: this.panelId, viewColumn, preserveFocus });
  }

  dispose(): void {
    this._rpc.sendNotification('window/disposeWebview', { panelId: this.panelId });
    this._onDidDisposeEmitter.fire();
  }
}

export class ExtHostWindow {
  private _activeEditor: ExtHostTextEditor | undefined;
  private _visibleEditors: ExtHostTextEditor[] = [];
  private _decorationCounter = 1;
  private _statusBarCounter = 1;
  private _panelCounter = 1;
  private _treeViewProviders = new Map<string, any>();
  private _treeViewElements = new Map<string, Map<string, any>>();
  private _webviewViewProviders = new Map<string, any>();
  private _webviewPanels = new Map<string, ExtHostWebviewPanel>();
  private _webviews = new Map<string, ExtHostWebview>();

  readonly onDidChangeActiveTextEditorEmitter = new EventEmitter<ExtHostTextEditor | undefined>();
  readonly onDidChangeActiveTextEditor = this.onDidChangeActiveTextEditorEmitter.event;

  readonly onDidChangeVisibleTextEditorsEmitter = new EventEmitter<ExtHostTextEditor[]>();
  readonly onDidChangeVisibleTextEditors = this.onDidChangeVisibleTextEditorsEmitter.event;

  readonly onDidChangeTextEditorSelectionEmitter = new EventEmitter<any>();
  readonly onDidChangeTextEditorSelection = this.onDidChangeTextEditorSelectionEmitter.event;

  readonly onDidChangeTextEditorVisibleRangesEmitter = new EventEmitter<any>();
  readonly onDidChangeTextEditorVisibleRanges = this.onDidChangeTextEditorVisibleRangesEmitter.event;

  readonly onDidChangeTextEditorOptionsEmitter = new EventEmitter<any>();
  readonly onDidChangeTextEditorOptions = this.onDidChangeTextEditorOptionsEmitter.event;

  readonly onDidChangeTextEditorViewColumnEmitter = new EventEmitter<any>();
  readonly onDidChangeTextEditorViewColumn = this.onDidChangeTextEditorViewColumnEmitter.event;

  constructor(private _workspace: ExtHostWorkspace, private _rpc: RpcConnection) {}

  get activeTextEditor(): ExtHostTextEditor | undefined {
    return this._activeEditor;
  }

  get visibleTextEditors(): ExtHostTextEditor[] {
    return this._visibleEditors.slice();
  }

  setActiveTextEditor(uriStr: string | null): void {
    if (!uriStr) {
      this._activeEditor = undefined;
    } else {
      const doc = this._workspace.getDocument(uriStr);
      if (doc) {
        this._activeEditor = new ExtHostTextEditor(doc, this._workspace, this._rpc);
        this._visibleEditors = [this._activeEditor];
      }
    }
    this.onDidChangeActiveTextEditorEmitter.fire(this._activeEditor);
    this.onDidChangeVisibleTextEditorsEmitter.fire(this._visibleEditors);
  }

  createTextEditorDecorationType(options: any): TextEditorDecorationType {
    const key = `dec_${this._decorationCounter++}`;
    return {
      key,
      dispose: () => {
        this._rpc.sendNotification('window/removeDecorationType', { key });
      },
    };
  }

  async showInformationMessage<T extends string>(message: string, ...items: T[]): Promise<T | undefined> {
    return this._showMessage(1, message, items);
  }

  async showWarningMessage<T extends string>(message: string, ...items: T[]): Promise<T | undefined> {
    return this._showMessage(2, message, items);
  }

  async showErrorMessage<T extends string>(message: string, ...items: T[]): Promise<T | undefined> {
    return this._showMessage(3, message, items);
  }

  private async _showMessage(severity: number, message: string, items: any[]): Promise<any> {
    const stringItems = items.map((i) => (typeof i === 'string' ? i : i.title || String(i)));
    const selected = await this._rpc.sendRequest('window/showMessage', {
      severity,
      message,
      items: stringItems,
    });
    return selected;
  }

  async showQuickPick(items: any[] | Promise<any[]>, options?: any): Promise<any> {
    const resolvedItems = await items;
    const formatted = resolvedItems.map((item) => {
      if (typeof item === 'string') return { label: item };
      return item;
    });

    const chosen = await this._rpc.sendRequest('window/showQuickPick', {
      items: formatted,
      options,
    });

    if (chosen === null || chosen === undefined) return undefined;
    if (typeof resolvedItems[0] === 'string') {
      return typeof chosen === 'object' ? chosen.label : chosen;
    }
    return chosen;
  }

  async showInputBox(options?: any): Promise<string | undefined> {
    return this._rpc.sendRequest('window/showInputBox', { options });
  }

  async withProgress<R>(options: { location: ProgressLocation; title?: string; cancellable?: boolean }, task: (progress: any, token: CancellationToken) => Promise<R>): Promise<R> {
    const cts = new CancellationTokenSource();
    const progress = {
      report: (value: { message?: string; increment?: number }) => {
        this._rpc.sendNotification('window/reportProgress', { ...value, title: options.title });
      },
    };
    return task(progress, cts.token);
  }

  createOutputChannel(name: string, options?: any): ExtHostOutputChannel {
    return new ExtHostOutputChannel(name, this._rpc);
  }

  createStatusBarItem(idOrAlignment?: string | StatusBarAlignment, alignmentOrPriority?: StatusBarAlignment | number, priority?: number): ExtHostStatusBarItem {
    let id = `status_${this._statusBarCounter++}`;
    let align = StatusBarAlignment.Left;
    let prio = 0;

    if (typeof idOrAlignment === 'string') {
      id = idOrAlignment;
      if (typeof alignmentOrPriority === 'number') align = alignmentOrPriority;
      if (typeof priority === 'number') prio = priority;
    } else if (typeof idOrAlignment === 'number') {
      align = idOrAlignment;
      if (typeof alignmentOrPriority === 'number') prio = alignmentOrPriority;
    }

    return new ExtHostStatusBarItem(id, align, prio, this._rpc);
  }

  registerTreeDataProvider(viewId: string, provider: any): Disposable {
    this._treeViewProviders.set(viewId, provider);
    this._rpc.sendNotification('window/registerTreeView', { viewId });
    return new Disposable(() => {
      this._treeViewProviders.delete(viewId);
      this._treeViewElements.delete(viewId);
    });
  }

  createTreeView(viewId: string, options: any): any {
    this.registerTreeDataProvider(viewId, options.treeDataProvider);
    return {
      title: options.title || viewId,
      description: undefined,
      badge: undefined,
      visible: true,
      selection: [],
      onDidChangeSelection: new EventEmitter<any>().event,
      onDidCollapseElement: new EventEmitter<any>().event,
      onDidExpandElement: new EventEmitter<any>().event,
      onDidChangeVisibility: new EventEmitter<any>().event,
      onDidChangeCheckboxState: new EventEmitter<any>().event,
      reveal: async () => {},
      dispose: () => {},
    };
  }

  async getTreeItemChildren(viewId: string, elementId?: string): Promise<any[]> {
    const provider = this._treeViewProviders.get(viewId);
    if (!provider) return [];

    let viewElements = this._treeViewElements.get(viewId);
    if (!viewElements) {
      viewElements = new Map();
      this._treeViewElements.set(viewId, viewElements);
    }

    const parentElement = elementId ? viewElements.get(elementId) : undefined;
    try {
      const children = await provider.getChildren(parentElement);
      if (!children || !Array.isArray(children)) return [];

      return await Promise.all(
        children.map(async (c: any, index: number) => {
          let item = c;
          if (provider.getTreeItem) {
            try {
              item = await provider.getTreeItem(c);
            } catch (err) {
              console.warn(`[ext-host] error in getTreeItem for view ${viewId}:`, err);
            }
          }
          const id = item?.id || (typeof c === 'string' ? c : `${elementId || 'root'}_${index}`);
          viewElements!.set(id, c);

          let label = '';
          if (typeof item?.label === 'string') {
            label = item.label;
          } else if (item?.label && typeof item.label.label === 'string') {
            label = item.label.label;
          } else if (typeof c === 'string') {
            label = c;
          } else if (c?.label) {
            label = typeof c.label === 'string' ? c.label : c.label.label || String(c.label);
          } else {
            label = String(item || '');
          }

          let tooltip: string | undefined = undefined;
          if (typeof item?.tooltip === 'string') {
            tooltip = item.tooltip;
          } else if (item?.tooltip?.value) {
            tooltip = item.tooltip.value;
          }

          let icon: string | undefined = undefined;
          if (typeof item?.iconPath === 'string') {
            icon = item.iconPath;
          } else if (item?.iconPath?.id) {
            icon = item.iconPath.id;
          } else if (item?.iconPath?.dark) {
            icon = typeof item.iconPath.dark === 'string' ? item.iconPath.dark : item.iconPath.dark.path || item.iconPath.dark.fsPath;
          }

          return {
            id,
            label,
            description: typeof item?.description === 'string' ? item.description : undefined,
            tooltip,
            icon,
            collapsibleState: item?.collapsibleState ?? 0,
            command: item?.command,
            contextValue: item?.contextValue,
          };
        })
      );
    } catch (e) {
      console.warn(`[ext-host] getChildren failed for view ${viewId}:`, e);
      return [];
    }
  }

  createWebviewPanel(viewType: string, title: string, showOptions: any, options: any): ExtHostWebviewPanel {
    const panelId = `webview_${this._panelCounter++}`;
    const panel = new ExtHostWebviewPanel(viewType, title, panelId, options, this._rpc);
    this._webviewPanels.set(panelId, panel);

    this._rpc.sendNotification('window/createWebviewPanel', {
      panelId,
      viewType,
      title,
      showOptions,
      options,
    });

    return panel;
  }

  readonly state = { focused: true };
  private _onDidChangeWindowStateEmitter = new EventEmitter<{ focused: boolean }>();
  readonly onDidChangeWindowState = this._onDidChangeWindowStateEmitter.event;

  readonly activeColorTheme = { kind: 2 }; // Dark
  private _onDidChangeActiveColorThemeEmitter = new EventEmitter<any>();
  readonly onDidChangeActiveColorTheme = this._onDidChangeActiveColorThemeEmitter.event;

  readonly tabGroups = {
    all: [],
    activeTabGroup: undefined,
    onDidChangeTabGroups: new EventEmitter<any>().event,
    onDidChangeTabs: new EventEmitter<any>().event,
  };

  readonly activeNotebookEditor: any = undefined;
  readonly visibleNotebookEditors: any[] = [];
  private _onDidChangeActiveNotebookEditorEmitter = new EventEmitter<any>();
  readonly onDidChangeActiveNotebookEditor = this._onDidChangeActiveNotebookEditorEmitter.event;
  private _onDidChangeVisibleNotebookEditorsEmitter = new EventEmitter<any[]>();
  readonly onDidChangeVisibleNotebookEditors = this._onDidChangeVisibleNotebookEditorsEmitter.event;
  private _onDidChangeNotebookEditorSelectionEmitter = new EventEmitter<any>();
  readonly onDidChangeNotebookEditorSelection = this._onDidChangeNotebookEditorSelectionEmitter.event;
  private _onDidChangeNotebookEditorVisibleRangesEmitter = new EventEmitter<any>();
  readonly onDidChangeNotebookEditorVisibleRanges = this._onDidChangeNotebookEditorVisibleRangesEmitter.event;

  async showNotebookDocument(document: any, options?: any): Promise<any> {
    return {};
  }

  setStatusBarMessage(text: string, hideAfterTimeout?: number | Promise<any>): Disposable {
    return new Disposable(() => {});
  }

  readonly activeTerminal: any = undefined;
  readonly terminals: any[] = [];
  private _onDidChangeActiveTerminalEmitter = new EventEmitter<any>();
  readonly onDidChangeActiveTerminal = this._onDidChangeActiveTerminalEmitter.event;

  private _onDidOpenTerminalEmitter = new EventEmitter<any>();
  readonly onDidOpenTerminal = this._onDidOpenTerminalEmitter.event;

  private _onDidCloseTerminalEmitter = new EventEmitter<any>();
  readonly onDidCloseTerminal = this._onDidCloseTerminalEmitter.event;

  private _onDidChangeTerminalShellIntegrationEmitter = new EventEmitter<any>();
  readonly onDidChangeTerminalShellIntegration = this._onDidChangeTerminalShellIntegrationEmitter.event;

  private _onDidChangeTerminalStateEmitter = new EventEmitter<any>();
  readonly onDidChangeTerminalState = this._onDidChangeTerminalStateEmitter.event;

  private _onDidExecuteTerminalCommandEmitter = new EventEmitter<any>();
  readonly onDidExecuteTerminalCommand = this._onDidExecuteTerminalCommandEmitter.event;

  createTerminal(nameOrOptions?: string | any, shellPath?: string, shellArgs?: string[] | string): any {
    const name = typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name || 'Terminal';
    const term = {
      name,
      processId: Promise.resolve(undefined),
      creationOptions: typeof nameOrOptions === 'object' ? nameOrOptions : { name, shellPath, shellArgs },
      exitStatus: undefined,
      state: { isInteractedWith: true },
      sendText: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
    };
    return term;
  }

  registerUriHandler(handler: any): Disposable {
    return new Disposable(() => {});
  }

  registerTerminalLinkProvider(provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerTerminalProfileProvider(id: string, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerFileDecorationProvider(provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerCustomEditorProvider(viewType: string, provider: any, options?: any): Disposable {
    return new Disposable(() => {});
  }

  registerWebviewPanelSerializer(viewType: string, serializer: any): Disposable {
    return new Disposable(() => {});
  }

  registerWebviewViewProvider(viewId: string, provider: any, options?: any): Disposable {
    this._webviewViewProviders.set(viewId, provider);
    this._rpc.sendNotification('window/registerWebviewView', { viewId });
    return new Disposable(() => {
      this._webviewViewProviders.delete(viewId);
    });
  }

  async resolveWebviewView(viewId: string, panelId: string): Promise<{ success: boolean; html?: string }> {
    const provider = this._webviewViewProviders.get(viewId);
    if (!provider) {
      console.warn(`[ext-host] no webview view provider registered for ${viewId}`);
      return { success: false };
    }
    const existing = this._webviews.get(panelId);
    if (existing && existing.html) {
      return { success: true, html: existing.html };
    }
    const webview = existing || new ExtHostWebview(panelId, this._rpc);
    this._webviews.set(panelId, webview);
    const webviewView = {
      viewType: viewId,
      webview,
      title: '',
      description: '',
      badge: undefined,
      visible: true,
      show: (preserveFocus?: boolean) => {},
      onDidChangeVisibility: new EventEmitter<any>().event,
      onDidDispose: new EventEmitter<any>().event,
    };
    try {
      await provider.resolveWebviewView(
        webviewView,
        {},
        { isCancellationRequested: false, onCancellationRequested: new EventEmitter().event }
      );
      return { success: true, html: webview.html };
    } catch (e) {
      console.warn(`[ext-host] resolveWebviewView failed for ${viewId}:`, e);
      return { success: false };
    }
  }

  handleWebviewMessage(panelId: string, message: any): void {
    const revived = reviveBytes(message);
    const panel = this._webviewPanels.get(panelId);
    if (panel) {
      panel.handleMessageReceived(revived);
      return;
    }
    const webview = this._webviews.get(panelId);
    if (webview) {
      webview.handleMessageReceived(revived);
    }
  }
}
