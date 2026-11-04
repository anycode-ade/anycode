import * as fs from 'fs';
import * as path from 'path';
import {
  CancellationToken,
  ConfigurationTarget,
  Disposable,
  EventEmitter,
  Position,
  Range,
  TextEdit,
  Uri,
  WorkspaceEdit,
} from './types';
import type { RpcConnection } from '../rpc';

export interface TextLine {
  readonly lineNumber: number;
  readonly text: string;
  readonly range: Range;
  readonly rangeIncludingLineBreak: Range;
  readonly firstNonWhitespaceCharacterIndex: number;
  readonly isEmptyOrWhitespace: boolean;
}

export class ExtHostTextDocument {
  readonly uri: Uri;
  readonly fileName: string;
  readonly languageId: string;
  version: number;
  private _text: string;
  private _lines: string[] = [];
  private _lineOffsets: number[] = [];

  constructor(uri: Uri, languageId: string, version: number, text: string) {
    this.uri = uri;
    this.fileName = uri.fsPath;
    this.languageId = languageId;
    this.version = version;
    this._text = text;
    this._buildLines();
  }

  get isUntitled(): boolean {
    return this.uri.scheme === 'untitled';
  }

  get isClosed(): boolean {
    return false;
  }

  get isDirty(): boolean {
    return false;
  }

  get lineCount(): number {
    return this._lines.length;
  }

  private _buildLines(): void {
    this._lines = this._text.split(/\r?\n/);
    this._lineOffsets = [0];
    let offset = 0;
    for (let i = 0; i < this._lines.length - 1; i++) {
      offset += this._lines[i].length + 1; // approximation
      this._lineOffsets.push(offset);
    }
  }

  updateText(newText: string, version: number): void {
    this._text = newText;
    this.version = version;
    this._buildLines();
  }

  getText(range?: Range): string {
    if (!range) return this._text;
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    return this._text.substring(start, end);
  }

  lineAt(lineOrPos: number | Position): TextLine {
    const lineNum = typeof lineOrPos === 'number' ? lineOrPos : lineOrPos.line;
    if (lineNum < 0 || lineNum >= this._lines.length) {
      throw new Error(`Line ${lineNum} out of bounds`);
    }
    const lineText = this._lines[lineNum];
    const range = new Range(lineNum, 0, lineNum, lineText.length);
    const rangeIncludingLineBreak = new Range(lineNum, 0, lineNum + 1, 0);
    const firstNonWs = lineText.search(/\S/);

    return {
      lineNumber: lineNum,
      text: lineText,
      range,
      rangeIncludingLineBreak,
      firstNonWhitespaceCharacterIndex: firstNonWs === -1 ? lineText.length : firstNonWs,
      isEmptyOrWhitespace: firstNonWs === -1,
    };
  }

  offsetAt(position: Position): number {
    let offset = 0;
    for (let l = 0; l < Math.min(position.line, this._lines.length); l++) {
      offset += this._lines[l].length + 1;
    }
    offset += position.character;
    return Math.min(offset, this._text.length);
  }

  positionAt(offset: number): Position {
    let cur = 0;
    for (let l = 0; l < this._lines.length; l++) {
      const len = this._lines[l].length + 1;
      if (cur + len > offset) {
        return new Position(l, Math.max(0, offset - cur));
      }
      cur += len;
    }
    return new Position(this._lines.length - 1, (this._lines[this._lines.length - 1] || '').length);
  }

  getWordRangeAtPosition(position: Position, regex = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g): Range | undefined {
    const line = this.lineAt(position);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line.text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start <= position.character && position.character <= end) {
        return new Range(position.line, start, position.line, end);
      }
    }
    return undefined;
  }

  validateRange(range: Range): Range {
    const start = this.validatePosition(range.start);
    const end = this.validatePosition(range.end);
    return new Range(start, end);
  }

  validatePosition(position: Position): Position {
    const line = Math.max(0, Math.min(position.line, this._lines.length - 1));
    const maxChar = (this._lines[line] || '').length;
    const char = Math.max(0, Math.min(position.character, maxChar));
    return new Position(line, char);
  }
}

export interface WorkspaceFolder {
  readonly uri: Uri;
  readonly name: string;
  readonly index: number;
}

