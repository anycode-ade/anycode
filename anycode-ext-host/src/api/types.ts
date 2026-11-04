// VS Code API Types Implementation

export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(
    schemeOrComponents: string | { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string },
    authority = '',
    path = '',
    query = '',
    fragment = ''
  ) {
    if (typeof schemeOrComponents === 'object' && schemeOrComponents !== null) {
      this.scheme = schemeOrComponents.scheme || '';
      this.authority = schemeOrComponents.authority || '';
      this.path = schemeOrComponents.path || '';
      this.query = schemeOrComponents.query || '';
      this.fragment = schemeOrComponents.fragment || '';
    } else {
      this.scheme = schemeOrComponents || '';
      this.authority = authority;
      this.path = path;
      this.query = query;
      this.fragment = fragment;
    }
  }

  get fsPath(): string {
    if (this.scheme === 'file') {
      let p = this.path;
      // On Windows /C:/... -> C:/...
      if (process.platform === 'win32' && p.startsWith('/') && p.length > 2 && p[2] === ':') {
        p = p.slice(1);
      }
      return p;
    }
    return this.path;
  }

  static file(path: string): Uri {
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/') && !normalized.includes(':')) {
      normalized = '/' + normalized;
    }
    return new Uri('file', '', normalized);
  }

  static parse(value: string, strict = false): Uri {
    try {
      const parsed = new URL(value);
      return new Uri(
        parsed.protocol.replace(/:$/, ''),
        parsed.host,
        decodeURIComponent(parsed.pathname),
        parsed.search.replace(/^\?/, ''),
        parsed.hash.replace(/^#/, '')
      );
    } catch {
      if (value.startsWith('file://')) {
        return Uri.file(value.slice(7));
      }
      return new Uri('file', '', value);
    }
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    let p = base.path;
    for (const segment of pathSegments) {
      if (!p.endsWith('/')) p += '/';
      p += segment.replace(/^\/+/, '');
    }
    return new Uri(base.scheme, base.authority, p, base.query, base.fragment);
  }

  static from(components: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      components.scheme,
      components.authority || '',
      components.path || '',
      components.query || '',
      components.fragment || ''
    );
  }

  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  toString(skipEncoding = false): string {
    if (this.scheme === 'file') {
      return `file://${this.path}`;
    }
    return `${this.scheme}://${this.authority}${this.path}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`;
  }

  toJSON(): any {
    return {
      $mid: 1,
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
      fsPath: this.fsPath,
      external: this.toString()
    };
  }
}

export class RelativePattern {
  baseUri: Uri;
  base: string;
  pattern: string;

  constructor(base: any, pattern: string) {
    if (typeof base === 'string') {
      this.base = base;
      this.baseUri = Uri.file(base);
    } else if (base && 'uri' in base) {
      this.baseUri = base.uri;
      this.base = base.uri.fsPath || base.uri.path;
    } else if (base && 'fsPath' in base) {
      this.baseUri = base;
      this.base = base.fsPath;
    } else {
      this.baseUri = Uri.file(String(base || ''));
      this.base = String(base || '');
    }
    this.pattern = pattern;
  }
}

export enum TaskScope {
  Folder = 1,
  Global = 2,
  Workspace = 3,
}

export class ShellExecution {
  commandLine?: string;
  command?: any;
  args?: any[];
  options?: any;

  constructor(commandLineOrCommand: any, argsOrOptions?: any, options?: any) {
    if (typeof commandLineOrCommand === 'string' && !argsOrOptions) {
      this.commandLine = commandLineOrCommand;
    } else {
      this.command = commandLineOrCommand;
      this.args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
      this.options = options || (Array.isArray(argsOrOptions) ? undefined : argsOrOptions);
    }
  }
}

export class ProcessExecution {
  process: string;
  args: string[];
  options?: any;

