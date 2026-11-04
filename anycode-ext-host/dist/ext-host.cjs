"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var path3 = __toESM(require("path"));
var fs3 = __toESM(require("fs"));

// src/logger.ts
var rawStderrWrite = process.stderr.write.bind(process.stderr);
function extHostLog(category, ...args) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(11, 23);
  const formatted = args.map((a) => {
    if (typeof a === "object" && a !== null) {
      try {
        return a.stack || JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  }).join(" ");
  rawStderrWrite(`[ext-host:${category}] ${timestamp} ${formatted}
`);
}

// src/rpc.ts
var RpcConnection = class {
  constructor(_input = process.stdin, _output = process.stdout) {
    this._input = _input;
    this._output = _output;
    this._input.on("data", (chunk) => this._onData(chunk));
    this._input.on("error", (err) => {
      console.warn("[rpc] Input stream error:", err?.message || err);
    });
    this._output.on("error", (err) => {
      console.warn("[rpc] Output stream error:", err?.message || err);
    });
  }
  _nextId = 1;
  _pendingRequests = /* @__PURE__ */ new Map();
  _requestHandlers = /* @__PURE__ */ new Map();
  _notificationHandlers = /* @__PURE__ */ new Map();
  _buffer = Buffer.alloc(0);
  _contentLength = -1;
  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    this._processBuffer();
  }
  _processBuffer() {
    while (true) {
      if (this._contentLength === -1) {
        const headerEnd = this._buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          const newlineIdx = this._buffer.indexOf("\n");
          if (newlineIdx !== -1) {
            const line = this._buffer.slice(0, newlineIdx).toString("utf-8").trim();
            if (line.startsWith("{") && line.endsWith("}")) {
              this._buffer = this._buffer.slice(newlineIdx + 1);
              try {
                this._handleMessage(JSON.parse(line));
              } catch (e) {
                console.error("Error parsing JSON line:", e);
              }
              continue;
            }
          }
          break;
        }
        const headerStr = this._buffer.slice(0, headerEnd).toString("utf-8");
        const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
        if (match) {
          this._contentLength = parseInt(match[1], 10);
        } else {
          console.error("No Content-Length header found in RPC message");
        }
        this._buffer = this._buffer.slice(headerEnd + 4);
      }
      if (this._contentLength !== -1) {
        if (this._buffer.length < this._contentLength) {
          break;
        }
        const bodyBuf = this._buffer.slice(0, this._contentLength);
        this._buffer = this._buffer.slice(this._contentLength);
        this._contentLength = -1;
        try {
          const msg = JSON.parse(bodyBuf.toString("utf-8"));
          this._handleMessage(msg);
        } catch (err) {
          console.error("Failed to parse JSON-RPC message body:", err);
        }
      }
    }
  }
  async _handleMessage(msg) {
    if ("method" in msg) {
      if ("id" in msg && msg.id !== void 0 && msg.id !== null) {
        extHostLog("rpc", `<< REQ [${msg.id}] ${msg.method}`, msg.params);
        const handler = this._requestHandlers.get(msg.method);
        if (!handler) {
          extHostLog("rpc", `!! Method not found: ${msg.method}`);
          this._sendResponse({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32601, message: `Method not found: ${msg.method}` }
          });
          return;
        }
        try {
          const result = await handler(msg.params);
          this._sendResponse({
            jsonrpc: "2.0",
            id: msg.id,
            result: result !== void 0 ? result : null
          });
        } catch (err) {
          extHostLog("rpc", `!! Handler error for ${msg.method}:`, err?.stack || err);
          this._sendResponse({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32e3, message: err?.message || String(err) }
          });
        }
      } else {
        extHostLog("rpc", `<< NOTIFY ${msg.method}`, msg.params);
        const handler = this._notificationHandlers.get(msg.method);
        if (handler) {
          try {
            handler(msg.params);
          } catch (err) {
            extHostLog("rpc", `!! Notification handler error for ${msg.method}:`, err);
          }
        }
      }
    } else if ("id" in msg && ("result" in msg || "error" in msg)) {
      extHostLog("rpc", `<< RESP [${msg.id}]`, msg.error ? `ERR: ${msg.error.message}` : "OK");
      const pending = this._pendingRequests.get(msg.id);
      if (pending) {
        this._pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || "RPC Error"));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }
  sendRequest(method, params) {
    const id = this._nextId++;
    extHostLog("rpc", `>> REQ [${id}] ${method}`, params);
    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
      const msg = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };
      this._write(msg);
    });
  }
  sendNotification(method, params) {
    extHostLog("rpc", `>> NOTIFY ${method}`, params);
    const msg = {
      jsonrpc: "2.0",
      method,
      params
    };
    this._write(msg);
  }
  onRequest(method, handler) {
    this._requestHandlers.set(method, handler);
  }
  onNotification(method, handler) {
    this._notificationHandlers.set(method, handler);
  }
  _sendResponse(resp) {
    this._write(resp);
  }
  _write(msg) {
    try {
      const outputAny = this._output;
      if (outputAny.destroyed || outputAny.writableEnded || typeof outputAny.writable === "boolean" && !outputAny.writable) {
        return;
      }
      const json = JSON.stringify(msg);
      const bodyBuf = Buffer.from(json, "utf-8");
      const header = `Content-Length: ${bodyBuf.length}\r
\r
`;
      this._output.write(header, (err) => {
        if (err) console.warn("[rpc] Write error (header):", err?.message || err);
      });
      this._output.write(bodyBuf, (err) => {
        if (err) console.warn("[rpc] Write error (body):", err?.message || err);
      });
    } catch (e) {
      console.warn("[rpc] Write exception:", e?.message || e);
    }
  }
};

// src/api/workspace.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));