export class ExtHostWorkspace {
  private _documents = new Map<string, ExtHostTextDocument>();
  private _folders: WorkspaceFolder[] = [];
  private _configuration: Record<string, any> = {};
  private _defaultConfiguration: Record<string, any> = {};

  setDefaultConfiguration(key: string, value: any): void {
    this._defaultConfiguration[key] = value;
  }

  readonly onDidOpenTextDocumentEmitter = new EventEmitter<ExtHostTextDocument>();
  readonly onDidOpenTextDocument = this.onDidOpenTextDocumentEmitter.event;

  readonly onDidChangeTextDocumentEmitter = new EventEmitter<{
    document: ExtHostTextDocument;
    contentChanges: Array<{ range: Range; rangeOffset: number; rangeLength: number; text: string }>;
  }>();
  readonly onDidChangeTextDocument = this.onDidChangeTextDocumentEmitter.event;

  readonly onDidSaveTextDocumentEmitter = new EventEmitter<ExtHostTextDocument>();
  readonly onDidSaveTextDocument = this.onDidSaveTextDocumentEmitter.event;

  readonly onDidCloseTextDocumentEmitter = new EventEmitter<ExtHostTextDocument>();
  readonly onDidCloseTextDocument = this.onDidCloseTextDocumentEmitter.event;

  readonly notebookDocuments: any[] = [];
  readonly onDidOpenNotebookDocumentEmitter = new EventEmitter<any>();
  readonly onDidOpenNotebookDocument = this.onDidOpenNotebookDocumentEmitter.event;
  readonly onDidCloseNotebookDocumentEmitter = new EventEmitter<any>();
  readonly onDidCloseNotebookDocument = this.onDidCloseNotebookDocumentEmitter.event;
  readonly onDidSaveNotebookDocumentEmitter = new EventEmitter<any>();
  readonly onDidSaveNotebookDocument = this.onDidSaveNotebookDocumentEmitter.event;
  readonly onDidChangeNotebookDocumentEmitter = new EventEmitter<any>();
  readonly onDidChangeNotebookDocument = this.onDidChangeNotebookDocumentEmitter.event;

  readonly isTrusted = true;
  private _onDidGrantWorkspaceTrustEmitter = new EventEmitter<void>();
  readonly onDidGrantWorkspaceTrust = this._onDidGrantWorkspaceTrustEmitter.event;

  readonly onDidChangeConfigurationEmitter = new EventEmitter<any>();
  readonly onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;

  readonly onDidChangeWorkspaceFoldersEmitter = new EventEmitter<{ added: WorkspaceFolder[]; removed: WorkspaceFolder[] }>();
  readonly onDidChangeWorkspaceFolders = this.onDidChangeWorkspaceFoldersEmitter.event;

  constructor(private _rpc: RpcConnection) {}

  get rootPath(): string | undefined {
    return this._folders[0]?.uri.fsPath;
  }

  get name(): string | undefined {
    return this._folders[0]?.name;
  }

  get workspaceFolders(): WorkspaceFolder[] {
    return this._folders.slice();
  }

  setWorkspaceRoot(rootPath: string): void {
    const uri = Uri.file(rootPath);
    const folder: WorkspaceFolder = {
      uri,
      name: path.basename(rootPath),
      index: 0,
    };
    const prev = this._folders;
    this._folders = [folder];
    this.onDidChangeWorkspaceFoldersEmitter.fire({ added: [folder], removed: prev });
  }

  getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
    const target = uri.fsPath;
    return this._folders.find((f) => target.startsWith(f.uri.fsPath));
  }

  get textDocuments(): ExtHostTextDocument[] {
    return Array.from(this._documents.values());
  }

  getDocument(uri: Uri | string): ExtHostTextDocument | undefined {
    const key = typeof uri === 'string' ? uri : uri.toString();
    return this._documents.get(key);
  }

  async openTextDocument(uriOrFileNameOrOptions: any): Promise<ExtHostTextDocument> {
    let uri: Uri;
    if (typeof uriOrFileNameOrOptions === 'string') {
      uri = Uri.file(uriOrFileNameOrOptions);
    } else if (uriOrFileNameOrOptions instanceof Uri) {
      uri = uriOrFileNameOrOptions;
    } else if (uriOrFileNameOrOptions?.language) {
      uri = Uri.parse(`untitled:Untitled-${Date.now()}`);
      const doc = new ExtHostTextDocument(uri, uriOrFileNameOrOptions.language, 1, uriOrFileNameOrOptions.content || '');
      this._documents.set(uri.toString(), doc);
      this.onDidOpenTextDocumentEmitter.fire(doc);
      return doc;
    } else {
      throw new Error('Unsupported openTextDocument parameter');
    }

    const existing = this.getDocument(uri);
    if (existing) return existing;

    const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
    const ext = path.extname(uri.fsPath).replace(/^\./, '');
    const doc = new ExtHostTextDocument(uri, ext, 1, content);
    this._documents.set(uri.toString(), doc);
    this.onDidOpenTextDocumentEmitter.fire(doc);
    return doc;
  }

  handleDocumentOpened(uriStr: string, languageId: string, version: number, text: string): ExtHostTextDocument {
    const uri = Uri.parse(uriStr);
    const doc = new ExtHostTextDocument(uri, languageId, version, text);
    this._documents.set(uriStr, doc);
    this.onDidOpenTextDocumentEmitter.fire(doc);
    return doc;
  }

  handleDocumentChanged(uriStr: string, version: number, changes: Array<{ range: Range; rangeOffset: number; rangeLength: number; text: string }>, fullText?: string): void {
    const doc = this._documents.get(uriStr);
    if (doc) {
      if (fullText !== undefined) {
        doc.updateText(fullText, version);
      }
      this.onDidChangeTextDocumentEmitter.fire({ document: doc, contentChanges: changes });
    }
  }

  handleDocumentSaved(uriStr: string): void {
    const doc = this._documents.get(uriStr);
    if (doc) {
      this.onDidSaveTextDocumentEmitter.fire(doc);
    }
  }

  handleDocumentClosed(uriStr: string): void {
    const doc = this._documents.get(uriStr);
    if (doc) {
      this._documents.delete(uriStr);
      this.onDidCloseTextDocumentEmitter.fire(doc);
    }
  }

  getConfiguration(section?: string, scope?: any): any {
    const config = this._configuration;
    const defaults = this._defaultConfiguration;

    const getValue = (fullKey: string) => {
      if (config[fullKey] !== undefined) return config[fullKey];
      if (defaults[fullKey] !== undefined) return defaults[fullKey];

      const prefix = fullKey + '.';
      const nested: Record<string, any> = {};
      let found = false;

      for (const [k, v] of Object.entries(defaults)) {
        if (k.startsWith(prefix)) {
          found = true;
          setNestedValue(nested, k.slice(prefix.length), v);
        }
      }
      for (const [k, v] of Object.entries(config)) {
        if (k.startsWith(prefix)) {
          found = true;
          setNestedValue(nested, k.slice(prefix.length), v);
        }
      }

      return found ? nested : undefined;
    };

    return {
      get: <T>(key: string, defaultValue?: T): T => {
        const fullKey = section ? `${section}.${key}` : key;
        const val = getValue(fullKey) ?? getValue(key);
        return val !== undefined ? val : (defaultValue as T);
      },
      has: (key: string): boolean => {
        const fullKey = section ? `${section}.${key}` : key;
        return getValue(fullKey) !== undefined || getValue(key) !== undefined;
      },
      inspect: <T>(key: string) => {
        const fullKey = section ? `${section}.${key}` : key;
        const val = getValue(fullKey) ?? getValue(key);
        const def = defaults[fullKey] ?? defaults[key];
        return {
          key: fullKey,
          defaultValue: def,
          globalValue: val,
          workspaceValue: val,
          workspaceFolderValue: undefined,
        };
      },
      update: async (key: string, value: any, target?: ConfigurationTarget): Promise<void> => {
        const fullKey = section ? `${section}.${key}` : key;
        config[fullKey] = value;
        this.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: (s: string) => s === fullKey || s === section });
      },
    };
  }

  updateConfiguration(values: Record<string, any>): void {
    Object.assign(this._configuration, values);
    this.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: () => true });
  }

  async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    const entries = edit.entries();
    const serialized = entries.map(([uri, edits]) => ({
      uri: uri.toString(),
      edits: edits.map((e) => ({
        range: {
          start: { line: e.range.start.line, character: e.range.start.character },
          end: { line: e.range.end.line, character: e.range.end.character },
        },
        newText: e.newText,
      })),
    }));

    try {
      await this._rpc.sendRequest('workspace/applyEdit', { edits: serialized });
      return true;
    } catch {
      return false;
    }
  }

  createFileSystemWatcher(globPattern: any): any {
    const onDidCreate = new EventEmitter<Uri>();
    const onDidChange = new EventEmitter<Uri>();
    const onDidDelete = new EventEmitter<Uri>();

    return {
      onDidCreate: onDidCreate.event,
      onDidChange: onDidChange.event,
      onDidDelete: onDidDelete.event,
      dispose: () => {
        onDidCreate.dispose();
        onDidChange.dispose();
        onDidDelete.dispose();
      },
    };
  }

  asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string {
    let p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
    if (this._folders.length > 0) {
      const root = this._folders[0].uri.fsPath;
      if (p.startsWith(root)) {
        return path.relative(root, p);
      }
    }
    return p;
  }

  readonly onWillSaveTextDocumentEmitter = new EventEmitter<any>();
  readonly onWillSaveTextDocument = this.onWillSaveTextDocumentEmitter.event;

  readonly onDidCreateFilesEmitter = new EventEmitter<any>();
  readonly onDidCreateFiles = this.onDidCreateFilesEmitter.event;

  readonly onDidDeleteFilesEmitter = new EventEmitter<any>();
  readonly onDidDeleteFiles = this.onDidDeleteFilesEmitter.event;

  readonly onDidRenameFilesEmitter = new EventEmitter<any>();
  readonly onDidRenameFiles = this.onDidRenameFilesEmitter.event;

  readonly onWillCreateFilesEmitter = new EventEmitter<any>();
  readonly onWillCreateFiles = this.onWillCreateFilesEmitter.event;

  readonly onWillDeleteFilesEmitter = new EventEmitter<any>();
  readonly onWillDeleteFiles = this.onWillDeleteFilesEmitter.event;

  readonly onWillRenameFilesEmitter = new EventEmitter<any>();
  readonly onWillRenameFiles = this.onWillRenameFilesEmitter.event;

  registerFileSystemProvider(scheme: string, provider: any, options?: any): Disposable {
    return new Disposable(() => {});
  }

  registerResourceLabelFormatter(formatter: any): Disposable {
    return new Disposable(() => {});
  }

  async openNotebookDocument(uriOrType?: any, content?: any): Promise<any> {
    return { uri: uriOrType, notebookType: 'default', version: 1, cells: [] };
  }

  registerTextDocumentContentProvider(scheme: string, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerTaskProvider(type: string, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerNotebookSerializer(notebookType: string, serializer: any, options?: any): Disposable {
    return new Disposable(() => {});
  }

  async findFiles(include: string, exclude?: string, maxResults?: number, token?: CancellationToken): Promise<Uri[]> {
    try {
      const res: string[] = await this._rpc.sendRequest('workspace/findFiles', { include, exclude, maxResults });
      return res.map((p) => Uri.file(p));
    } catch {
      return [];
    }
  }

  readonly fs = {
    stat: async (uri: Uri) => {
      const stat = await fs.promises.stat(uri.fsPath);
      return {
        type: stat.isDirectory() ? 2 : stat.isFile() ? 1 : 0,
        ctime: stat.ctimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    },
    readFile: async (uri: Uri) => {
      return new Uint8Array(await fs.promises.readFile(uri.fsPath));
    },
    writeFile: async (uri: Uri, content: Uint8Array) => {
      await fs.promises.writeFile(uri.fsPath, content);
    },
    delete: async (uri: Uri, options?: { recursive?: boolean }) => {
      await fs.promises.rm(uri.fsPath, { recursive: options?.recursive });
    },
    rename: async (source: Uri, target: Uri, options?: { overwrite?: boolean }) => {
      await fs.promises.rename(source.fsPath, target.fsPath);
    },
    copy: async (source: Uri, target: Uri, options?: { overwrite?: boolean }) => {
      await fs.promises.copyFile(source.fsPath, target.fsPath);
    },
    readDirectory: async (uri: Uri): Promise<[string, number][]> => {
      const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((e) => [e.name, e.isDirectory() ? 2 : 1]);
    },
    createDirectory: async (uri: Uri) => {
      await fs.promises.mkdir(uri.fsPath, { recursive: true });
    },
  };
}

function setNestedValue(obj: Record<string, any>, pathStr: string, value: any): void {
  const parts = pathStr.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!curr[p] || typeof curr[p] !== 'object') {
      curr[p] = {};
    }
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = value;
}