  constructor(process: string, argsOrOptions?: any, options?: any) {
    this.process = process;
    this.args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    this.options = options || (Array.isArray(argsOrOptions) ? undefined : argsOrOptions);
  }
}

export class CustomExecution {
  constructor(public callback: (resolvedDefinition: any) => Promise<any> | any) {}
}

export class Task {
  definition: any;
  scope?: any;
  name: string;
  source: string;
  execution?: any;
  problemMatchers: string[];
  isBackground: boolean;
  presentationOptions: any;
  group?: any;
  runOptions: any;
  detail?: string;

  constructor(
    definition: any,
    scope: any,
    name: string,
    source: string,
    execution?: any,
    problemMatchers?: string | string[]
  ) {
    this.definition = definition;
    this.scope = scope;
    this.name = name;
    this.source = source;
    this.execution = execution;
    this.problemMatchers = Array.isArray(problemMatchers) ? problemMatchers : problemMatchers ? [problemMatchers] : [];
    this.isBackground = false;
    this.presentationOptions = {};
    this.runOptions = {};
  }
}

export class Position {
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = Math.max(0, line);
    this.character = Math.max(0, character);
  }

  isBefore(other: Position): boolean {
    if (this.line < other.line) return true;
    if (this.line > other.line) return false;
    return this.character < other.character;
  }

  isBeforeOrEqual(other: Position): boolean {
    if (this.line < other.line) return true;
    if (this.line > other.line) return false;
    return this.character <= other.character;
  }

  isAfter(other: Position): boolean {
    return !this.isBeforeOrEqual(other);
  }

  isAfterOrEqual(other: Position): boolean {
    return !this.isBefore(other);
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  compareTo(other: Position): number {
    if (this.line < other.line) return -1;
    if (this.line > other.line) return 1;
    if (this.character < other.character) return -1;
    if (this.character > other.character) return 1;
    return 0;
  }

  translate(lineDelta = 0, characterDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }

  with(line?: number, character?: number): Position {
    return new Position(line ?? this.line, character ?? this.character);
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(
    startOrStartLine: Position | number,
    endOrStartChar: Position | number,
    endLine?: number,
    endCharacter?: number
  ) {
    if (startOrStartLine instanceof Position && endOrStartChar instanceof Position) {
      if (startOrStartLine.isBefore(endOrStartChar)) {
        this.start = startOrStartLine;
        this.end = endOrStartChar;
      } else {
        this.start = endOrStartChar;
        this.end = startOrStartLine;
      }
    } else {
      const p1 = new Position(startOrStartLine as number, endOrStartChar as number);
      const p2 = new Position(endLine as number, endCharacter as number);
      if (p1.isBefore(p2)) {
        this.start = p1;
        this.end = p2;
      } else {
        this.start = p2;
        this.end = p1;
      }
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      if (positionOrRange.isBefore(this.start)) return false;
      if (positionOrRange.isAfter(this.end)) return false;
      return true;
    }
    return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
  }

  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }

  intersection(other: Range): Range | undefined {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    if (start.isAfter(end)) return undefined;
    return new Range(start, end);
  }

  union(other: Range): Range {
    const start = this.start.isBefore(other.start) ? this.start : other.start;
    const end = this.end.isAfter(other.end) ? this.end : other.end;
    return new Range(start, end);
  }

  with(start?: Position, end?: Position): Range {
    return new Range(start ?? this.start, end ?? this.end);
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position);
  constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number);
  constructor(
    anchorOrLine: Position | number,
    activeOrChar: Position | number,
    activeLine?: number,
    activeCharacter?: number
  ) {
    let anchor: Position;
    let active: Position;

    if (anchorOrLine instanceof Position && activeOrChar instanceof Position) {
      anchor = anchorOrLine;
      active = activeOrChar;
    } else {
      anchor = new Position(anchorOrLine as number, activeOrChar as number);
      active = new Position(activeLine as number, activeCharacter as number);
    }

    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }

  get isReversed(): boolean {
    return this.anchor.isAfter(this.active);
  }
}