// src/api/types.ts
var types_exports = {};
__export(types_exports, {
  CallHierarchyItem: () => CallHierarchyItem,
  CancellationError: () => CancellationError,
  CancellationTokenSource: () => CancellationTokenSource,
  CodeAction: () => CodeAction,
  CodeActionKind: () => CodeActionKind,
  CodeLens: () => CodeLens,
  CompletionItem: () => CompletionItem,
  CompletionItemKind: () => CompletionItemKind,
  CompletionList: () => CompletionList,
  CompletionTriggerKind: () => CompletionTriggerKind,
  ConfigurationTarget: () => ConfigurationTarget,
  CustomExecution: () => CustomExecution,
  DecorationRangeBehavior: () => DecorationRangeBehavior,
  Diagnostic: () => Diagnostic,
  DiagnosticSeverity: () => DiagnosticSeverity,
  DiagnosticTag: () => DiagnosticTag,
  Disposable: () => Disposable,
  DocumentHighlight: () => DocumentHighlight,
  DocumentHighlightKind: () => DocumentHighlightKind,
  DocumentLink: () => DocumentLink,
  DocumentSymbol: () => DocumentSymbol,
  EventEmitter: () => EventEmitter,
  FileChangeType: () => FileChangeType,
  FileType: () => FileType,
  FoldingRange: () => FoldingRange,
  FoldingRangeKind: () => FoldingRangeKind,
  Hover: () => Hover,
  InlayHint: () => InlayHint,
  InlayHintKind: () => InlayHintKind,
  InlineCompletionItem: () => InlineCompletionItem,
  InlineCompletionList: () => InlineCompletionList,
  InlineCompletionTriggerKind: () => InlineCompletionTriggerKind,
  InputBoxValidationSeverity: () => InputBoxValidationSeverity,
  Location: () => Location,
  LogLevel: () => LogLevel,
  MarkdownString: () => MarkdownString,
  NotebookCellData: () => NotebookCellData,
  NotebookCellKind: () => NotebookCellKind,
  NotebookCellOutput: () => NotebookCellOutput,
  NotebookCellOutputItem: () => NotebookCellOutputItem,
  NotebookData: () => NotebookData,
  NotebookEdit: () => NotebookEdit,
  NotebookRange: () => NotebookRange,
  OverviewRulerLane: () => OverviewRulerLane,
  Position: () => Position,
  ProcessExecution: () => ProcessExecution,
  ProgressLocation: () => ProgressLocation,
  QuickInputButtonLocation: () => QuickInputButtonLocation,
  QuickInputButtons: () => QuickInputButtons,
  QuickPickItemKind: () => QuickPickItemKind,
  Range: () => Range,
  RelativePattern: () => RelativePattern,
  Selection: () => Selection,
  ShellExecution: () => ShellExecution,
  SnippetString: () => SnippetString,
  StatusBarAlignment: () => StatusBarAlignment,
  SymbolInformation: () => SymbolInformation,
  SymbolKind: () => SymbolKind,
  SymbolTag: () => SymbolTag,
  TabInputCustom: () => TabInputCustom,
  TabInputNotebook: () => TabInputNotebook,
  TabInputNotebookDiff: () => TabInputNotebookDiff,
  TabInputTerminal: () => TabInputTerminal,
  TabInputText: () => TabInputText,
  TabInputTextDiff: () => TabInputTextDiff,
  TabInputWebview: () => TabInputWebview,
  Task: () => Task,
  TaskScope: () => TaskScope,
  TextEdit: () => TextEdit,
  TextEditorRevealType: () => TextEditorRevealType,
  TextEditorSelectionChangeKind: () => TextEditorSelectionChangeKind,
  ThemeColor: () => ThemeColor,
  ThemeIcon: () => ThemeIcon,
  TreeItem: () => TreeItem,
  TreeItemCollapsibleState: () => TreeItemCollapsibleState,
  TypeHierarchyItem: () => TypeHierarchyItem,
  Uri: () => Uri,
  ViewColumn: () => ViewColumn,
  WorkspaceEdit: () => WorkspaceEdit
});
var Uri = class _Uri {
  scheme;
  authority;
  path;
  query;
  fragment;
  constructor(schemeOrComponents, authority = "", path4 = "", query = "", fragment = "") {
    if (typeof schemeOrComponents === "object" && schemeOrComponents !== null) {
      this.scheme = schemeOrComponents.scheme || "";
      this.authority = schemeOrComponents.authority || "";
      this.path = schemeOrComponents.path || "";
      this.query = schemeOrComponents.query || "";
      this.fragment = schemeOrComponents.fragment || "";
    } else {
      this.scheme = schemeOrComponents || "";
      this.authority = authority;
      this.path = path4;
      this.query = query;
      this.fragment = fragment;
    }
  }
  get fsPath() {
    if (this.scheme === "file") {
      let p = this.path;
      if (process.platform === "win32" && p.startsWith("/") && p.length > 2 && p[2] === ":") {
        p = p.slice(1);
      }
      return p;
    }
    return this.path;
  }
  static file(path4) {
    let normalized = path4.replace(/\\/g, "/");
    if (!normalized.startsWith("/") && !normalized.includes(":")) {
      normalized = "/" + normalized;
    }
    return new _Uri("file", "", normalized);
  }
  static parse(value, strict = false) {
    try {
      const parsed = new URL(value);
      return new _Uri(
        parsed.protocol.replace(/:$/, ""),
        parsed.host,
        decodeURIComponent(parsed.pathname),
        parsed.search.replace(/^\?/, ""),
        parsed.hash.replace(/^#/, "")
      );
    } catch {
      if (value.startsWith("file://")) {
        return _Uri.file(value.slice(7));
      }
      return new _Uri("file", "", value);
    }
  }
  static joinPath(base, ...pathSegments) {
    let p = base.path;
    for (const segment of pathSegments) {
      if (!p.endsWith("/")) p += "/";
      p += segment.replace(/^\/+/, "");
    }
    return new _Uri(base.scheme, base.authority, p, base.query, base.fragment);
  }
  static from(components) {
    return new _Uri(
      components.scheme,
      components.authority || "",
      components.path || "",
      components.query || "",
      components.fragment || ""
    );
  }
  with(change) {
    return new _Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }
  toString(skipEncoding = false) {
    if (this.scheme === "file") {
      return `file://${this.path}`;
    }
    return `${this.scheme}://${this.authority}${this.path}${this.query ? "?" + this.query : ""}${this.fragment ? "#" + this.fragment : ""}`;
  }
  toJSON() {
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
};
var RelativePattern = class {
  baseUri;
  base;
  pattern;
  constructor(base, pattern) {
    if (typeof base === "string") {
      this.base = base;
      this.baseUri = Uri.file(base);
    } else if (base && "uri" in base) {
      this.baseUri = base.uri;
      this.base = base.uri.fsPath || base.uri.path;
    } else if (base && "fsPath" in base) {
      this.baseUri = base;
      this.base = base.fsPath;
    } else {
      this.baseUri = Uri.file(String(base || ""));
      this.base = String(base || "");
    }
    this.pattern = pattern;
  }
};
var TaskScope = /* @__PURE__ */ ((TaskScope2) => {
  TaskScope2[TaskScope2["Folder"] = 1] = "Folder";
  TaskScope2[TaskScope2["Global"] = 2] = "Global";
  TaskScope2[TaskScope2["Workspace"] = 3] = "Workspace";
  return TaskScope2;
})(TaskScope || {});
var ShellExecution = class {
  commandLine;
  command;
  args;
  options;
  constructor(commandLineOrCommand, argsOrOptions, options) {
    if (typeof commandLineOrCommand === "string" && !argsOrOptions) {
      this.commandLine = commandLineOrCommand;
    } else {
      this.command = commandLineOrCommand;
      this.args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
      this.options = options || (Array.isArray(argsOrOptions) ? void 0 : argsOrOptions);
    }
  }
};
var ProcessExecution = class {
  process;
  args;
  options;
  constructor(process2, argsOrOptions, options) {
    this.process = process2;
    this.args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    this.options = options || (Array.isArray(argsOrOptions) ? void 0 : argsOrOptions);
  }
};
var CustomExecution = class {
  constructor(callback) {
    this.callback = callback;
  }
};
var Task = class {
  definition;
  scope;
  name;
  source;
  execution;
  problemMatchers;
  isBackground;
  presentationOptions;
  group;
  runOptions;
  detail;
  constructor(definition, scope, name, source, execution, problemMatchers) {
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
};
var Position = class _Position {
  line;
  character;
  constructor(line, character) {
    this.line = Math.max(0, line);
    this.character = Math.max(0, character);
  }
  isBefore(other) {
    if (this.line < other.line) return true;
    if (this.line > other.line) return false;
    return this.character < other.character;
  }
  isBeforeOrEqual(other) {
    if (this.line < other.line) return true;
    if (this.line > other.line) return false;
    return this.character <= other.character;
  }
  isAfter(other) {
    return !this.isBeforeOrEqual(other);
  }
  isAfterOrEqual(other) {
    return !this.isBefore(other);
  }
  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
  compareTo(other) {
    if (this.line < other.line) return -1;
    if (this.line > other.line) return 1;
    if (this.character < other.character) return -1;
    if (this.character > other.character) return 1;
    return 0;
  }
  translate(lineDelta = 0, characterDelta = 0) {
    return new _Position(this.line + lineDelta, this.character + characterDelta);
  }
  with(line, character) {
    return new _Position(line ?? this.line, character ?? this.character);
  }
};
var Range = class _Range {
  start;
  end;
  constructor(startOrStartLine, endOrStartChar, endLine, endCharacter) {
    if (startOrStartLine instanceof Position && endOrStartChar instanceof Position) {
      if (startOrStartLine.isBefore(endOrStartChar)) {
        this.start = startOrStartLine;
        this.end = endOrStartChar;
      } else {
        this.start = endOrStartChar;
        this.end = startOrStartLine;
      }
    } else {
      const p1 = new Position(startOrStartLine, endOrStartChar);
      const p2 = new Position(endLine, endCharacter);
      if (p1.isBefore(p2)) {
        this.start = p1;
        this.end = p2;
      } else {
        this.start = p2;
        this.end = p1;
      }
    }
  }
  get isEmpty() {
    return this.start.isEqual(this.end);
  }
  get isSingleLine() {
    return this.start.line === this.end.line;
  }
  contains(positionOrRange) {
    if (positionOrRange instanceof Position) {
      if (positionOrRange.isBefore(this.start)) return false;
      if (positionOrRange.isAfter(this.end)) return false;
      return true;
    }
    return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
  }
  isEqual(other) {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
  intersection(other) {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    if (start.isAfter(end)) return void 0;
    return new _Range(start, end);
  }
  union(other) {
    const start = this.start.isBefore(other.start) ? this.start : other.start;
    const end = this.end.isAfter(other.end) ? this.end : other.end;
    return new _Range(start, end);
  }
  with(start, end) {
    return new _Range(start ?? this.start, end ?? this.end);
  }
};
var Selection = class extends Range {
  anchor;
  active;
  constructor(anchorOrLine, activeOrChar, activeLine, activeCharacter) {
    let anchor;
    let active;
    if (anchorOrLine instanceof Position && activeOrChar instanceof Position) {
      anchor = anchorOrLine;
      active = activeOrChar;
    } else {
      anchor = new Position(anchorOrLine, activeOrChar);
      active = new Position(activeLine, activeCharacter);
    }
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
  get isReversed() {
    return this.anchor.isAfter(this.active);
  }
};
var Location = class {
  uri;
  range;
  constructor(uri, rangeOrPosition) {
    this.uri = uri;
    this.range = rangeOrPosition instanceof Range ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
  }
};
var TextEdit = class _TextEdit {
  range;
  newText;
  constructor(range, newText) {
    this.range = range;
    this.newText = newText;
  }
  static replace(range, newText) {
    return new _TextEdit(range, newText);
  }
  static insert(position, newText) {
    return new _TextEdit(new Range(position, position), newText);
  }
  static delete(range) {
    return new _TextEdit(range, "");
  }
};
var WorkspaceEdit = class {
  _edits = /* @__PURE__ */ new Map();
  _fileOperations = [];
  set(uri, edits) {
    this._edits.set(uri.toString(), edits.slice());
  }
  get(uri) {
    return this._edits.get(uri.toString()) || [];
  }
  has(uri) {
    return this._edits.has(uri.toString());
  }
  replace(uri, range, newText) {
    this.insertEdit(uri, TextEdit.replace(range, newText));
  }
  insert(uri, position, newText) {
    this.insertEdit(uri, TextEdit.insert(position, newText));
  }
  delete(uri, range) {
    this.insertEdit(uri, TextEdit.delete(range));
  }
  insertEdit(uri, edit) {
    const key = uri.toString();
    const list = this._edits.get(key) || [];
    list.push(edit);
    this._edits.set(key, list);
  }
  entries() {
    const result = [];
    for (const [key, edits] of this._edits.entries()) {
      result.push([Uri.parse(key), edits]);
    }
    return result;
  }
  get size() {
    let total = 0;
    for (const list of this._edits.values()) total += list.length;
    return total;
  }
  createFile(uri) {
    this._fileOperations.push({ type: "create", to: uri });
  }
  deleteFile(uri) {
    this._fileOperations.push({ type: "delete", from: uri });
  }
  renameFile(from, to) {
    this._fileOperations.push({ type: "rename", from, to });
  }
};
var SnippetString = class _SnippetString {
  value;
  constructor(value = "") {
    this.value = value;
  }
  appendText(string) {
    this.value += string.replace(/[$}\\]/g, "\\$&");
    return this;
  }
  appendTabstop(number = 0) {
    this.value += `$${number}`;
    return this;
  }
  appendPlaceholder(value, number) {
    if (typeof value === "function") {
      const nested = new _SnippetString();
      value(nested);
      this.value += `\${${number ?? 1}:${nested.value}}`;
    } else {
      this.value += `\${${number ?? 1}:${value}}`;
    }
    return this;
  }
  appendChoice(values, number) {
    this.value += `\${${number ?? 1}|${values.join(",")}|}`;
    return this;
  }
  appendVariable(name, defaultValue) {
    if (defaultValue) {
      this.value += `\${${name}:${defaultValue}}`;
    } else {
      this.value += `\${${name}}`;
    }
    return this;
  }
};
var MarkdownString = class {
  value;
  isTrusted;
  supportThemeIcons;
  supportHtml;
  constructor(value = "", supportThemeIcons = false) {
    this.value = value;
    this.supportThemeIcons = supportThemeIcons;
  }
  appendText(value) {
    this.value += value.replace(/[*_`~\\]/g, "\\$&");
    return this;
  }
  appendMarkdown(value) {
    this.value += value;
    return this;
  }
  appendCodeblock(value, language = "") {
    this.value += `
\`\`\`${language}
${value}
\`\`\`
`;
    return this;
  }
};
var DiagnosticSeverity = /* @__PURE__ */ ((DiagnosticSeverity3) => {
  DiagnosticSeverity3[DiagnosticSeverity3["Error"] = 0] = "Error";
  DiagnosticSeverity3[DiagnosticSeverity3["Warning"] = 1] = "Warning";
  DiagnosticSeverity3[DiagnosticSeverity3["Information"] = 2] = "Information";
  DiagnosticSeverity3[DiagnosticSeverity3["Hint"] = 3] = "Hint";
  return DiagnosticSeverity3;
})(DiagnosticSeverity || {});
var DiagnosticTag = /* @__PURE__ */ ((DiagnosticTag2) => {
  DiagnosticTag2[DiagnosticTag2["Unnecessary"] = 1] = "Unnecessary";
  DiagnosticTag2[DiagnosticTag2["Deprecated"] = 2] = "Deprecated";
  return DiagnosticTag2;
})(DiagnosticTag || {});
var Diagnostic = class {
  range;
  message;
  severity;
  source;
  code;
  relatedInformation;
  tags;
  constructor(range, message, severity = 0 /* Error */) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
};
var CompletionItemKind = /* @__PURE__ */ ((CompletionItemKind2) => {
  CompletionItemKind2[CompletionItemKind2["Text"] = 0] = "Text";
  CompletionItemKind2[CompletionItemKind2["Method"] = 1] = "Method";
  CompletionItemKind2[CompletionItemKind2["Function"] = 2] = "Function";
  CompletionItemKind2[CompletionItemKind2["Constructor"] = 3] = "Constructor";
  CompletionItemKind2[CompletionItemKind2["Field"] = 4] = "Field";
  CompletionItemKind2[CompletionItemKind2["Variable"] = 5] = "Variable";
  CompletionItemKind2[CompletionItemKind2["Class"] = 6] = "Class";
  CompletionItemKind2[CompletionItemKind2["Interface"] = 7] = "Interface";
  CompletionItemKind2[CompletionItemKind2["Module"] = 8] = "Module";
  CompletionItemKind2[CompletionItemKind2["Property"] = 9] = "Property";
  CompletionItemKind2[CompletionItemKind2["Unit"] = 10] = "Unit";
  CompletionItemKind2[CompletionItemKind2["Value"] = 11] = "Value";
  CompletionItemKind2[CompletionItemKind2["Enum"] = 12] = "Enum";
  CompletionItemKind2[CompletionItemKind2["Keyword"] = 13] = "Keyword";
  CompletionItemKind2[CompletionItemKind2["Snippet"] = 14] = "Snippet";
  CompletionItemKind2[CompletionItemKind2["Color"] = 15] = "Color";
  CompletionItemKind2[CompletionItemKind2["File"] = 16] = "File";
  CompletionItemKind2[CompletionItemKind2["Reference"] = 17] = "Reference";
  CompletionItemKind2[CompletionItemKind2["Folder"] = 18] = "Folder";
  CompletionItemKind2[CompletionItemKind2["EnumMember"] = 19] = "EnumMember";
  CompletionItemKind2[CompletionItemKind2["Constant"] = 20] = "Constant";
  CompletionItemKind2[CompletionItemKind2["Struct"] = 21] = "Struct";
  CompletionItemKind2[CompletionItemKind2["Event"] = 22] = "Event";
  CompletionItemKind2[CompletionItemKind2["Operator"] = 23] = "Operator";
  CompletionItemKind2[CompletionItemKind2["TypeParameter"] = 24] = "TypeParameter";
  return CompletionItemKind2;
})(CompletionItemKind || {});
var CompletionTriggerKind = /* @__PURE__ */ ((CompletionTriggerKind2) => {
  CompletionTriggerKind2[CompletionTriggerKind2["Invoke"] = 0] = "Invoke";
  CompletionTriggerKind2[CompletionTriggerKind2["TriggerCharacter"] = 1] = "TriggerCharacter";
  CompletionTriggerKind2[CompletionTriggerKind2["TriggerForIncompleteCompletions"] = 2] = "TriggerForIncompleteCompletions";
  return CompletionTriggerKind2;
})(CompletionTriggerKind || {});
var CompletionItem = class {
  label;
  kind;
  detail;
  documentation;
  sortText;
  filterText;
  insertText;
  range;
  command;
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
};
var CompletionList = class {
  isIncomplete;
  items;
  constructor(items = [], isIncomplete = false) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
};
var InlineCompletionTriggerKind = /* @__PURE__ */ ((InlineCompletionTriggerKind2) => {
  InlineCompletionTriggerKind2[InlineCompletionTriggerKind2["Invoke"] = 0] = "Invoke";
  InlineCompletionTriggerKind2[InlineCompletionTriggerKind2["Automatic"] = 1] = "Automatic";
  return InlineCompletionTriggerKind2;
})(InlineCompletionTriggerKind || {});
var InlineCompletionItem = class {
  insertText;
  range;
  command;
  constructor(insertText, range, command) {
    this.insertText = insertText;
    this.range = range;
    this.command = command;
  }
};
var InlineCompletionList = class {
  items;
  constructor(items = []) {
    this.items = items;
  }
};
var Hover = class {
  contents;
  range;
  constructor(contents, range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
};
var CodeActionKind = class _CodeActionKind {
  static sep = ".";
  static Empty = new _CodeActionKind("");
  static QuickFix = new _CodeActionKind("quickfix");
  static Refactor = new _CodeActionKind("refactor");
  static RefactorExtract = new _CodeActionKind("refactor.extract");
  static RefactorInline = new _CodeActionKind("refactor.inline");
  static RefactorRewrite = new _CodeActionKind("refactor.rewrite");
  static Source = new _CodeActionKind("source");
  static SourceOrganizeImports = new _CodeActionKind("source.organizeImports");
  static SourceFixAll = new _CodeActionKind("source.fixAll");
  value;
  constructor(value) {
    this.value = value;
  }
  append(parts) {
    return new _CodeActionKind(this.value ? `${this.value}${_CodeActionKind.sep}${parts}` : parts);
  }
  contains(other) {
    return this.value === other.value || other.value.startsWith(this.value + _CodeActionKind.sep);
  }
};
var CodeAction = class {
  title;
  kind;
  diagnostics;
  isPreferred;
  edit;
  command;
  constructor(title, kind) {
    this.title = title;
    this.kind = kind;
  }
};
var CodeLens = class {
  range;
  command;
  isResolved;
  constructor(range, command) {
    this.range = range;
    this.command = command;
    this.isResolved = !!command;
  }
};
var DocumentHighlightKind = /* @__PURE__ */ ((DocumentHighlightKind2) => {
  DocumentHighlightKind2[DocumentHighlightKind2["Text"] = 0] = "Text";
  DocumentHighlightKind2[DocumentHighlightKind2["Read"] = 1] = "Read";
  DocumentHighlightKind2[DocumentHighlightKind2["Write"] = 2] = "Write";
  return DocumentHighlightKind2;
})(DocumentHighlightKind || {});
var DocumentHighlight = class {
  range;
  kind;
  constructor(range, kind = 0 /* Text */) {
    this.range = range;
    this.kind = kind;
  }
};
var SymbolKind = /* @__PURE__ */ ((SymbolKind2) => {
  SymbolKind2[SymbolKind2["File"] = 0] = "File";
  SymbolKind2[SymbolKind2["Module"] = 1] = "Module";
  SymbolKind2[SymbolKind2["Namespace"] = 2] = "Namespace";
  SymbolKind2[SymbolKind2["Package"] = 3] = "Package";
  SymbolKind2[SymbolKind2["Class"] = 4] = "Class";
  SymbolKind2[SymbolKind2["Method"] = 5] = "Method";
  SymbolKind2[SymbolKind2["Property"] = 6] = "Property";
  SymbolKind2[SymbolKind2["Field"] = 7] = "Field";
  SymbolKind2[SymbolKind2["Constructor"] = 8] = "Constructor";
  SymbolKind2[SymbolKind2["Enum"] = 9] = "Enum";
  SymbolKind2[SymbolKind2["Interface"] = 10] = "Interface";
  SymbolKind2[SymbolKind2["Function"] = 11] = "Function";
  SymbolKind2[SymbolKind2["Variable"] = 12] = "Variable";
  SymbolKind2[SymbolKind2["Constant"] = 13] = "Constant";
  SymbolKind2[SymbolKind2["String"] = 14] = "String";
  SymbolKind2[SymbolKind2["Number"] = 15] = "Number";
  SymbolKind2[SymbolKind2["Boolean"] = 16] = "Boolean";
  SymbolKind2[SymbolKind2["Array"] = 17] = "Array";
  SymbolKind2[SymbolKind2["Object"] = 18] = "Object";
  SymbolKind2[SymbolKind2["Key"] = 19] = "Key";
  SymbolKind2[SymbolKind2["Null"] = 20] = "Null";
  SymbolKind2[SymbolKind2["EnumMember"] = 21] = "EnumMember";
  SymbolKind2[SymbolKind2["Struct"] = 22] = "Struct";
  SymbolKind2[SymbolKind2["Event"] = 23] = "Event";
  SymbolKind2[SymbolKind2["Operator"] = 24] = "Operator";
  SymbolKind2[SymbolKind2["TypeParameter"] = 25] = "TypeParameter";
  return SymbolKind2;
})(SymbolKind || {});
var DocumentSymbol = class {
  name;
  detail;
  kind;
  range;
  selectionRange;
  children;
  constructor(name, detail, kind, range, selectionRange) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    this.children = [];
  }
};
var FoldingRangeKind = /* @__PURE__ */ ((FoldingRangeKind2) => {
  FoldingRangeKind2[FoldingRangeKind2["Comment"] = 1] = "Comment";
  FoldingRangeKind2[FoldingRangeKind2["Imports"] = 2] = "Imports";
  FoldingRangeKind2[FoldingRangeKind2["Region"] = 3] = "Region";
  return FoldingRangeKind2;
})(FoldingRangeKind || {});
var FoldingRange = class {
  start;
  end;
  kind;
  constructor(start, end, kind) {
    this.start = start;
    this.end = end;
    this.kind = kind;
  }
};
var InlayHintKind = /* @__PURE__ */ ((InlayHintKind2) => {
  InlayHintKind2[InlayHintKind2["Type"] = 1] = "Type";
  InlayHintKind2[InlayHintKind2["Parameter"] = 2] = "Parameter";
  return InlayHintKind2;
})(InlayHintKind || {});
var InlayHint = class {
  position;
  label;
  kind;
  tooltip;
  paddingLeft;
  paddingRight;
  constructor(position, label, kind) {
    this.position = position;
    this.label = label;
    this.kind = kind;
  }
};
var ThemeColor = class {
  id;
  constructor(id) {
    this.id = id;
  }
};
var ThemeIcon = class _ThemeIcon {
  static File = new _ThemeIcon("file");
  static Folder = new _ThemeIcon("folder");
  id;
  color;
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
};
var TreeItemCollapsibleState = /* @__PURE__ */ ((TreeItemCollapsibleState2) => {
  TreeItemCollapsibleState2[TreeItemCollapsibleState2["None"] = 0] = "None";
  TreeItemCollapsibleState2[TreeItemCollapsibleState2["Collapsed"] = 1] = "Collapsed";
  TreeItemCollapsibleState2[TreeItemCollapsibleState2["Expanded"] = 2] = "Expanded";
  return TreeItemCollapsibleState2;
})(TreeItemCollapsibleState || {});
var TreeItem = class {
  label;
  id;
  iconPath;
  description;
  resourceUri;
  tooltip;
  command;
  collapsibleState;
  contextValue;
  constructor(labelOrUri, collapsibleState = 0 /* None */) {
    if (typeof labelOrUri === "string") {
      this.label = labelOrUri;
    } else {
      this.resourceUri = labelOrUri;
    }
    this.collapsibleState = collapsibleState;
  }
};
var StatusBarAlignment = /* @__PURE__ */ ((StatusBarAlignment2) => {
  StatusBarAlignment2[StatusBarAlignment2["Left"] = 1] = "Left";
  StatusBarAlignment2[StatusBarAlignment2["Right"] = 2] = "Right";
  return StatusBarAlignment2;
})(StatusBarAlignment || {});
var ViewColumn = /* @__PURE__ */ ((ViewColumn3) => {
  ViewColumn3[ViewColumn3["Active"] = -1] = "Active";
  ViewColumn3[ViewColumn3["Beside"] = -2] = "Beside";
  ViewColumn3[ViewColumn3["One"] = 1] = "One";
  ViewColumn3[ViewColumn3["Two"] = 2] = "Two";
  ViewColumn3[ViewColumn3["Three"] = 3] = "Three";
  return ViewColumn3;
})(ViewColumn || {});
var ConfigurationTarget = /* @__PURE__ */ ((ConfigurationTarget3) => {
  ConfigurationTarget3[ConfigurationTarget3["Global"] = 1] = "Global";
  ConfigurationTarget3[ConfigurationTarget3["Workspace"] = 2] = "Workspace";
  ConfigurationTarget3[ConfigurationTarget3["WorkspaceFolder"] = 3] = "WorkspaceFolder";
  return ConfigurationTarget3;
})(ConfigurationTarget || {});
var ProgressLocation = /* @__PURE__ */ ((ProgressLocation3) => {
  ProgressLocation3[ProgressLocation3["SourceControl"] = 1] = "SourceControl";
  ProgressLocation3[ProgressLocation3["Window"] = 10] = "Window";
  ProgressLocation3[ProgressLocation3["Notification"] = 15] = "Notification";
  return ProgressLocation3;
})(ProgressLocation || {});
var QuickInputButtonLocation = /* @__PURE__ */ ((QuickInputButtonLocation2) => {
  QuickInputButtonLocation2[QuickInputButtonLocation2["Title"] = 1] = "Title";
  QuickInputButtonLocation2[QuickInputButtonLocation2["Input"] = 2] = "Input";
  return QuickInputButtonLocation2;
})(QuickInputButtonLocation || {});
var QuickPickItemKind = /* @__PURE__ */ ((QuickPickItemKind2) => {
  QuickPickItemKind2[QuickPickItemKind2["Separator"] = -1] = "Separator";
  QuickPickItemKind2[QuickPickItemKind2["Default"] = 0] = "Default";
  return QuickPickItemKind2;
})(QuickPickItemKind || {});
var InputBoxValidationSeverity = /* @__PURE__ */ ((InputBoxValidationSeverity2) => {
  InputBoxValidationSeverity2[InputBoxValidationSeverity2["Info"] = 1] = "Info";
  InputBoxValidationSeverity2[InputBoxValidationSeverity2["Warning"] = 2] = "Warning";
  InputBoxValidationSeverity2[InputBoxValidationSeverity2["Error"] = 3] = "Error";
  return InputBoxValidationSeverity2;
})(InputBoxValidationSeverity || {});
var FileChangeType = /* @__PURE__ */ ((FileChangeType2) => {
  FileChangeType2[FileChangeType2["Created"] = 1] = "Created";
  FileChangeType2[FileChangeType2["Changed"] = 2] = "Changed";
  FileChangeType2[FileChangeType2["Deleted"] = 3] = "Deleted";
  return FileChangeType2;
})(FileChangeType || {});
var FileType = /* @__PURE__ */ ((FileType2) => {
  FileType2[FileType2["Unknown"] = 0] = "Unknown";
  FileType2[FileType2["File"] = 1] = "File";
  FileType2[FileType2["Directory"] = 2] = "Directory";
  FileType2[FileType2["SymbolicLink"] = 64] = "SymbolicLink";
  return FileType2;
})(FileType || {});
var TextEditorSelectionChangeKind = /* @__PURE__ */ ((TextEditorSelectionChangeKind2) => {
  TextEditorSelectionChangeKind2[TextEditorSelectionChangeKind2["Keyboard"] = 1] = "Keyboard";
  TextEditorSelectionChangeKind2[TextEditorSelectionChangeKind2["Mouse"] = 2] = "Mouse";
  TextEditorSelectionChangeKind2[TextEditorSelectionChangeKind2["Command"] = 3] = "Command";
  return TextEditorSelectionChangeKind2;
})(TextEditorSelectionChangeKind || {});
var OverviewRulerLane = /* @__PURE__ */ ((OverviewRulerLane2) => {
  OverviewRulerLane2[OverviewRulerLane2["Left"] = 1] = "Left";
  OverviewRulerLane2[OverviewRulerLane2["Center"] = 2] = "Center";
  OverviewRulerLane2[OverviewRulerLane2["Right"] = 4] = "Right";
  OverviewRulerLane2[OverviewRulerLane2["Full"] = 7] = "Full";
  return OverviewRulerLane2;
})(OverviewRulerLane || {});
var DecorationRangeBehavior = /* @__PURE__ */ ((DecorationRangeBehavior2) => {
  DecorationRangeBehavior2[DecorationRangeBehavior2["OpenOpen"] = 0] = "OpenOpen";
  DecorationRangeBehavior2[DecorationRangeBehavior2["ClosedClosed"] = 1] = "ClosedClosed";
  DecorationRangeBehavior2[DecorationRangeBehavior2["OpenClosed"] = 2] = "OpenClosed";
  DecorationRangeBehavior2[DecorationRangeBehavior2["ClosedOpen"] = 3] = "ClosedOpen";
  return DecorationRangeBehavior2;
})(DecorationRangeBehavior || {});
var TextEditorRevealType = /* @__PURE__ */ ((TextEditorRevealType2) => {
  TextEditorRevealType2[TextEditorRevealType2["Default"] = 0] = "Default";
  TextEditorRevealType2[TextEditorRevealType2["InCenter"] = 1] = "InCenter";
  TextEditorRevealType2[TextEditorRevealType2["InCenterIfOutsideViewport"] = 2] = "InCenterIfOutsideViewport";
  TextEditorRevealType2[TextEditorRevealType2["AtTop"] = 3] = "AtTop";
  return TextEditorRevealType2;
})(TextEditorRevealType || {});
var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[LogLevel2["Off"] = 0] = "Off";
  LogLevel2[LogLevel2["Trace"] = 1] = "Trace";
  LogLevel2[LogLevel2["Debug"] = 2] = "Debug";
  LogLevel2[LogLevel2["Info"] = 3] = "Info";
  LogLevel2[LogLevel2["Warning"] = 4] = "Warning";
  LogLevel2[LogLevel2["Error"] = 5] = "Error";
  return LogLevel2;
})(LogLevel || {});
var Disposable = class _Disposable {
  _callOnDispose;
  constructor(callOnDispose) {
    this._callOnDispose = callOnDispose;
  }
  dispose() {
    if (this._callOnDispose) {
      this._callOnDispose();
      this._callOnDispose = void 0;
    }
  }
  static from(...disposables) {
    return new _Disposable(() => {
      for (const d of disposables) {
        if (d && typeof d.dispose === "function") {
          d.dispose();
        }
      }
    });
  }
};
var EventEmitter = class {
  _listeners = [];
  event = (listener, thisArgs, disposables) => {
    const bound = thisArgs ? listener.bind(thisArgs) : listener;
    this._listeners.push(bound);
    const disposable = new Disposable(() => {
      const idx = this._listeners.indexOf(bound);
      if (idx >= 0) this._listeners.splice(idx, 1);
    });
    if (disposables) disposables.push(disposable);
    return disposable;
  };
  fire(data) {
    for (const listener of this._listeners.slice()) {
      try {
        listener(data);
      } catch (err) {
        console.error("EventEmitter error:", err);
      }
    }
  }
  dispose() {
    this._listeners = [];
  }
};
var CancellationError = class extends Error {
  constructor() {
    super("Canceled");
    this.name = "CancellationError";
  }
};
var CancellationTokenSource = class {
  _emitter = new EventEmitter();
  _isCancellationRequested = false;
  get token() {
    return {
      isCancellationRequested: this._isCancellationRequested,
      onCancellationRequested: this._emitter.event
    };
  }
  cancel() {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this._emitter.fire(void 0);
    }
  }
  dispose() {
    this._emitter.dispose();
  }
};
var TabInputText = class {
  constructor(uri) {
    this.uri = uri;
  }
};
var TabInputTextDiff = class {
  constructor(original, modified) {
    this.original = original;
    this.modified = modified;
  }
};
var TabInputCustom = class {
  constructor(uri, viewType) {
    this.uri = uri;
    this.viewType = viewType;
  }
};
var TabInputWebview = class {
  constructor(viewType) {
    this.viewType = viewType;
  }
};
var TabInputNotebook = class {
  constructor(uri, notebookType) {
    this.uri = uri;
    this.notebookType = notebookType;
  }
};
var TabInputNotebookDiff = class {
  constructor(original, modified, notebookType) {
    this.original = original;
    this.modified = modified;
    this.notebookType = notebookType;
  }
};
var TabInputTerminal = class {
  constructor() {
  }
};
var NotebookCellKind = /* @__PURE__ */ ((NotebookCellKind2) => {
  NotebookCellKind2[NotebookCellKind2["Markup"] = 1] = "Markup";
  NotebookCellKind2[NotebookCellKind2["Code"] = 2] = "Code";
  return NotebookCellKind2;
})(NotebookCellKind || {});
var NotebookRange = class {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
  isEmpty() {
    return this.start === this.end;
  }
};
var NotebookCellData = class {
  constructor(kind, value, languageId) {
    this.kind = kind;
    this.value = value;
    this.languageId = languageId;
  }
};
var NotebookData = class {
  cells;
  constructor(cells = []) {
    this.cells = cells;
  }
};
var NotebookEdit = class _NotebookEdit {
  constructor(range, newCells) {
    this.range = range;
    this.newCells = newCells;
  }
  static replaceCells(range, newCells) {
    return new _NotebookEdit(range, newCells);
  }
};
var NotebookCellOutputItem = class _NotebookCellOutputItem {
  constructor(data, mime) {
    this.data = data;
    this.mime = mime;
  }
  static text(value, mime) {
    return new _NotebookCellOutputItem(new TextEncoder().encode(value), mime || "text/plain");
  }
  static json(value, mime) {
    return new _NotebookCellOutputItem(new TextEncoder().encode(JSON.stringify(value)), mime || "application/json");
  }
  static bytes(value, mime) {
    return new _NotebookCellOutputItem(value, mime || "application/octet-stream");
  }
  static error(err) {
    return new _NotebookCellOutputItem(
      new TextEncoder().encode(JSON.stringify({ name: err?.name || "Error", message: err?.message || "", stack: err?.stack || "" })),
      "application/vnd.code.notebook.error"
    );
  }
  static stdout(value) {
    return new _NotebookCellOutputItem(new TextEncoder().encode(value), "application/vnd.code.notebook.stdout");
  }
  static stderr(value) {
    return new _NotebookCellOutputItem(new TextEncoder().encode(value), "application/vnd.code.notebook.stderr");
  }
};
var NotebookCellOutput = class {
  constructor(items, metadata) {
    this.items = items;
    this.metadata = metadata;
    this.id = Math.random().toString(36).substring(2);
  }
  id;
};
var DocumentLink = class {
  range;
  target;
  tooltip;
  constructor(range, target) {
    this.range = range;
    this.target = target;
  }
};
var QuickInputButtons = {
  Back: {
    iconPath: new ThemeIcon("arrow-left"),
    tooltip: "Back"
  }
};
var CallHierarchyItem = class {
  name;
  kind;
  tags;
  detail;
  uri;
  range;
  selectionRange;
  constructor(kind, name, detail, uri, range, selectionRange) {
    this.kind = kind;
    this.name = name;
    this.detail = detail;
    this.uri = uri;
    this.range = range;
    this.selectionRange = selectionRange;
  }
};
var SymbolTag = /* @__PURE__ */ ((SymbolTag2) => {
  SymbolTag2[SymbolTag2["Deprecated"] = 1] = "Deprecated";
  return SymbolTag2;
})(SymbolTag || {});
var TypeHierarchyItem = class {
  name;
  kind;
  tags;
  detail;
  uri;
  range;
  selectionRange;
  constructor(kind, name, detail, uri, range, selectionRange) {
    this.kind = kind;
    this.name = name;
    this.detail = detail;
    this.uri = uri;
    this.range = range;
    this.selectionRange = selectionRange;
  }
};
var SymbolInformation = class {
  name;
  kind;
  tags;
  containerName;
  location;
  constructor(name, kind, rangeOrContainer, locationOrUri, containerName) {
    this.name = name;
    this.kind = kind;
    if (typeof rangeOrContainer === "string") {
      this.containerName = rangeOrContainer;
      this.location = locationOrUri;
    } else {
      this.containerName = containerName || "";
      this.location = locationOrUri instanceof Location ? locationOrUri : new Location(locationOrUri, rangeOrContainer);
    }
  }
};

// src/api/workspace.ts
var ExtHostTextDocument = class {
  uri;
  fileName;
  languageId;
  version;
  _text;
  _lines = [];
  _lineOffsets = [];
  constructor(uri, languageId, version, text) {
    this.uri = uri;
    this.fileName = uri.fsPath;
    this.languageId = languageId;
    this.version = version;
    this._text = text;
    this._buildLines();
  }
  get isUntitled() {
    return this.uri.scheme === "untitled";
  }
  get isClosed() {
    return false;
  }
  get isDirty() {
    return false;
  }
  get lineCount() {
    return this._lines.length;
  }
  _buildLines() {
    this._lines = this._text.split(/\r?\n/);
    this._lineOffsets = [0];
    let offset = 0;
    for (let i = 0; i < this._lines.length - 1; i++) {
      offset += this._lines[i].length + 1;
      this._lineOffsets.push(offset);
    }
  }
  updateText(newText, version) {
    this._text = newText;
    this.version = version;
    this._buildLines();
  }
  getText(range) {
    if (!range) return this._text;
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    return this._text.substring(start, end);
  }
  lineAt(lineOrPos) {
    const lineNum = typeof lineOrPos === "number" ? lineOrPos : lineOrPos.line;
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
      isEmptyOrWhitespace: firstNonWs === -1
    };
  }
  offsetAt(position) {
    let offset = 0;
    for (let l = 0; l < Math.min(position.line, this._lines.length); l++) {
      offset += this._lines[l].length + 1;
    }
    offset += position.character;
    return Math.min(offset, this._text.length);
  }
  positionAt(offset) {
    let cur = 0;
    for (let l = 0; l < this._lines.length; l++) {
      const len = this._lines[l].length + 1;
      if (cur + len > offset) {
        return new Position(l, Math.max(0, offset - cur));
      }
      cur += len;
    }
    return new Position(this._lines.length - 1, (this._lines[this._lines.length - 1] || "").length);
  }
  getWordRangeAtPosition(position, regex = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g) {
    const line = this.lineAt(position);
    let match;
    while ((match = regex.exec(line.text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start <= position.character && position.character <= end) {
        return new Range(position.line, start, position.line, end);
      }
    }
    return void 0;
  }
  validateRange(range) {
    const start = this.validatePosition(range.start);
    const end = this.validatePosition(range.end);
    return new Range(start, end);
  }
  validatePosition(position) {
    const line = Math.max(0, Math.min(position.line, this._lines.length - 1));
    const maxChar = (this._lines[line] || "").length;
    const char = Math.max(0, Math.min(position.character, maxChar));
    return new Position(line, char);
  }
};
var ExtHostWorkspace = class {
  constructor(_rpc) {
    this._rpc = _rpc;
  }
  _documents = /* @__PURE__ */ new Map();
  _folders = [];
  _configuration = {};
  _defaultConfiguration = {};
  setDefaultConfiguration(key, value) {
    this._defaultConfiguration[key] = value;
  }
  onDidOpenTextDocumentEmitter = new EventEmitter();
  onDidOpenTextDocument = this.onDidOpenTextDocumentEmitter.event;
  onDidChangeTextDocumentEmitter = new EventEmitter();
  onDidChangeTextDocument = this.onDidChangeTextDocumentEmitter.event;
  onDidSaveTextDocumentEmitter = new EventEmitter();
  onDidSaveTextDocument = this.onDidSaveTextDocumentEmitter.event;
  onDidCloseTextDocumentEmitter = new EventEmitter();
  onDidCloseTextDocument = this.onDidCloseTextDocumentEmitter.event;
  notebookDocuments = [];
  onDidOpenNotebookDocumentEmitter = new EventEmitter();
  onDidOpenNotebookDocument = this.onDidOpenNotebookDocumentEmitter.event;
  onDidCloseNotebookDocumentEmitter = new EventEmitter();
  onDidCloseNotebookDocument = this.onDidCloseNotebookDocumentEmitter.event;
  onDidSaveNotebookDocumentEmitter = new EventEmitter();
  onDidSaveNotebookDocument = this.onDidSaveNotebookDocumentEmitter.event;
  onDidChangeNotebookDocumentEmitter = new EventEmitter();
  onDidChangeNotebookDocument = this.onDidChangeNotebookDocumentEmitter.event;
  isTrusted = true;
  _onDidGrantWorkspaceTrustEmitter = new EventEmitter();
  onDidGrantWorkspaceTrust = this._onDidGrantWorkspaceTrustEmitter.event;
  onDidChangeConfigurationEmitter = new EventEmitter();
  onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;
  onDidChangeWorkspaceFoldersEmitter = new EventEmitter();
  onDidChangeWorkspaceFolders = this.onDidChangeWorkspaceFoldersEmitter.event;
  get rootPath() {
    return this._folders[0]?.uri.fsPath;
  }
  get name() {
    return this._folders[0]?.name;
  }
  get workspaceFolders() {
    return this._folders.slice();
  }
  setWorkspaceRoot(rootPath) {
    const uri = Uri.file(rootPath);
    const folder = {
      uri,
      name: path.basename(rootPath),
      index: 0
    };
    const prev = this._folders;
    this._folders = [folder];
    this.onDidChangeWorkspaceFoldersEmitter.fire({ added: [folder], removed: prev });
  }
  getWorkspaceFolder(uri) {
    const target = uri.fsPath;
    return this._folders.find((f) => target.startsWith(f.uri.fsPath));
  }
  get textDocuments() {
    return Array.from(this._documents.values());
  }
  getDocument(uri) {
    const key = typeof uri === "string" ? uri : uri.toString();
    return this._documents.get(key);
  }
  async openTextDocument(uriOrFileNameOrOptions) {
    let uri;
    if (typeof uriOrFileNameOrOptions === "string") {
      uri = Uri.file(uriOrFileNameOrOptions);
    } else if (uriOrFileNameOrOptions instanceof Uri) {
      uri = uriOrFileNameOrOptions;
    } else if (uriOrFileNameOrOptions?.language) {
      uri = Uri.parse(`untitled:Untitled-${Date.now()}`);
      const doc2 = new ExtHostTextDocument(uri, uriOrFileNameOrOptions.language, 1, uriOrFileNameOrOptions.content || "");
      this._documents.set(uri.toString(), doc2);
      this.onDidOpenTextDocumentEmitter.fire(doc2);
      return doc2;
    } else {
      throw new Error("Unsupported openTextDocument parameter");
    }
    const existing = this.getDocument(uri);
    if (existing) return existing;
    const content = await fs.promises.readFile(uri.fsPath, "utf-8");
    const ext = path.extname(uri.fsPath).replace(/^\./, "");
    const doc = new ExtHostTextDocument(uri, ext, 1, content);
    this._documents.set(uri.toString(), doc);
    this.onDidOpenTextDocumentEmitter.fire(doc);
    return doc;
  }
  handleDocumentOpened(uriStr, languageId, version, text) {
    const uri = Uri.parse(uriStr);
    const doc = new ExtHostTextDocument(uri, languageId, version, text);
    this._documents.set(uriStr, doc);
    this.onDidOpenTextDocumentEmitter.fire(doc);
    return doc;
  }
  handleDocumentChanged(uriStr, version, changes, fullText) {
    const doc = this._documents.get(uriStr);
    if (doc) {
      if (fullText !== void 0) {
        doc.updateText(fullText, version);
      }
      this.onDidChangeTextDocumentEmitter.fire({ document: doc, contentChanges: changes });
    }
  }
  handleDocumentSaved(uriStr) {
    const doc = this._documents.get(uriStr);
    if (doc) {
      this.onDidSaveTextDocumentEmitter.fire(doc);
    }
  }
  handleDocumentClosed(uriStr) {
    const doc = this._documents.get(uriStr);
    if (doc) {
      this._documents.delete(uriStr);
      this.onDidCloseTextDocumentEmitter.fire(doc);
    }
  }
  getConfiguration(section, scope) {
    const config = this._configuration;
    const defaults = this._defaultConfiguration;
    const getValue = (fullKey) => {
      if (config[fullKey] !== void 0) return config[fullKey];
      if (defaults[fullKey] !== void 0) return defaults[fullKey];
      const prefix = fullKey + ".";
      const nested = {};
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
      return found ? nested : void 0;
    };
    const configObj = {
      get: (key, defaultValue) => {
        const fullKey = section ? `${section}.${key}` : key;
        const val = getValue(fullKey) ?? getValue(key);
        return val !== void 0 ? val : defaultValue;
      },
      has: (key) => {
        const fullKey = section ? `${section}.${key}` : key;
        return getValue(fullKey) !== void 0 || getValue(key) !== void 0;
      },
      inspect: (key) => {
        const fullKey = section ? `${section}.${key}` : key;
        const val = getValue(fullKey) ?? getValue(key);
        const def = defaults[fullKey] ?? defaults[key];
        return {
          key: fullKey,
          defaultValue: def,
          globalValue: val,
          workspaceValue: val,
          workspaceFolderValue: void 0
        };
      },
      update: async (key, value, target) => {
        const fullKey = section ? `${section}.${key}` : key;
        config[fullKey] = value;
        this.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: (s) => s === fullKey || s === section });
      }
    };
    return new Proxy(configObj, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && prop in target) {
          return target[prop];
        }
        if (typeof prop === "string") {
          const val = target.get(prop);
          if (val !== void 0) return val;
          if (prop === "http") {
            return { proxy: "", proxyStrictSSL: true, proxyAuthorization: null, proxySupport: "override" };
          }
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }
  updateConfiguration(values) {
    Object.assign(this._configuration, values);
    this.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: () => true });
  }
  async applyEdit(edit) {
    const entries = edit.entries();
    const serialized = entries.map(([uri, edits]) => ({
      uri: uri.toString(),
      edits: edits.map((e) => ({
        range: {
          start: { line: e.range.start.line, character: e.range.start.character },
          end: { line: e.range.end.line, character: e.range.end.character }
        },
        newText: e.newText
      }))
    }));
    try {
      await this._rpc.sendRequest("workspace/applyEdit", { edits: serialized });
      return true;
    } catch {
      return false;
    }
  }
  createFileSystemWatcher(globPattern) {
    const onDidCreate = new EventEmitter();
    const onDidChange = new EventEmitter();
    const onDidDelete = new EventEmitter();
    return {
      onDidCreate: onDidCreate.event,
      onDidChange: onDidChange.event,
      onDidDelete: onDidDelete.event,
      dispose: () => {
        onDidCreate.dispose();
        onDidChange.dispose();
        onDidDelete.dispose();
      }
    };
  }
  asRelativePath(pathOrUri, includeWorkspaceFolder) {
    let p = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
    if (this._folders.length > 0) {
      const root = this._folders[0].uri.fsPath;
      if (p.startsWith(root)) {
        return path.relative(root, p);
      }
    }
    return p;
  }
  onWillSaveTextDocumentEmitter = new EventEmitter();
  onWillSaveTextDocument = this.onWillSaveTextDocumentEmitter.event;
  onDidCreateFilesEmitter = new EventEmitter();
  onDidCreateFiles = this.onDidCreateFilesEmitter.event;
  onDidDeleteFilesEmitter = new EventEmitter();
  onDidDeleteFiles = this.onDidDeleteFilesEmitter.event;
  onDidRenameFilesEmitter = new EventEmitter();
  onDidRenameFiles = this.onDidRenameFilesEmitter.event;
  onWillCreateFilesEmitter = new EventEmitter();
  onWillCreateFiles = this.onWillCreateFilesEmitter.event;
  onWillDeleteFilesEmitter = new EventEmitter();
  onWillDeleteFiles = this.onWillDeleteFilesEmitter.event;
  onWillRenameFilesEmitter = new EventEmitter();
  onWillRenameFiles = this.onWillRenameFilesEmitter.event;
  registerFileSystemProvider(scheme, provider, options) {
    return new Disposable(() => {
    });
  }
  registerResourceLabelFormatter(formatter) {
    return new Disposable(() => {
    });
  }
  async openNotebookDocument(uriOrType, content) {
    return { uri: uriOrType, notebookType: "default", version: 1, cells: [] };
  }
  registerTextDocumentContentProvider(scheme, provider) {
    return new Disposable(() => {
    });
  }
  registerTaskProvider(type, provider) {
    return new Disposable(() => {
    });
  }
  registerNotebookSerializer(notebookType, serializer, options) {
    return new Disposable(() => {
    });
  }
  async findFiles(include, exclude, maxResults, token) {
    try {
      const res = await this._rpc.sendRequest("workspace/findFiles", { include, exclude, maxResults });
      return res.map((p) => Uri.file(p));
    } catch {
      return [];
    }
  }
  fs = {
    stat: async (uri) => {
      const stat = await fs.promises.stat(uri.fsPath);
      return {
        type: stat.isDirectory() ? 2 : stat.isFile() ? 1 : 0,
        ctime: stat.ctimeMs,
        mtime: stat.mtimeMs,
        size: stat.size
      };
    },
    readFile: async (uri) => {
      return new Uint8Array(await fs.promises.readFile(uri.fsPath));
    },
    writeFile: async (uri, content) => {
      await fs.promises.writeFile(uri.fsPath, content);
    },
    delete: async (uri, options) => {
      await fs.promises.rm(uri.fsPath, { recursive: options?.recursive });
    },
    rename: async (source, target, options) => {
      await fs.promises.rename(source.fsPath, target.fsPath);
    },
    copy: async (source, target, options) => {
      await fs.promises.copyFile(source.fsPath, target.fsPath);
    },
    readDirectory: async (uri) => {
      const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((e) => [e.name, e.isDirectory() ? 2 : 1]);
    },
    createDirectory: async (uri) => {
      await fs.promises.mkdir(uri.fsPath, { recursive: true });
    }
  };
};
function setNestedValue(obj, pathStr, value) {
  const parts = pathStr.split(".");
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!curr[p] || typeof curr[p] !== "object") {
      curr[p] = {};
    }
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = value;
}

// src/api/languages.ts
var DiagnosticCollection = class {
  constructor(name, _onChanged) {
    this.name = name;
    this._onChanged = _onChanged;
  }
  _diagnostics = /* @__PURE__ */ new Map();
  set(uri, diagnostics) {
    const key = uri.toString();
    if (!diagnostics || diagnostics.length === 0) {
      this._diagnostics.delete(key);
      this._onChanged(uri, []);
    } else {
      this._diagnostics.set(key, diagnostics.slice());
      this._onChanged(uri, diagnostics);
    }
  }
  delete(uri) {
    this.set(uri, void 0);
  }
  clear() {
    for (const uriStr of this._diagnostics.keys()) {
      this._onChanged(Uri.parse(uriStr), []);
    }
    this._diagnostics.clear();
  }
  get(uri) {
    return this._diagnostics.get(uri.toString());
  }
  forEach(callback) {
    for (const [key, diags] of this._diagnostics.entries()) {
      callback(Uri.parse(key), diags, this);
    }
  }
  dispose() {
    this.clear();
  }
};
var ExtHostLanguages = class {
  constructor(_workspace, _rpc) {
    this._workspace = _workspace;
    this._rpc = _rpc;
  }
  _diagnosticCollections = [];
  _completionProviders = [];
  _hoverProviders = [];
  _definitionProviders = [];
  _referenceProviders = [];
  _formattingProviders = [];
  _codeActionsProviders = [];
  _renameProviders = [];
  createDiagnosticCollection(name = "default") {
    const coll = new DiagnosticCollection(name, (uri, diags) => {
      this._rpc.sendNotification("languages/publishDiagnostics", {
        uri: uri.toString(),
        diagnostics: diags.map((d) => ({
          range: {
            start: { line: d.range.start.line, character: d.range.start.character },
            end: { line: d.range.end.line, character: d.range.end.character }
          },
          message: d.message,
          severity: d.severity,
          source: d.source || name,
          code: typeof d.code === "object" ? d.code?.value : d.code
        }))
      });
    });
    this._diagnosticCollections.push(coll);
    return coll;
  }
  registerCompletionItemProvider(selector, provider, ...triggerCharacters) {
    const entry = { selector, provider, triggerChars: triggerCharacters };
    this._completionProviders.push(entry);
    return new Disposable(() => {
      const idx = this._completionProviders.indexOf(entry);
      if (idx >= 0) this._completionProviders.splice(idx, 1);
    });
  }
  registerHoverProvider(selector, provider) {
    const entry = { selector, provider };
    this._hoverProviders.push(entry);
    return new Disposable(() => {
      const idx = this._hoverProviders.indexOf(entry);
      if (idx >= 0) this._hoverProviders.splice(idx, 1);
    });
  }
  registerDefinitionProvider(selector, provider) {
    const entry = { selector, provider };
    this._definitionProviders.push(entry);
    return new Disposable(() => {
      const idx = this._definitionProviders.indexOf(entry);
      if (idx >= 0) this._definitionProviders.splice(idx, 1);
    });
  }
  registerTypeDefinitionProvider(selector, provider) {
    return this.registerDefinitionProvider(selector, provider);
  }
  registerImplementationProvider(selector, provider) {
    return this.registerDefinitionProvider(selector, provider);
  }
  registerDeclarationProvider(selector, provider) {
    return this.registerDefinitionProvider(selector, provider);
  }
  registerReferenceProvider(selector, provider) {
    const entry = { selector, provider };
    this._referenceProviders.push(entry);
    return new Disposable(() => {
      const idx = this._referenceProviders.indexOf(entry);
      if (idx >= 0) this._referenceProviders.splice(idx, 1);
    });
  }
  registerDocumentFormattingEditProvider(selector, provider) {
    const entry = { selector, provider };
    this._formattingProviders.push(entry);
    return new Disposable(() => {
      const idx = this._formattingProviders.indexOf(entry);
      if (idx >= 0) this._formattingProviders.splice(idx, 1);
    });
  }
  registerDocumentRangeFormattingEditProvider(selector, provider) {
    return this.registerDocumentFormattingEditProvider(selector, provider);
  }
  registerCodeActionsProvider(selector, provider, metadata) {
    const entry = { selector, provider };
    this._codeActionsProviders.push(entry);
    return new Disposable(() => {
      const idx = this._codeActionsProviders.indexOf(entry);
      if (idx >= 0) this._codeActionsProviders.splice(idx, 1);
    });
  }
  registerRenameProvider(selector, provider) {
    const entry = { selector, provider };
    this._renameProviders.push(entry);
    return new Disposable(() => {
      const idx = this._renameProviders.indexOf(entry);
      if (idx >= 0) this._renameProviders.splice(idx, 1);
    });
  }
  registerCodeLensProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerInlayHintsProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerDocumentHighlightProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerDocumentSymbolProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerWorkspaceSymbolProvider(provider) {
    return new Disposable(() => {
    });
  }
  registerDocumentSemanticTokensProvider(selector, provider, legend) {
    return new Disposable(() => {
    });
  }
  registerDocumentRangeSemanticTokensProvider(selector, provider, legend) {
    return new Disposable(() => {
    });
  }
  registerSignatureHelpProvider(selector, provider, ...triggerCharacters) {
    return new Disposable(() => {
    });
  }
  registerDocumentLinkProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerColorProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerFoldingRangeProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerSelectionRangeProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerCallHierarchyProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerTypeHierarchyProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  registerInlineCompletionItemProvider(selector, provider) {
    return new Disposable(() => {
    });
  }
  async getLanguages() {
    return ["javascript", "typescript", "rust", "python", "json", "html", "css", "markdown"];
  }
  getDiagnostics(resource) {
    if (resource) {
      return this._diagnosticCollections.flatMap((c) => c.get(resource) || []);
    }
    return [];
  }
  matchDocument(selector, document) {
    if (typeof selector === "string") {
      return selector === "*" || selector === document.languageId;
    }
    if (Array.isArray(selector)) {
      return selector.some((s) => this.matchDocument(s, document));
    }
    if (selector.language && selector.language !== "*" && selector.language !== document.languageId) {
      return false;
    }
    if (selector.scheme && selector.scheme !== document.uri.scheme) {
      return false;
    }
    return true;
  }
  // --- Provider Query Dispatchers ---
  async provideCompletions(uriStr, line, character, context) {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const pos = new Position(line, character);
    const cancelToken = new CancellationTokenSource().token;
    const allItems = [];
    for (const entry of this._completionProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const res = await entry.provider.provideCompletionItems(doc, pos, cancelToken, context);
        if (!res) continue;
        const items = Array.isArray(res) ? res : res.items || [];
        for (const item of items) {
          const label = typeof item.label === "string" ? item.label : item.label.label;
          let insertText = label;
          if (typeof item.insertText === "string") {
            insertText = item.insertText;
          } else if (item.insertText && "value" in item.insertText) {
            insertText = item.insertText.value;
          }
          let docText = "";
          if (typeof item.documentation === "string") {
            docText = item.documentation;
          } else if (item.documentation && "value" in item.documentation) {
            docText = item.documentation.value;
          }
          allItems.push({
            label,
            kind: item.kind ?? 0,
            detail: item.detail,
            documentation: docText,
            sortText: item.sortText,
            filterText: item.filterText,
            insertText,
            insertTextFormat: item.insertText && typeof item.insertText === "object" && "value" in item.insertText ? 2 : 1
          });
        }
      } catch (err) {
        console.error("Error in completion provider:", err);
      }
    }
    return allItems;
  }
  async provideHover(uriStr, line, character) {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return null;
    const pos = new Position(line, character);
    const cancelToken = new CancellationTokenSource().token;
    for (const entry of this._hoverProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const hover = await entry.provider.provideHover(doc, pos, cancelToken);
        if (hover && hover.contents && hover.contents.length > 0) {
          const contents = hover.contents.map((c) => typeof c === "string" ? c : c.value);
          return {
            contents,
            range: hover.range ? {
              start: { line: hover.range.start.line, character: hover.range.start.character },
              end: { line: hover.range.end.line, character: hover.range.end.character }
            } : void 0
          };
        }
      } catch (err) {
        console.error("Error in hover provider:", err);
      }
    }
    return null;
  }
  async provideDefinition(uriStr, line, character) {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const pos = new Position(line, character);
    const cancelToken = new CancellationTokenSource().token;
    const results = [];
    for (const entry of this._definitionProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const def = await entry.provider.provideDefinition(doc, pos, cancelToken);
        if (!def) continue;
        const list = Array.isArray(def) ? def : [def];
        for (const loc of list) {
          if ("targetUri" in loc) {
            results.push({
              uri: loc.targetUri.toString(),
              range: {
                start: { line: loc.targetRange.start.line, character: loc.targetRange.start.character },
                end: { line: loc.targetRange.end.line, character: loc.targetRange.end.character }
              }
            });
          } else if ("uri" in loc) {
            results.push({
              uri: loc.uri.toString(),
              range: {
                start: { line: loc.range.start.line, character: loc.range.start.character },
                end: { line: loc.range.end.line, character: loc.range.end.character }
              }
            });
          }
        }
      } catch (err) {
        console.error("Error in definition provider:", err);
      }
    }
    return results;
  }
  async provideFormatting(uriStr, options) {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const cancelToken = new CancellationTokenSource().token;
    for (const entry of this._formattingProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const edits = await entry.provider.provideDocumentFormattingEdits(doc, options, cancelToken);
        if (edits && edits.length > 0) {
          return edits.map((e) => ({
            range: {
              start: { line: e.range.start.line, character: e.range.start.character },
              end: { line: e.range.end.line, character: e.range.end.character }
            },
            newText: e.newText
          }));
        }
      } catch (err) {
        console.error("Error in formatting provider:", err);
      }
    }
    return [];
  }
  async provideCodeActions(uriStr, rangeObj, context) {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const range = new Range(rangeObj.start.line, rangeObj.start.character, rangeObj.end.line, rangeObj.end.character);
    const cancelToken = new CancellationTokenSource().token;
    const allActions = [];
    for (const entry of this._codeActionsProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const actions = await entry.provider.provideCodeActions(doc, range, context || { diagnostics: [] }, cancelToken);
        if (!actions) continue;
        for (const action of actions) {
          allActions.push({
            title: action.title,
            kind: action.kind?.value || action.kind,
            isPreferred: action.isPreferred,
            command: action.command,
            edit: action.edit ? {
              changes: action.edit.entries().map(([u, edits]) => ({
                uri: u.toString(),
                edits: edits.map((e) => ({
                  range: {
                    start: { line: e.range.start.line, character: e.range.start.character },
                    end: { line: e.range.end.line, character: e.range.end.character }
                  },
                  newText: e.newText
                }))
              }))
            } : void 0
          });
        }
      } catch (err) {
        console.error("Error in code action provider:", err);
      }
    }
    return allActions;
  }
};