export class Location {
  readonly uri: Uri;
  readonly range: Range;

  constructor(uri: Uri, rangeOrPosition: Range | Position) {
    this.uri = uri;
    this.range = rangeOrPosition instanceof Range ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
  }
}

export interface LocationLink {
  originSelectionRange?: Range;
  targetUri: Uri;
  targetRange: Range;
  targetSelectionRange?: Range;
}

export class TextEdit {
  range: Range;
  newText: string;

  constructor(range: Range, newText: string) {
    this.range = range;
    this.newText = newText;
  }

  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }

  static insert(position: Position, newText: string): TextEdit {
    return new TextEdit(new Range(position, position), newText);
  }

  static delete(range: Range): TextEdit {
    return new TextEdit(range, '');
  }
}

export class WorkspaceEdit {
  private _edits: Map<string, TextEdit[]> = new Map();
  private _fileOperations: Array<{ type: 'create' | 'delete' | 'rename'; from?: Uri; to?: Uri }> = [];

  set(uri: Uri, edits: TextEdit[]): void {
    this._edits.set(uri.toString(), edits.slice());
  }

  get(uri: Uri): TextEdit[] {
    return this._edits.get(uri.toString()) || [];
  }

  has(uri: Uri): boolean {
    return this._edits.has(uri.toString());
  }

  replace(uri: Uri, range: Range, newText: string): void {
    this.insertEdit(uri, TextEdit.replace(range, newText));
  }

  insert(uri: Uri, position: Position, newText: string): void {
    this.insertEdit(uri, TextEdit.insert(position, newText));
  }

  delete(uri: Uri, range: Range): void {
    this.insertEdit(uri, TextEdit.delete(range));
  }

  private insertEdit(uri: Uri, edit: TextEdit): void {
    const key = uri.toString();
    const list = this._edits.get(key) || [];
    list.push(edit);
    this._edits.set(key, list);
  }

  entries(): [Uri, TextEdit[]][] {
    const result: [Uri, TextEdit[]][] = [];
    for (const [key, edits] of this._edits.entries()) {
      result.push([Uri.parse(key), edits]);
    }
    return result;
  }

  get size(): number {
    let total = 0;
    for (const list of this._edits.values()) total += list.length;
    return total;
  }

  createFile(uri: Uri): void {
    this._fileOperations.push({ type: 'create', to: uri });
  }

  deleteFile(uri: Uri): void {
    this._fileOperations.push({ type: 'delete', from: uri });
  }

  renameFile(from: Uri, to: Uri): void {
    this._fileOperations.push({ type: 'rename', from, to });
  }
}

export class SnippetString {
  value: string;

  constructor(value = '') {
    this.value = value;
  }

  appendText(string: string): SnippetString {
    this.value += string.replace(/[$}\\]/g, '\\$&');
    return this;
  }

  appendTabstop(number = 0): SnippetString {
    this.value += `$${number}`;
    return this;
  }

  appendPlaceholder(value: string | ((snippet: SnippetString) => any), number?: number): SnippetString {
    if (typeof value === 'function') {
      const nested = new SnippetString();
      value(nested);
      this.value += `\${${number ?? 1}:${nested.value}}`;
    } else {
      this.value += `\${${number ?? 1}:${value}}`;
    }
    return this;
  }

  appendChoice(values: string[], number?: number): SnippetString {
    this.value += `\${${number ?? 1}|${values.join(',')}|}`;
    return this;
  }

  appendVariable(name: string, defaultValue?: string): SnippetString {
    if (defaultValue) {
      this.value += `\${${name}:${defaultValue}}`;
    } else {
      this.value += `\${${name}}`;
    }
    return this;
  }
}