// src/api/window.ts
var ExtHostTextEditor = class {
  constructor(document, _workspace, _rpc) {
    this.document = document;
    this._workspace = _workspace;
    this._rpc = _rpc;
  }
  selection = new Selection(0, 0, 0, 0);
  selections = [this.selection];
  visibleRanges = [new Range(0, 0, 100, 0)];
  async edit(callback) {
    const edits = [];
    const editBuilder = {
      replace: (location, value) => {
        edits.push(new TextEdit(location, value));
      },
      insert: (location, value) => {
        edits.push(new TextEdit(new Range(location, location), value));
      },
      delete: (location) => {
        edits.push(new TextEdit(location, ""));
      }
    };
    callback(editBuilder);
    const serialized = edits.map((e) => ({
      range: {
        start: { line: e.range.start.line, character: e.range.start.character },
        end: { line: e.range.end.line, character: e.range.end.character }
      },
      newText: e.newText
    }));
    try {
      await this._rpc.sendRequest("workspace/applyEdit", {
        edits: [{ uri: this.document.uri.toString(), edits: serialized }]
      });
      return true;
    } catch {
      return false;
    }
  }
  insertSnippet(snippet, location) {
    const text = typeof snippet === "string" ? snippet : snippet.value;
    return this._rpc.sendRequest("window/insertSnippet", {
      uri: this.document.uri.toString(),
      snippet: text,
      location
    });
  }
  setDecorations(decorationType, rangesOrOptions) {
    const serialized = rangesOrOptions.map((item) => {
      if (item instanceof Range) {
        return {
          range: {
            start: { line: item.start.line, character: item.start.character },
            end: { line: item.end.line, character: item.end.character }
          }
        };
      }
      return {
        range: item.range ? {
          start: { line: item.range.start.line, character: item.range.start.character },
          end: { line: item.range.end.line, character: item.range.end.character }
        } : void 0,
        renderOptions: item.renderOptions,
        hoverMessage: item.hoverMessage
      };
    });
    this._rpc.sendNotification("window/setDecorations", {
      uri: this.document.uri.toString(),
      key: decorationType.key,
      decorations: serialized
    });
  }
  revealRange(range, revealType) {
    this._rpc.sendNotification("window/revealRange", {
      uri: this.document.uri.toString(),
      range: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character }
      }
    });
  }
};
var ExtHostQuickPick = class {
  constructor(_rpc) {
    this._rpc = _rpc;
  }
  _value = "";
  placeholder = void 0;
  items = [];
  canSelectMany = false;
  matchOnDescription = true;
  matchOnDetail = true;
  activeItems = [];
  selectedItems = [];
  title = void 0;
  step = void 0;
  totalSteps = void 0;
  enabled = true;
  busy = false;
  ignoreFocusOut = false;
  buttons = [];
  _onDidChangeValueEmitter = new EventEmitter();
  onDidChangeValue = this._onDidChangeValueEmitter.event;
  _onDidAcceptEmitter = new EventEmitter();
  onDidAccept = this._onDidAcceptEmitter.event;
  _onDidChangeActiveEmitter = new EventEmitter();
  onDidChangeActive = this._onDidChangeActiveEmitter.event;
  _onDidChangeSelectionEmitter = new EventEmitter();
  onDidChangeSelection = this._onDidChangeSelectionEmitter.event;
  _onDidTriggerButtonEmitter = new EventEmitter();
  onDidTriggerButton = this._onDidTriggerButtonEmitter.event;
  _onDidTriggerItemButtonEmitter = new EventEmitter();
  onDidTriggerItemButton = this._onDidTriggerItemButtonEmitter.event;
  _onDidHideEmitter = new EventEmitter();
  onDidHide = this._onDidHideEmitter.event;
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v;
    this._onDidChangeValueEmitter.fire(v);
  }
  show() {
    extHostLog("window", `QuickPick.show title="${this.title}" items=${this.items.length}`);
    if (this._rpc) {
      this._rpc.sendRequest("window/showQuickPick", {
        items: this.items,
        options: {
          title: this.title,
          placeHolder: this.placeholder,
          canPickMany: this.canSelectMany
        }
      }).then((chosen) => {
        extHostLog("window", `QuickPick result:`, chosen);
        if (chosen !== void 0 && chosen !== null) {
          this.selectedItems = Array.isArray(chosen) ? chosen : [chosen];
          this._onDidChangeSelectionEmitter.fire(this.selectedItems);
          this._onDidAcceptEmitter.fire();
        } else {
          this._onDidHideEmitter.fire();
        }
      }).catch((err) => {
        extHostLog("window", `QuickPick error:`, err);
        this._onDidHideEmitter.fire();
      });
    }
  }
  hide() {
    this._onDidHideEmitter.fire();
  }
  dispose() {
    this.hide();
  }
};
var ExtHostInputBox = class {
  constructor(_rpc) {
    this._rpc = _rpc;
  }
  _value = "";
  placeholder = void 0;
  password = false;
  prompt = void 0;
  title = void 0;
  step = void 0;
  totalSteps = void 0;
  enabled = true;
  busy = false;
  ignoreFocusOut = false;
  validationMessage = void 0;
  buttons = [];
  _onDidChangeValueEmitter = new EventEmitter();
  onDidChangeValue = this._onDidChangeValueEmitter.event;
  _onDidAcceptEmitter = new EventEmitter();
  onDidAccept = this._onDidAcceptEmitter.event;
  _onDidTriggerButtonEmitter = new EventEmitter();
  onDidTriggerButton = this._onDidTriggerButtonEmitter.event;
  _onDidHideEmitter = new EventEmitter();
  onDidHide = this._onDidHideEmitter.event;
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v;
    this._onDidChangeValueEmitter.fire(v);
  }
  show() {
    extHostLog("window", `InputBox.show title="${this.title}" prompt="${this.prompt}"`);
    if (this._rpc) {
      this._rpc.sendRequest("window/showInputBox", {
        options: {
          title: this.title,
          prompt: this.prompt,
          placeHolder: this.placeholder,
          value: this._value,
          password: this.password
        }
      }).then((val) => {
        extHostLog("window", `InputBox result: "${val}"`);
        if (val !== void 0 && val !== null) {
          this.value = val;
          this._onDidAcceptEmitter.fire();
        } else {
          this._onDidHideEmitter.fire();
        }
      }).catch((err) => {
        extHostLog("window", `InputBox error:`, err);
        this._onDidHideEmitter.fire();
      });
    }
  }
  hide() {
    this._onDidHideEmitter.fire();
  }
  dispose() {
    this.hide();
  }
};
var ExtHostStatusBarItem = class {
  constructor(id, alignment = 1 /* Left */, priority = 0, _rpc) {
    this.id = id;
    this._rpc = _rpc;
    this.alignment = alignment;
    this.priority = priority;
  }
  text = "";
  tooltip;
  command;
  color;
  backgroundColor;
  priority;
  alignment;
  _visible = false;
  show() {
    this._visible = true;
    this._sync();
  }
  hide() {
    this._visible = false;
    this._sync();
  }
  _sync() {
    this._rpc.sendNotification("window/setStatusBar", {
      id: this.id,
      text: this.text,
      tooltip: typeof this.tooltip === "string" ? this.tooltip : void 0,
      command: typeof this.command === "string" ? this.command : this.command?.command,
      color: typeof this.color === "string" ? this.color : this.color?.id,
      alignment: this.alignment,
      priority: this.priority,
      visible: this._visible
    });
  }
  dispose() {
    this.hide();
  }
};
var ExtHostOutputChannel = class {
  constructor(name, _rpc) {
    this.name = name;
    this._rpc = _rpc;
  }
  logLevel = 3 /* Info */;
  _onDidChangeLogLevel = new EventEmitter();
  onDidChangeLogLevel = this._onDidChangeLogLevel.event;
  append(value) {
    this._rpc.sendNotification("window/outputAppend", { name: this.name, value });
  }
  appendLine(value) {
    this.append(value + "\n");
  }
  replace(value) {
    this.clear();
    this.append(value);
  }
  clear() {
    this._rpc.sendNotification("window/outputClear", { name: this.name });
  }
  show() {
    this._rpc.sendNotification("window/outputShow", { name: this.name });
  }
  hide() {
  }
  trace(message, ...args) {
    this.appendLine(`[Trace] ${message} ${args.length ? args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") : ""}`);
  }
  debug(message, ...args) {
    this.appendLine(`[Debug] ${message} ${args.length ? args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") : ""}`);
  }
  info(message, ...args) {
    this.appendLine(`[Info] ${message} ${args.length ? args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") : ""}`);
  }
  warn(message, ...args) {
    this.appendLine(`[Warn] ${message} ${args.length ? args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") : ""}`);
  }
  error(error, ...args) {
    const errStr = error instanceof Error ? error.stack || error.message : String(error);
    this.appendLine(`[Error] ${errStr} ${args.length ? args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") : ""}`);
  }
  dispose() {
  }
};
function prepareForJson(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (obj instanceof Uint8Array || typeof Buffer !== "undefined" && Buffer.isBuffer(obj)) {
    return Array.from(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(prepareForJson);
  }
  const res = {};
  for (const k of Object.keys(obj)) {
    res[k] = prepareForJson(obj[k]);
  }
  return res;
}
function reviveBytes(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj[0] === "bytes") {
      if (obj[1] && typeof obj[1] === "object" && !(obj[1] instanceof Uint8Array)) {
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
var ExtHostWebview = class {
  constructor(panelId, _rpc, options) {
    this.panelId = panelId;
    this._rpc = _rpc;
    this._options = options || {};
  }
  _html = "";
  _options;
  _onDidReceiveMessageEmitter = new EventEmitter();
  onDidReceiveMessage = this._onDidReceiveMessageEmitter.event;
  get html() {
    return this._html;
  }
  set html(val) {
    this._html = val;
    extHostLog("webview", `setWebviewHtml [${this.panelId}] length: ${val?.length || 0}`);
    this._rpc.sendNotification("window/setWebviewHtml", {
      panelId: this.panelId,
      html: val
    });
  }
  get options() {
    return this._options;
  }
  set options(opts) {
    this._options = opts;
  }
  get cspSource() {
    return "https://file+.vscode-resource.vscode-cdn.net";
  }
  async postMessage(message) {
    extHostLog("webview", `postWebviewMessage to [${this.panelId}]:`, message);
    const safeMessage = prepareForJson(message);
    const res = await this._rpc.sendRequest("window/postWebviewMessage", {
      panelId: this.panelId,
      message: safeMessage
    });
    return res !== false;
  }
  asWebviewUri(localResource) {
    return Uri.parse(`https://file+.vscode-resource.vscode-cdn.net${localResource.path}`);
  }
  handleMessageReceived(message) {
    const revived = reviveBytes(message);
    this._onDidReceiveMessageEmitter.fire(revived);
  }
};
var ExtHostWebviewPanel = class {
  constructor(viewType, title, panelId, options, _rpc) {
    this.viewType = viewType;
    this.title = title;
    this.panelId = panelId;
    this._rpc = _rpc;
    this.webview = new ExtHostWebview(panelId, _rpc, options);
  }
  webview;
  _onDidDisposeEmitter = new EventEmitter();
  onDidDispose = this._onDidDisposeEmitter.event;
  _onDidChangeViewStateEmitter = new EventEmitter();
  onDidChangeViewState = this._onDidChangeViewStateEmitter.event;
  _onDidChangeVisibilityEmitter = new EventEmitter();
  onDidChangeVisibility = this._onDidChangeVisibilityEmitter.event;
  visible = true;
  active = true;
  viewColumn = 1;
  iconPath = void 0;
  get onDidReceiveMessage() {
    return this.webview.onDidReceiveMessage;
  }
  handleMessageReceived(message) {
    this.webview.handleMessageReceived(message);
  }
  reveal(viewColumn, preserveFocus) {
    this._rpc.sendNotification("window/revealWebview", { panelId: this.panelId, viewColumn, preserveFocus });
  }
  dispose() {
    this._rpc.sendNotification("window/disposeWebview", { panelId: this.panelId });
    this._onDidDisposeEmitter.fire();
  }
};
var ExtHostWindow = class {
  constructor(_workspace, _rpc) {
    this._workspace = _workspace;
    this._rpc = _rpc;
  }
  _activeEditor;
  _visibleEditors = [];
  _decorationCounter = 1;
  _statusBarCounter = 1;
  _panelCounter = 1;
  _treeViewProviders = /* @__PURE__ */ new Map();
  _treeViewElements = /* @__PURE__ */ new Map();
  _webviewViewProviders = /* @__PURE__ */ new Map();
  _webviewPanels = /* @__PURE__ */ new Map();
  _webviews = /* @__PURE__ */ new Map();
  onDidChangeActiveTextEditorEmitter = new EventEmitter();
  onDidChangeActiveTextEditor = this.onDidChangeActiveTextEditorEmitter.event;
  onDidChangeVisibleTextEditorsEmitter = new EventEmitter();
  onDidChangeVisibleTextEditors = this.onDidChangeVisibleTextEditorsEmitter.event;
  onDidChangeTextEditorSelectionEmitter = new EventEmitter();
  onDidChangeTextEditorSelection = this.onDidChangeTextEditorSelectionEmitter.event;
  onDidChangeTextEditorVisibleRangesEmitter = new EventEmitter();
  onDidChangeTextEditorVisibleRanges = this.onDidChangeTextEditorVisibleRangesEmitter.event;
  onDidChangeTextEditorOptionsEmitter = new EventEmitter();
  onDidChangeTextEditorOptions = this.onDidChangeTextEditorOptionsEmitter.event;
  onDidChangeTextEditorViewColumnEmitter = new EventEmitter();
  onDidChangeTextEditorViewColumn = this.onDidChangeTextEditorViewColumnEmitter.event;
  get activeTextEditor() {
    return this._activeEditor;
  }
  get visibleTextEditors() {
    return this._visibleEditors.slice();
  }
  setActiveTextEditor(uriStr) {
    if (!uriStr) {
      this._activeEditor = void 0;
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
  createTextEditorDecorationType(options) {
    const key = `dec_${this._decorationCounter++}`;
    return {
      key,
      dispose: () => {
        this._rpc.sendNotification("window/removeDecorationType", { key });
      }
    };
  }
  async showInformationMessage(message, ...items) {
    return this._showMessage(1, message, items);
  }
  async showWarningMessage(message, ...items) {
    return this._showMessage(2, message, items);
  }
  async showErrorMessage(message, ...items) {
    return this._showMessage(3, message, items);
  }
  async _showMessage(severity, message, items) {
    const stringItems = items.map((i) => typeof i === "string" ? i : i.title || String(i));
    const selected = await this._rpc.sendRequest("window/showMessage", {
      severity,
      message,
      items: stringItems
    });
    return selected;
  }
  async showQuickPick(items, options) {
    const resolvedItems = await items;
    const formatted = resolvedItems.map((item) => {
      if (typeof item === "string") return { label: item };
      return item;
    });
    const chosen = await this._rpc.sendRequest("window/showQuickPick", {
      items: formatted,
      options
    });
    if (chosen === null || chosen === void 0) return void 0;
    if (typeof resolvedItems[0] === "string") {
      return typeof chosen === "object" ? chosen.label : chosen;
    }
    return chosen;
  }
  async showInputBox(options) {
    return this._rpc.sendRequest("window/showInputBox", { options });
  }
  createQuickPick() {
    return new ExtHostQuickPick(this._rpc);
  }
  createInputBox() {
    return new ExtHostInputBox(this._rpc);
  }
  async withProgress(options, task) {
    const cts = new CancellationTokenSource();
    const progress = {
      report: (value) => {
        this._rpc.sendNotification("window/reportProgress", { ...value, title: options.title });
      }
    };
    return task(progress, cts.token);
  }
  createOutputChannel(name, options) {
    return new ExtHostOutputChannel(name, this._rpc);
  }
  createStatusBarItem(idOrAlignment, alignmentOrPriority, priority) {
    let id = `status_${this._statusBarCounter++}`;
    let align = 1 /* Left */;
    let prio = 0;
    if (typeof idOrAlignment === "string") {
      id = idOrAlignment;
      if (typeof alignmentOrPriority === "number") align = alignmentOrPriority;
      if (typeof priority === "number") prio = priority;
    } else if (typeof idOrAlignment === "number") {
      align = idOrAlignment;
      if (typeof alignmentOrPriority === "number") prio = alignmentOrPriority;
    }
    return new ExtHostStatusBarItem(id, align, prio, this._rpc);
  }
  registerTreeDataProvider(viewId, provider) {
    this._treeViewProviders.set(viewId, provider);
    this._rpc.sendNotification("window/registerTreeView", { viewId });
    return new Disposable(() => {
      this._treeViewProviders.delete(viewId);
      this._treeViewElements.delete(viewId);
    });
  }
  createTreeView(viewId, options) {
    this.registerTreeDataProvider(viewId, options.treeDataProvider);
    return {
      title: options.title || viewId,
      description: void 0,
      badge: void 0,
      visible: true,
      selection: [],
      onDidChangeSelection: new EventEmitter().event,
      onDidCollapseElement: new EventEmitter().event,
      onDidExpandElement: new EventEmitter().event,
      onDidChangeVisibility: new EventEmitter().event,
      onDidChangeCheckboxState: new EventEmitter().event,
      reveal: async () => {
      },
      dispose: () => {
      }
    };
  }
  async getTreeItemChildren(viewId, elementId) {
    const provider = this._treeViewProviders.get(viewId);
    if (!provider) return [];
    let viewElements = this._treeViewElements.get(viewId);
    if (!viewElements) {
      viewElements = /* @__PURE__ */ new Map();
      this._treeViewElements.set(viewId, viewElements);
    }
    const parentElement = elementId ? viewElements.get(elementId) : void 0;
    try {
      const children = await provider.getChildren(parentElement);
      if (!children || !Array.isArray(children)) return [];
      return await Promise.all(
        children.map(async (c, index) => {
          let item = c;
          if (provider.getTreeItem) {
            try {
              item = await provider.getTreeItem(c);
            } catch (err) {
              console.warn(`[ext-host] error in getTreeItem for view ${viewId}:`, err);
            }
          }
          const id = item?.id || (typeof c === "string" ? c : `${elementId || "root"}_${index}`);
          viewElements.set(id, c);
          let label = "";
          if (typeof item?.label === "string") {
            label = item.label;
          } else if (item?.label && typeof item.label.label === "string") {
            label = item.label.label;
          } else if (typeof c === "string") {
            label = c;
          } else if (c?.label) {
            label = typeof c.label === "string" ? c.label : c.label.label || String(c.label);
          } else {
            label = String(item || "");
          }
          let tooltip = void 0;
          if (typeof item?.tooltip === "string") {
            tooltip = item.tooltip;
          } else if (item?.tooltip?.value) {
            tooltip = item.tooltip.value;
          }
          let icon = void 0;
          if (typeof item?.iconPath === "string") {
            icon = item.iconPath;
          } else if (item?.iconPath?.id) {
            icon = item.iconPath.id;
          } else if (item?.iconPath?.dark) {
            icon = typeof item.iconPath.dark === "string" ? item.iconPath.dark : item.iconPath.dark.path || item.iconPath.dark.fsPath;
          }
          return {
            id,
            label,
            description: typeof item?.description === "string" ? item.description : void 0,
            tooltip,
            icon,
            collapsibleState: item?.collapsibleState ?? 0,
            command: item?.command,
            contextValue: item?.contextValue
          };
        })
      );
    } catch (e) {
      console.warn(`[ext-host] getChildren failed for view ${viewId}:`, e);
      return [];
    }
  }
  createWebviewPanel(viewType, title, showOptions, options) {
    const panelId = `webview_${this._panelCounter++}`;
    const panel = new ExtHostWebviewPanel(viewType, title, panelId, options, this._rpc);
    this._webviewPanels.set(panelId, panel);
    this._rpc.sendNotification("window/createWebviewPanel", {
      panelId,
      viewType,
      title,
      showOptions,
      options
    });
    return panel;
  }
  state = { focused: true };
  _onDidChangeWindowStateEmitter = new EventEmitter();
  onDidChangeWindowState = this._onDidChangeWindowStateEmitter.event;
  activeColorTheme = { kind: 2 };
  // Dark
  _onDidChangeActiveColorThemeEmitter = new EventEmitter();
  onDidChangeActiveColorTheme = this._onDidChangeActiveColorThemeEmitter.event;
  tabGroups = {
    all: [],
    activeTabGroup: void 0,
    onDidChangeTabGroups: new EventEmitter().event,
    onDidChangeTabs: new EventEmitter().event
  };
  activeNotebookEditor = void 0;
  visibleNotebookEditors = [];
  _onDidChangeActiveNotebookEditorEmitter = new EventEmitter();
  onDidChangeActiveNotebookEditor = this._onDidChangeActiveNotebookEditorEmitter.event;
  _onDidChangeVisibleNotebookEditorsEmitter = new EventEmitter();
  onDidChangeVisibleNotebookEditors = this._onDidChangeVisibleNotebookEditorsEmitter.event;
  _onDidChangeNotebookEditorSelectionEmitter = new EventEmitter();
  onDidChangeNotebookEditorSelection = this._onDidChangeNotebookEditorSelectionEmitter.event;
  _onDidChangeNotebookEditorVisibleRangesEmitter = new EventEmitter();
  onDidChangeNotebookEditorVisibleRanges = this._onDidChangeNotebookEditorVisibleRangesEmitter.event;
  async showNotebookDocument(document, options) {
    return {};
  }
  setStatusBarMessage(text, hideAfterTimeout) {
    return new Disposable(() => {
    });
  }
  activeTerminal = void 0;
  terminals = [];
  _onDidChangeActiveTerminalEmitter = new EventEmitter();
  onDidChangeActiveTerminal = this._onDidChangeActiveTerminalEmitter.event;
  _onDidOpenTerminalEmitter = new EventEmitter();
  onDidOpenTerminal = this._onDidOpenTerminalEmitter.event;
  _onDidCloseTerminalEmitter = new EventEmitter();
  onDidCloseTerminal = this._onDidCloseTerminalEmitter.event;
  _onDidChangeTerminalShellIntegrationEmitter = new EventEmitter();
  onDidChangeTerminalShellIntegration = this._onDidChangeTerminalShellIntegrationEmitter.event;
  _onDidChangeTerminalStateEmitter = new EventEmitter();
  onDidChangeTerminalState = this._onDidChangeTerminalStateEmitter.event;
  _onDidExecuteTerminalCommandEmitter = new EventEmitter();
  onDidExecuteTerminalCommand = this._onDidExecuteTerminalCommandEmitter.event;
  createTerminal(nameOrOptions, shellPath, shellArgs) {
    const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions?.name || "Terminal";
    const term = {
      name,
      processId: Promise.resolve(void 0),
      creationOptions: typeof nameOrOptions === "object" ? nameOrOptions : { name, shellPath, shellArgs },
      exitStatus: void 0,
      state: { isInteractedWith: true },
      sendText: () => {
      },
      show: () => {
      },
      hide: () => {
      },
      dispose: () => {
      }
    };
    return term;
  }
  registerTerminalLinkProvider(provider) {
    return new Disposable(() => {
    });
  }
  registerTerminalProfileProvider(id, provider) {
    return new Disposable(() => {
    });
  }
  registerFileDecorationProvider(provider) {
    return new Disposable(() => {
    });
  }
  registerCustomEditorProvider(viewType, provider, options) {
    return new Disposable(() => {
    });
  }
  registerWebviewPanelSerializer(viewType, serializer) {
    return new Disposable(() => {
    });
  }
  _uriHandlers = /* @__PURE__ */ new Set();
  registerUriHandler(handler) {
    extHostLog("window", "registerUriHandler registered");
    this._uriHandlers.add(handler);
    return new Disposable(() => {
      this._uriHandlers.delete(handler);
    });
  }
  handleUri(uriStr) {
    extHostLog("window", `handleUri: ${uriStr}`);
    const uri = Uri.parse(uriStr);
    for (const h of this._uriHandlers) {
      try {
        h.handleUri(uri);
      } catch (e) {
        extHostLog("window", "Error in UriHandler:", e);
      }
    }
  }
  registerWebviewViewProvider(viewId, provider, options) {
    extHostLog("webview", `registerWebviewViewProvider: ${viewId}`);
    this._webviewViewProviders.set(viewId, provider);
    this._rpc.sendNotification("window/registerWebviewView", { viewId });
    return new Disposable(() => {
      this._webviewViewProviders.delete(viewId);
    });
  }
  async resolveWebviewView(viewId, panelId) {
    extHostLog("webview", `resolveWebviewView [${viewId}] for panel [${panelId}]`);
    const provider = this._webviewViewProviders.get(viewId);
    if (!provider) {
      extHostLog("webview", `no webview view provider registered for ${viewId}`);
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
      title: "",
      description: "",
      badge: void 0,
      visible: true,
      show: (preserveFocus) => {
      },
      onDidChangeVisibility: new EventEmitter().event,
      onDidDispose: new EventEmitter().event
    };
    try {
      await provider.resolveWebviewView(
        webviewView,
        {},
        { isCancellationRequested: false, onCancellationRequested: new EventEmitter().event }
      );
      extHostLog("webview", `resolveWebviewView [${viewId}] SUCCESS, HTML length: ${webview.html?.length || 0}`);
      return { success: true, html: webview.html };
    } catch (e) {
      extHostLog("webview", `resolveWebviewView failed for ${viewId}:`, e);
      return { success: false };
    }
  }
  handleWebviewMessage(panelId, message) {
    extHostLog("webview", `handleWebviewMessage [${panelId}]:`, message);
    const revived = reviveBytes(message);
    const panel = this._webviewPanels.get(panelId);
    if (panel) {
      panel.handleMessageReceived(revived);
      return;
    }
    const webview = this._webviews.get(panelId);
    if (webview) {
      webview.handleMessageReceived(revived);
    } else {
      extHostLog("webview", `handleWebviewMessage: no webview or panel found for [${panelId}]`);
    }
  }
};

// src/api/commands.ts
var ExtHostCommands = class {
  constructor(_window, _rpc) {
    this._window = _window;
    this._rpc = _rpc;
    this.registerBuiltinCommands();
  }
  _commands = /* @__PURE__ */ new Map();
  _contexts = /* @__PURE__ */ new Map();
  registerBuiltinCommands() {
    this._commands.set("setContext", async (key, value) => {
      this._contexts.set(key, value);
      this._rpc.sendNotification("commands/setContext", { key, value });
      return value;
    });
    this._commands.set("getContext", async (key) => {
      return this._contexts.get(key);
    });
    this._commands.set("vscode.open", async (uri, options) => {
      return this._rpc.sendRequest("commands/openUri", { uri: uri?.toString?.() || uri, options });
    });
    this._commands.set("vscode.openWith", async (uri, viewId, options) => {
      return this._rpc.sendRequest("commands/openWith", { uri: uri?.toString?.() || uri, viewId, options });
    });
    this._commands.set("vscode.diff", async (left, right, title, options) => {
      return this._rpc.sendRequest("commands/diff", { left: left?.toString?.(), right: right?.toString?.(), title, options });
    });
    this._commands.set("cursorMove", async () => {
    });
    this._commands.set("editorScroll", async () => {
    });
  }
  registerCommand(command, callback, thisArg) {
    extHostLog("commands", `registerCommand: ${command}`);
    const bound = thisArg ? callback.bind(thisArg) : callback;
    this._commands.set(command, bound);
    this._rpc.sendNotification("commands/registerCommand", { command });
    return new Disposable(() => {
      this._commands.delete(command);
      this._rpc.sendNotification("commands/unregisterCommand", { command });
    });
  }
  registerTextEditorCommand(command, callback, thisArg) {
    return this.registerCommand(
      command,
      async (...args) => {
        const editor = this._window.activeTextEditor;
        if (!editor) return;
        return editor.edit((editBuilder) => {
          callback.apply(thisArg, [editor, editBuilder, ...args]);
        });
      },
      thisArg
    );
  }
  async executeCommand(command, ...rest) {
    extHostLog("commands", `executeCommand: ${command}`, rest);
    const handler = this._commands.get(command);
    if (handler) {
      try {
        return await handler(...rest);
      } catch (err) {
        extHostLog("commands", `executeCommand ${command} threw:`, err);
        throw err;
      }
    }
    return this._rpc.sendRequest("commands/executeCommand", { command, args: rest });
  }
  async getCommands(filterInternal) {
    const local = Array.from(this._commands.keys());
    try {
      const remote = await this._rpc.sendRequest("commands/getCommands");
      const all = /* @__PURE__ */ new Set([...local, ...remote]);
      return Array.from(all);
    } catch {
      return local;
    }
  }
  async execute(command, args = []) {
    const handler = this._commands.get(command);
    if (!handler) {
      throw new Error(`Command '${command}' not found in extension host`);
    }
    return handler(...args);
  }
};

// src/api/env.ts
var ExtHostEnv = class {
  constructor(_rpc) {
    this._rpc = _rpc;
  }
  appName = "Anycode";
  appRoot = process.cwd();
  language = "en";
  uriScheme = "vscode";
  machineId = "anycode-machine-id-0000-0000-0000";
  sessionId = "anycode-session-id-0000-0000-0000";
  uiKind = 1;
  // UIKind.Desktop
  isTelemetryEnabled = false;
  isNewAppInstall = false;
  appHost = "desktop";
  shell = process.env.SHELL || "/bin/zsh";
  remoteName = void 0;
  _onDidChangeTelemetryEnabled = new EventEmitter();
  onDidChangeTelemetryEnabled = this._onDidChangeTelemetryEnabled.event;
  _onDidChangeShell = new EventEmitter();
  onDidChangeShell = this._onDidChangeShell.event;
  clipboard = {
    readText: async () => {
      return this._rpc.sendRequest("env/readClipboard");
    },
    writeText: async (value) => {
      await this._rpc.sendRequest("env/writeClipboard", { value });
    }
  };
  async openExternal(target) {
    const uriStr = typeof target === "string" ? target : target.toString();
    extHostLog("env", `openExternal called with: ${uriStr}`);
    try {
      const res = await this._rpc.sendRequest("env/openExternal", { uri: uriStr });
      return res !== false;
    } catch (e) {
      extHostLog("env", `openExternal failed:`, e);
      return false;
    }
  }
  async asExternalUri(target) {
    extHostLog("env", `asExternalUri called with: ${target?.toString?.() || target}`);
    return target;
  }
  createTelemetryLogger(sender, options) {
    const emitter = new EventEmitter();
    return {
      logUsage: (eventName, data) => {
        try {
          sender?.sendEventData?.(eventName, data);
        } catch {
        }
      },
      logError: (errorOrEventName, data) => {
        try {
          if (typeof errorOrEventName === "string") {
            sender?.sendEventData?.(errorOrEventName, data);
          } else {
            sender?.sendErrorData?.(errorOrEventName, data);
          }
        } catch {
        }
      },
      onDidChangeEnableStates: emitter.event,
      isUsageEnabled: true,
      isErrorsEnabled: true,
      dispose: () => {
        try {
          sender?.flush?.();
        } catch {
        }
      }
    };
  }
};

// src/api/context.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var SimpleMemento = class {
  constructor(_filePath) {
    this._filePath = _filePath;
    if (this._filePath && fs2.existsSync(this._filePath)) {
      try {
        this._storage = JSON.parse(fs2.readFileSync(this._filePath, "utf-8"));
      } catch {
      }
    }
  }
  _storage = {};
  keys() {
    return Object.keys(this._storage);
  }
  get(key, defaultValue) {
    return this._storage[key] !== void 0 ? this._storage[key] : defaultValue;
  }
  async update(key, value) {
    if (value === void 0) {
      delete this._storage[key];
    } else {
      this._storage[key] = value;
    }
    if (this._filePath) {
      try {
        fs2.mkdirSync(path2.dirname(this._filePath), { recursive: true });
        fs2.writeFileSync(this._filePath, JSON.stringify(this._storage, null, 2), "utf-8");
      } catch (err) {
        console.error("Failed to save memento:", err);
      }
    }
  }
};
var SimpleSecretStorage = class {
  _secrets = /* @__PURE__ */ new Map();
  _onDidChangeEmitter = new EventEmitter();
  onDidChange = this._onDidChangeEmitter.event;
  async get(key) {
    return this._secrets.get(key);
  }
  async store(key, value) {
    this._secrets.set(key, value);
    this._onDidChangeEmitter.fire({ key });
  }
  async delete(key) {
    this._secrets.delete(key);
    this._onDidChangeEmitter.fire({ key });
  }
};
var ExtHostExtensionContext = class {
  constructor(extensionId, extensionPath, storageDir) {
    this.extensionId = extensionId;
    this.extensionPath = extensionPath;
    this.extensionUri = Uri.file(extensionPath);
    const extStoragePath = path2.join(storageDir, extensionId);
    fs2.mkdirSync(extStoragePath, { recursive: true });
    this.storageUri = Uri.file(extStoragePath);
    this.globalStorageUri = Uri.file(extStoragePath);
    this.storagePath = extStoragePath;
    this.globalStoragePath = extStoragePath;
    this.logPath = path2.join(extStoragePath, "logs");
    this.logUri = Uri.file(this.logPath);
    this.workspaceState = new SimpleMemento(path2.join(extStoragePath, "workspace-state.json"));
    const gm = new SimpleMemento(path2.join(extStoragePath, "global-state.json"));
    this.globalState = Object.assign(gm, {
      setKeysForSync: () => {
      }
    });
    this.secrets = new SimpleSecretStorage();
    let packageJSON = {};
    try {
      const pkgPath = path2.join(extensionPath, "package.json");
      if (fs2.existsSync(pkgPath)) {
        packageJSON = JSON.parse(fs2.readFileSync(pkgPath, "utf-8"));
      }
    } catch {
    }
    this.extension = {
      id: extensionId,
      extensionUri: this.extensionUri,
      extensionPath: this.extensionPath,
      isActive: true,
      packageJSON,
      extensionKind: 1,
      exports: void 0,
      activate: () => Promise.resolve(void 0)
    };
    this.environmentVariableCollection = {
      persistent: true,
      description: "",
      replace: () => {
      },
      append: () => {
      },
      prepend: () => {
      },
      get: () => void 0,
      forEach: () => {
      },
      clear: () => {
      },
      delete: () => {
      },
      [Symbol.iterator]: function* () {
      }
    };
  }
  subscriptions = [];
  workspaceState;
  globalState;
  secrets;
  extensionUri;
  extensionPath;
  storageUri;
  globalStorageUri;
  logUri;
  storagePath;
  globalStoragePath;
  logPath;
  extensionMode = 1;
  // 1 = Production, 2 = Development, 3 = Test
  extension;
  environmentVariableCollection;
  asAbsolutePath(relativePath) {
    return path2.join(this.extensionPath, relativePath);
  }
};

// src/api/vscode.ts
function createVsCodeApi(workspace2, languages2, window2, commands2, env2, getExtension, getAllExtensions) {
  const api = {
    ...types_exports,
    workspace: workspace2,
    languages: languages2,
    window: window2,
    commands: commands2,
    env: env2,
    version: "1.96.0",
    UIKind: {
      Desktop: 1,
      Web: 2
    },
    l10n: {
      bundle: void 0,
      uri: void 0,
      t: (messageOrOptions, ...args) => {
        let message = typeof messageOrOptions === "string" ? messageOrOptions : messageOrOptions.message;
        let formatArgs = typeof messageOrOptions === "object" && messageOrOptions.args ? messageOrOptions.args : args;
        if (formatArgs && formatArgs.length > 0) {
          for (let i = 0; i < formatArgs.length; i++) {
            message = message.replace(new RegExp(`\\{${i}\\}`, "g"), String(formatArgs[i]));
          }
        }
        return message;
      }
    },
    extensions: {
      getExtension: (id) => getExtension ? getExtension(id) : void 0,
      get all() {
        return getAllExtensions ? getAllExtensions() : [];
      },
      onDidChange: new EventEmitter().event
    },
    authentication: {
      getSession: async () => void 0,
      getSessions: async () => [],
      onDidChangeSessions: new EventEmitter().event,
      registerAuthenticationProvider: (id, label, provider, options) => new Disposable(() => {
      })
    },
    tasks: {
      registerTaskProvider: (_type, _provider) => new Disposable(() => {
      }),
      fetchTasks: async (_filter) => [],
      executeTask: async (task) => ({
        task,
        terminate: () => {
        }
      }),
      onDidStartTask: new EventEmitter().event,
      onDidEndTask: new EventEmitter().event,
      onDidStartTaskProcess: new EventEmitter().event,
      onDidEndTaskProcess: new EventEmitter().event,
      taskExecutions: []
    },
    scm: {
      createSourceControl: (id, label, rootUri) => ({
        id,
        label,
        rootUri,
        inputBox: { value: "", placeholder: "" },
        count: 0,
        quickDiffProvider: void 0,
        createResourceGroup: (groupId, groupLabel) => ({
          id: groupId,
          label: groupLabel,
          resourceStates: [],
          dispose: () => {
          }
        }),
        dispose: () => {
        }
      }),
      inputBox: { value: "" }
    },
    comments: {
      createCommentController: (id, label) => ({
        id,
        label,
        commentingRangeProvider: void 0,
        createCommentThread: () => ({
          dispose: () => {
          }
        }),
        dispose: () => {
        }
      })
    },
    notebooks: {
      createNotebookController: () => ({ dispose: () => {
      } }),
      registerNotebookCellStatusBarItemProvider: () => new Disposable(() => {
      }),
      onDidChangeNotebookCellExecutionState: new EventEmitter().event
    },
    ExtensionMode: {
      Production: 1,
      Development: 2,
      Test: 3
    },
    ColorThemeKind: {
      Light: 1,
      Dark: 2,
      HighContrast: 3,
      HighContrastLight: 4
    },
    EndOfLine: {
      LF: 1,
      CRLF: 2
    }
  };
  api.default = api;
  api.__esModule = true;
  return api;
}

// src/index.ts
var rawStderrWrite2 = process.stderr.write.bind(process.stderr);
function extHostLog2(...args) {
  rawStderrWrite2(args.map((a) => typeof a === "object" ? a?.stack || JSON.stringify(a) : String(a)).join(" ") + "\n");
}
process.on("uncaughtException", (err) => {
  if (err?.code === "EPIPE") return;
  extHostLog2("[ext-host] Uncaught exception in extension host:", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  extHostLog2("[ext-host] Unhandled promise rejection in extension host:", reason?.stack || reason);
});
process.stdout.on("error", (err) => {
  if (err?.code === "EPIPE") return;
  extHostLog2("[ext-host] stdout error:", err);
});
process.stderr.on("error", (err) => {
  if (err?.code === "EPIPE") return;
});
process.stdin.on("end", () => {
  process.exit(0);
});
process.stdin.on("close", () => {
  process.exit(0);
});
var Module = require("module");
var originalLoad = Module._load;
var rpc = new RpcConnection(process.stdin, process.stdout);
var workspace = new ExtHostWorkspace(rpc);
var languages = new ExtHostLanguages(workspace, rpc);
var window = new ExtHostWindow(workspace, rpc);
var commands = new ExtHostCommands(window, rpc);
var env = new ExtHostEnv(rpc);
var activeExtensions = /* @__PURE__ */ new Map();
var storageDirectory = path3.join(process.cwd(), ".anycode-ext-storage");
var vscodeApi = createVsCodeApi(
  workspace,
  languages,
  window,
  commands,
  env,
  (id) => {
    const found = activeExtensions.get(id) || activeExtensions.get(id.toLowerCase());
    return found ? found.context.extension : void 0;
  },
  () => Array.from(activeExtensions.values()).map((e) => e.context.extension)
);
var dummyPtySpawn = (cmd, args, opt) => ({
  onData: (cb) => ({ dispose: () => {
  } }),
  onExit: (cb) => ({ dispose: () => {
  } }),
  write: (_data) => {
  },
  resize: (_cols, _rows) => {
  },
  kill: (_signal) => {
  },
  pid: process.pid
});
var dummyPtyModule = (cmd, args, opt) => dummyPtySpawn(cmd, args, opt);
dummyPtyModule.spawn = dummyPtySpawn;
dummyPtyModule.open = () => ({});
Module._load = function(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeApi;
  }
  if (typeof request === "string" && (request.includes("node-pty") || request === "node-pty" || request.endsWith("@theia/node-pty") || request.endsWith("@vscode/node-pty"))) {
    return dummyPtyModule;
  }
  return originalLoad.apply(this, arguments);
};
rpc.onRequest("extHost/init", async (params) => {
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
rpc.onRequest("extHost/activateExtension", async (params) => {
  const { id, extensionPath, mainFile } = params;
  if (activeExtensions.has(id)) {
    return { success: true, alreadyActive: true };
  }
  if (!mainFile) {
    return { success: true, declarativeOnly: true };
  }
  const fullMainPath = path3.isAbsolute(mainFile) ? mainFile : path3.join(extensionPath, mainFile);
  if (!fs3.existsSync(fullMainPath)) {
    throw new Error(`Extension main entry point does not exist: ${fullMainPath}`);
  }
  const context = new ExtHostExtensionContext(id, extensionPath, storageDirectory);
  try {
    const activeItem = {
      id,
      extensionPath,
      context,
      exports: void 0
    };
    activeExtensions.set(id, activeItem);
    const pkg = context.extension.packageJSON;
    if (pkg?.contributes?.configuration) {
      const cfgs = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
      for (const cfg of cfgs) {
        if (cfg?.properties) {
          for (const [propKey, propVal] of Object.entries(cfg.properties)) {
            if (propVal?.default !== void 0) {
              workspace.setDefaultConfiguration(propKey, propVal.default);
            }
          }
        }
      }
    }
    const extModule = require(fullMainPath);
    let exports2 = void 0;
    if (extModule && typeof extModule.activate === "function") {
      exports2 = await extModule.activate(context);
    }
    activeItem.exports = exports2;
    activeItem.deactivate = extModule?.deactivate;
    return { success: true };
  } catch (err) {
    activeExtensions.delete(id);
    extHostLog2(`[ext-host] Failed to activate extension ${id}:`, err?.stack || err);
    throw new Error(`Failed to activate ${id}: ${err?.message || String(err)}`);
  }
});
rpc.onRequest("extHost/deactivateExtension", async (params) => {
  const ext = activeExtensions.get(params.id);
  if (!ext) return { success: true };
  try {
    if (typeof ext.deactivate === "function") {
      await ext.deactivate();
    }
  } catch (err) {
    console.error(`Error in deactivate for ${params.id}:`, err);
  }
  for (const sub of ext.context.subscriptions) {
    try {
      sub.dispose();
    } catch {
    }
  }
  activeExtensions.delete(params.id);
  return { success: true };
});
rpc.onNotification("textDocument/didOpen", (params) => {
  workspace.handleDocumentOpened(params.uri, params.languageId, params.version, params.text);
});
rpc.onNotification("textDocument/didChange", (params) => {
  workspace.handleDocumentChanged(params.uri, params.version, params.changes, params.fullText);
});
rpc.onNotification("textDocument/didSave", (params) => {
  workspace.handleDocumentSaved(params.uri);
});
rpc.onNotification("textDocument/didClose", (params) => {
  workspace.handleDocumentClosed(params.uri);
});
rpc.onNotification("window/activeEditorChanged", (params) => {
  window.setActiveTextEditor(params.uri);
});
rpc.onRequest("textDocument/completion", async (params) => {
  return languages.provideCompletions(params.uri, params.line, params.character, params.context);
});
rpc.onRequest("textDocument/hover", async (params) => {
  return languages.provideHover(params.uri, params.line, params.character);
});
rpc.onRequest("textDocument/definition", async (params) => {
  return languages.provideDefinition(params.uri, params.line, params.character);
});
rpc.onRequest("textDocument/formatting", async (params) => {
  return languages.provideFormatting(params.uri, params.options);
});
rpc.onRequest("textDocument/codeAction", async (params) => {
  return languages.provideCodeActions(params.uri, params.range, params.context);
});
rpc.onRequest("commands/executeCommand", async (params) => {
  return commands.execute(params.command, params.args || []);
});
rpc.onRequest("treeView/getChildren", async (params) => {
  return window.getTreeItemChildren(params.viewId, params.elementId);
});
rpc.onRequest("webviewView/resolve", async (params) => {
  return window.resolveWebviewView(params.viewId, params.panelId);
});
rpc.onNotification("webview/onMessage", (params) => {
  window.handleWebviewMessage(params.panelId, params.message);
});
rpc.onNotification("window/handleUri", (params) => {
  window.handleUri(params.uri);
});
rpc.onNotification("workspace/didChangeWorkspaceFolders", (params) => {
  if (params.workspaceRoot) {
    workspace.setWorkspaceRoot(params.workspaceRoot);
  }
});
rpc.sendNotification("extHost/ready", { pid: process.pid, version: "1.96.0" });