export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;

  constructor(value = '', supportThemeIcons = false) {
    this.value = value;
    this.supportThemeIcons = supportThemeIcons;
  }

  appendText(value: string): MarkdownString {
    this.value += value.replace(/[*_`~\\]/g, '\\$&');
    return this;
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendCodeblock(value: string, language = ''): MarkdownString {
    this.value += `\n\`\`\`${language}\n${value}\n\`\`\`\n`;
    return this;
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  code?: string | number | { value: string | number; target: Uri };
  relatedInformation?: DiagnosticRelatedInformation[];
  tags?: DiagnosticTag[];

  constructor(range: Range, message: string, severity = DiagnosticSeverity.Error) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

export enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Constructor = 3,
  Field = 4,
  Variable = 5,
  Class = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Unit = 10,
  Value = 11,
  Enum = 12,
  Keyword = 13,
  Snippet = 14,
  Color = 15,
  File = 16,
  Reference = 17,
  Folder = 18,
  EnumMember = 19,
  Constant = 20,
  Struct = 21,
  Event = 22,
  Operator = 23,
  TypeParameter = 24,
}

export enum CompletionTriggerKind {
  Invoke = 0,
  TriggerCharacter = 1,
  TriggerForIncompleteCompletions = 2,
}

export class CompletionItem {
  label: string | { label: string; description?: string; detail?: string };
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: string | MarkdownString;
  sortText?: string;
  filterText?: string;
  insertText?: string | SnippetString;
  range?: Range | { inserting: Range; replacing: Range };
  command?: any;

  constructor(label: string | { label: string; description?: string; detail?: string }, kind?: CompletionItemKind) {
    this.label = label;
    this.kind = kind;
  }
}

export class CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];

  constructor(items: CompletionItem[] = [], isIncomplete = false) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
}

export enum InlineCompletionTriggerKind {
  Invoke = 0,
  Automatic = 1,
}

export class InlineCompletionItem {
  insertText: string | SnippetString;
  range?: Range;
  command?: any;

  constructor(insertText: string | SnippetString, range?: Range, command?: any) {
    this.insertText = insertText;
    this.range = range;
    this.command = command;
  }
}

export class InlineCompletionList {
  items: InlineCompletionItem[];

  constructor(items: InlineCompletionItem[] = []) {
    this.items = items;
  }
}

export class Hover {
  contents: (MarkdownString | string)[];
  range?: Range;

  constructor(contents: MarkdownString | string | (MarkdownString | string)[], range?: Range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

export class CodeActionKind {
  private static readonly sep = '.';
  static readonly Empty = new CodeActionKind('');
  static readonly QuickFix = new CodeActionKind('quickfix');
  static readonly Refactor = new CodeActionKind('refactor');
  static readonly RefactorExtract = new CodeActionKind('refactor.extract');
  static readonly RefactorInline = new CodeActionKind('refactor.inline');
  static readonly RefactorRewrite = new CodeActionKind('refactor.rewrite');
  static readonly Source = new CodeActionKind('source');
  static readonly SourceOrganizeImports = new CodeActionKind('source.organizeImports');
  static readonly SourceFixAll = new CodeActionKind('source.fixAll');

  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }

  append(parts: string): CodeActionKind {
    return new CodeActionKind(this.value ? `${this.value}${CodeActionKind.sep}${parts}` : parts);
  }

  contains(other: CodeActionKind): boolean {
    return this.value === other.value || other.value.startsWith(this.value + CodeActionKind.sep);
  }
}

export class CodeAction {
  title: string;
  kind?: CodeActionKind;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: any;

  constructor(title: string, kind?: CodeActionKind) {
    this.title = title;
    this.kind = kind;
  }
}

export class CodeLens {
  range: Range;
  command?: any;
  isResolved: boolean;

  constructor(range: Range, command?: any) {
    this.range = range;
    this.command = command;
    this.isResolved = !!command;
  }
}

export enum DocumentHighlightKind {
  Text = 0,
  Read = 1,
  Write = 2,
}

export class DocumentHighlight {
  range: Range;
  kind: DocumentHighlightKind;

  constructor(range: Range, kind = DocumentHighlightKind.Text) {
    this.range = range;
    this.kind = kind;
  }
}

export enum SymbolKind {
  File = 0,
  Module = 1,
  Namespace = 2,
  Package = 3,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Constructor = 8,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
  String = 14,
  Number = 15,
  Boolean = 16,
  Array = 17,
  Object = 18,
  Key = 19,
  Null = 20,
  EnumMember = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export class DocumentSymbol {
  name: string;
  detail: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children: DocumentSymbol[];

  constructor(name: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    this.children = [];
  }
}

export enum FoldingRangeKind {
  Comment = 1,
  Imports = 2,
  Region = 3,
}

export class FoldingRange {
  start: number;
  end: number;
  kind?: FoldingRangeKind;

  constructor(start: number, end: number, kind?: FoldingRangeKind) {
    this.start = start;
    this.end = end;
    this.kind = kind;
  }
}

export enum InlayHintKind {
  Type = 1,
  Parameter = 2,
}

export class InlayHint {
  position: Position;
  label: string;
  kind?: InlayHintKind;
  tooltip?: string | MarkdownString;
  paddingLeft?: boolean;
  paddingRight?: boolean;

  constructor(position: Position, label: string, kind?: InlayHintKind) {
    this.position = position;
    this.label = label;
    this.kind = kind;
  }
}

export class ThemeColor {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

export class ThemeIcon {
  static readonly File = new ThemeIcon('file');
  static readonly Folder = new ThemeIcon('folder');

  readonly id: string;
  readonly color?: ThemeColor;

  constructor(id: string, color?: ThemeColor) {
    this.id = id;
    this.color = color;
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string | { label: string; highlights?: [number, number][] };
  id?: string;
  iconPath?: string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon;
  description?: string | boolean;
  resourceUri?: Uri;
  tooltip?: string | MarkdownString;
  command?: any;
  collapsibleState?: TreeItemCollapsibleState;
  contextValue?: string;

  constructor(labelOrUri: string | Uri, collapsibleState = TreeItemCollapsibleState.None) {
    if (typeof labelOrUri === 'string') {
      this.label = labelOrUri;
    } else {
      this.resourceUri = labelOrUri;
    }
    this.collapsibleState = collapsibleState;
  }
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum QuickInputButtonLocation {
  Title = 1,
  Input = 2,
}

export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

export enum InputBoxValidationSeverity {
  Info = 1,
  Warning = 2,
  Error = 3,
}

export enum FileChangeType {
  Created = 1,
  Changed = 2,
  Deleted = 3,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum TextEditorSelectionChangeKind {
  Keyboard = 1,
  Mouse = 2,
  Command = 3,
}

export enum OverviewRulerLane {
  Left = 1,
  Center = 2,
  Right = 4,
  Full = 7,
}

export enum DecorationRangeBehavior {
  OpenOpen = 0,
  ClosedClosed = 1,
  OpenClosed = 2,
  ClosedOpen = 3,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

export enum LogLevel {
  Off = 0,
  Trace = 1,
  Debug = 2,
  Info = 3,
  Warning = 4,
  Error = 5,
}

export class Disposable {
  private _callOnDispose?: () => any;

  constructor(callOnDispose?: () => any) {
    this._callOnDispose = callOnDispose;
  }

  dispose(): void {
    if (this._callOnDispose) {
      this._callOnDispose();
      this._callOnDispose = undefined;
    }
  }

  static from(...disposables: { dispose(): any }[]): Disposable {
    return new Disposable(() => {
      for (const d of disposables) {
        if (d && typeof d.dispose === 'function') {
          d.dispose();
        }
      }
    });
  }
}

export class EventEmitter<T = any> {
  private _listeners: ((e: T) => any)[] = [];

  readonly event = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable => {
    const bound = thisArgs ? listener.bind(thisArgs) : listener;
    this._listeners.push(bound);
    const disposable = new Disposable(() => {
      const idx = this._listeners.indexOf(bound);
      if (idx >= 0) this._listeners.splice(idx, 1);
    });
    if (disposables) disposables.push(disposable);
    return disposable;
  };

  fire(data: T): void {
    for (const listener of this._listeners.slice()) {
      try {
        listener(data);
      } catch (err) {
        console.error('EventEmitter error:', err);
      }
    }
  }

  dispose(): void {
    this._listeners = [];
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'CancellationError';
  }
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: (listener: (e: any) => any) => Disposable;
}

export class CancellationTokenSource {
  private _emitter = new EventEmitter<any>();
  private _isCancellationRequested = false;

  get token(): CancellationToken {
    return {
      isCancellationRequested: this._isCancellationRequested,
      onCancellationRequested: this._emitter.event,
    };
  }

  cancel(): void {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this._emitter.fire(undefined);
    }
  }

  dispose(): void {
    this._emitter.dispose();
  }
}

export class TabInputText {
  constructor(readonly uri: Uri) {}
}

export class TabInputTextDiff {
  constructor(readonly original: Uri, readonly modified: Uri) {}
}

export class TabInputCustom {
  constructor(readonly uri: Uri, readonly viewType: string) {}
}

export class TabInputWebview {
  constructor(readonly viewType: string) {}
}

export class TabInputNotebook {
  constructor(readonly uri: Uri, readonly notebookType: string) {}
}

export class TabInputNotebookDiff {
  constructor(readonly original: Uri, readonly modified: Uri, readonly notebookType: string) {}
}

export class TabInputTerminal {
  constructor() {}
}

export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export class NotebookRange {
  constructor(readonly start: number, readonly end: number) {}
  isEmpty(): boolean {
    return this.start === this.end;
  }
}

export class NotebookCellData {
  constructor(
    readonly kind: NotebookCellKind,
    readonly value: string,
    readonly languageId: string
  ) {}
}

export class NotebookData {
  cells: NotebookCellData[];
  constructor(cells: NotebookCellData[] = []) {
    this.cells = cells;
  }
}

export class NotebookEdit {
  static replaceCells(range: NotebookRange, newCells: NotebookCellData[]): NotebookEdit {
    return new NotebookEdit(range, newCells);
  }
  constructor(readonly range: NotebookRange, readonly newCells: NotebookCellData[]) {}
}

export class NotebookCellOutputItem {
  static text(value: string, mime?: string): NotebookCellOutputItem {
    return new NotebookCellOutputItem(new TextEncoder().encode(value), mime || 'text/plain');
  }
  static json(value: any, mime?: string): NotebookCellOutputItem {
    return new NotebookCellOutputItem(new TextEncoder().encode(JSON.stringify(value)), mime || 'application/json');
  }
  static bytes(value: Uint8Array, mime?: string): NotebookCellOutputItem {
    return new NotebookCellOutputItem(value, mime || 'application/octet-stream');
  }
  static error(err: Error): NotebookCellOutputItem {
    return new NotebookCellOutputItem(
      new TextEncoder().encode(JSON.stringify({ name: err?.name || 'Error', message: err?.message || '', stack: err?.stack || '' })),
      'application/vnd.code.notebook.error'
    );
  }
  static stdout(value: string): NotebookCellOutputItem {
    return new NotebookCellOutputItem(new TextEncoder().encode(value), 'application/vnd.code.notebook.stdout');
  }
  static stderr(value: string): NotebookCellOutputItem {
    return new NotebookCellOutputItem(new TextEncoder().encode(value), 'application/vnd.code.notebook.stderr');
  }

  constructor(readonly data: Uint8Array, readonly mime: string) {}
}

export class NotebookCellOutput {
  id: string;
  constructor(readonly items: NotebookCellOutputItem[], readonly metadata?: Record<string, any>) {
    this.id = Math.random().toString(36).substring(2);
  }
}
