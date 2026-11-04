import {
  CancellationToken,
  CancellationTokenSource,
  CodeAction,
  CodeLens,
  CompletionItem,
  CompletionList,
  Diagnostic,
  DiagnosticSeverity,
  Disposable,
  DocumentHighlight,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InlayHint,
  Location,
  Position,
  Range,
  TextEdit,
  Uri,
  WorkspaceEdit,
} from './types';
import type { ExtHostTextDocument, ExtHostWorkspace } from './workspace';
import type { RpcConnection } from '../rpc';

export type DocumentSelector = string | DocumentFilter | (string | DocumentFilter)[];

export interface DocumentFilter {
  language?: string;
  scheme?: string;
  pattern?: string;
}

export class DiagnosticCollection implements Disposable {
  private _diagnostics = new Map<string, Diagnostic[]>();

  constructor(readonly name: string, private _onChanged: (uri: Uri, diagnostics: Diagnostic[]) => void) {}

  set(uri: Uri, diagnostics: Diagnostic[] | undefined): void {
    const key = uri.toString();
    if (!diagnostics || diagnostics.length === 0) {
      this._diagnostics.delete(key);
      this._onChanged(uri, []);
    } else {
      this._diagnostics.set(key, diagnostics.slice());
      this._onChanged(uri, diagnostics);
    }
  }

  delete(uri: Uri): void {
    this.set(uri, undefined);
  }

  clear(): void {
    for (const uriStr of this._diagnostics.keys()) {
      this._onChanged(Uri.parse(uriStr), []);
    }
    this._diagnostics.clear();
  }

  get(uri: Uri): Diagnostic[] | undefined {
    return this._diagnostics.get(uri.toString());
  }

  forEach(callback: (uri: Uri, diagnostics: Diagnostic[], collection: DiagnosticCollection) => any): void {
    for (const [key, diags] of this._diagnostics.entries()) {
      callback(Uri.parse(key), diags, this);
    }
  }

  dispose(): void {
    this.clear();
  }
}

export class ExtHostLanguages {
  private _diagnosticCollections: DiagnosticCollection[] = [];
  private _completionProviders: Array<{ selector: DocumentSelector; provider: any; triggerChars: string[] }> = [];
  private _hoverProviders: Array<{ selector: DocumentSelector; provider: any }> = [];
  private _definitionProviders: Array<{ selector: DocumentSelector; provider: any }> = [];
  private _referenceProviders: Array<{ selector: DocumentSelector; provider: any }> = [];
  private _formattingProviders: Array<{ selector: DocumentSelector; provider: any }> = [];
  private _codeActionsProviders: Array<{ selector: DocumentSelector; provider: any }> = [];
  private _renameProviders: Array<{ selector: DocumentSelector; provider: any }> = [];

  constructor(private _workspace: ExtHostWorkspace, private _rpc: RpcConnection) {}

  createDiagnosticCollection(name = 'default'): DiagnosticCollection {
    const coll = new DiagnosticCollection(name, (uri, diags) => {
      this._rpc.sendNotification('languages/publishDiagnostics', {
        uri: uri.toString(),
        diagnostics: diags.map((d) => ({
          range: {
            start: { line: d.range.start.line, character: d.range.start.character },
            end: { line: d.range.end.line, character: d.range.end.character },
          },
          message: d.message,
          severity: d.severity,
          source: d.source || name,
          code: typeof d.code === 'object' ? d.code?.value : d.code,
        })),
      });
    });
    this._diagnosticCollections.push(coll);
    return coll;
  }

  registerCompletionItemProvider(selector: DocumentSelector, provider: any, ...triggerCharacters: string[]): Disposable {
    const entry = { selector, provider, triggerChars: triggerCharacters };
    this._completionProviders.push(entry);
    return new Disposable(() => {
      const idx = this._completionProviders.indexOf(entry);
      if (idx >= 0) this._completionProviders.splice(idx, 1);
    });
  }

  registerHoverProvider(selector: DocumentSelector, provider: any): Disposable {
    const entry = { selector, provider };
    this._hoverProviders.push(entry);
    return new Disposable(() => {
      const idx = this._hoverProviders.indexOf(entry);
      if (idx >= 0) this._hoverProviders.splice(idx, 1);
    });
  }

  registerDefinitionProvider(selector: DocumentSelector, provider: any): Disposable {
    const entry = { selector, provider };
    this._definitionProviders.push(entry);
    return new Disposable(() => {
      const idx = this._definitionProviders.indexOf(entry);
      if (idx >= 0) this._definitionProviders.splice(idx, 1);
    });
  }

  registerTypeDefinitionProvider(selector: DocumentSelector, provider: any): Disposable {
    return this.registerDefinitionProvider(selector, provider);
  }

  registerImplementationProvider(selector: DocumentSelector, provider: any): Disposable {
    return this.registerDefinitionProvider(selector, provider);
  }

  registerDeclarationProvider(selector: DocumentSelector, provider: any): Disposable {
    return this.registerDefinitionProvider(selector, provider);
  }

  registerReferenceProvider(selector: DocumentSelector, provider: any): Disposable {
    const entry = { selector, provider };
    this._referenceProviders.push(entry);
    return new Disposable(() => {
      const idx = this._referenceProviders.indexOf(entry);
      if (idx >= 0) this._referenceProviders.splice(idx, 1);
    });
  }

  registerDocumentFormattingEditProvider(selector: DocumentSelector, provider: any): Disposable {
    const entry = { selector, provider };
    this._formattingProviders.push(entry);
    return new Disposable(() => {
      const idx = this._formattingProviders.indexOf(entry);
      if (idx >= 0) this._formattingProviders.splice(idx, 1);
    });
  }

  registerDocumentRangeFormattingEditProvider(selector: DocumentSelector, provider: any): Disposable {
    return this.registerDocumentFormattingEditProvider(selector, provider);
  }

  registerCodeActionsProvider(selector: DocumentSelector, provider: any, metadata?: any): Disposable {
    const entry = { selector, provider };
    this._codeActionsProviders.push(entry);
    return new Disposable(() => {
      const idx = this._codeActionsProviders.indexOf(entry);
      if (idx >= 0) this._codeActionsProviders.splice(idx, 1);
    });
  }

  registerRenameProvider(selector: DocumentSelector, provider: any): Disposable {
    const entry = { selector, provider };
    this._renameProviders.push(entry);
    return new Disposable(() => {
      const idx = this._renameProviders.indexOf(entry);
      if (idx >= 0) this._renameProviders.splice(idx, 1);
    });
  }

  registerCodeLensProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerInlayHintsProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerDocumentHighlightProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerDocumentSymbolProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerWorkspaceSymbolProvider(provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerDocumentSemanticTokensProvider(selector: DocumentSelector, provider: any, legend: any): Disposable {
    return new Disposable(() => {});
  }

  registerDocumentRangeSemanticTokensProvider(selector: DocumentSelector, provider: any, legend: any): Disposable {
    return new Disposable(() => {});
  }

  registerSignatureHelpProvider(selector: DocumentSelector, provider: any, ...triggerCharacters: string[]): Disposable {
    return new Disposable(() => {});
  }

  registerDocumentLinkProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerColorProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerFoldingRangeProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerSelectionRangeProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerCallHierarchyProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerTypeHierarchyProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  registerInlineCompletionItemProvider(selector: DocumentSelector, provider: any): Disposable {
    return new Disposable(() => {});
  }

  async getLanguages(): Promise<string[]> {
    return ['javascript', 'typescript', 'rust', 'python', 'json', 'html', 'css', 'markdown'];
  }

  getDiagnostics(resource?: Uri): any {
    if (resource) {
      return this._diagnosticCollections.flatMap((c) => c.get(resource) || []);
    }
    return [];
  }

  matchDocument(selector: DocumentSelector, document: ExtHostTextDocument): boolean {
    if (typeof selector === 'string') {
      return selector === '*' || selector === document.languageId;
    }
    if (Array.isArray(selector)) {
      return selector.some((s) => this.matchDocument(s, document));
    }
    if (selector.language && selector.language !== '*' && selector.language !== document.languageId) {
      return false;
    }
    if (selector.scheme && selector.scheme !== document.uri.scheme) {
      return false;
    }
    return true;
  }

  // --- Provider Query Dispatchers ---

  async provideCompletions(uriStr: string, line: number, character: number, context?: any): Promise<any[]> {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const pos = new Position(line, character);
    const cancelToken = new CancellationTokenSource().token;

    const allItems: any[] = [];
    for (const entry of this._completionProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const res = await entry.provider.provideCompletionItems(doc, pos, cancelToken, context);
        if (!res) continue;
        const items: CompletionItem[] = Array.isArray(res) ? res : res.items || [];
        for (const item of items) {
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          let insertText = label;
          if (typeof item.insertText === 'string') {
            insertText = item.insertText;
          } else if (item.insertText && 'value' in item.insertText) {
            insertText = item.insertText.value;
          }

          let docText = '';
          if (typeof item.documentation === 'string') {
            docText = item.documentation;
          } else if (item.documentation && 'value' in item.documentation) {
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
            insertTextFormat: item.insertText && typeof item.insertText === 'object' && 'value' in item.insertText ? 2 : 1,
          });
        }
      } catch (err) {
        console.error('Error in completion provider:', err);
      }
    }
    return allItems;
  }

  async provideHover(uriStr: string, line: number, character: number): Promise<any | null> {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return null;
    const pos = new Position(line, character);
    const cancelToken = new CancellationTokenSource().token;

    for (const entry of this._hoverProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const hover: Hover = await entry.provider.provideHover(doc, pos, cancelToken);
        if (hover && hover.contents && hover.contents.length > 0) {
          const contents = hover.contents.map((c) => (typeof c === 'string' ? c : c.value));
          return {
            contents,
            range: hover.range
              ? {
                  start: { line: hover.range.start.line, character: hover.range.start.character },
                  end: { line: hover.range.end.line, character: hover.range.end.character },
                }
              : undefined,
          };
        }
      } catch (err) {
        console.error('Error in hover provider:', err);
      }
    }
    return null;
  }

  async provideDefinition(uriStr: string, line: number, character: number): Promise<any[]> {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const pos = new Position(line, character);
    const cancelToken = new CancellationTokenSource().token;

    const results: any[] = [];
    for (const entry of this._definitionProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const def = await entry.provider.provideDefinition(doc, pos, cancelToken);
        if (!def) continue;
        const list = Array.isArray(def) ? def : [def];
        for (const loc of list) {
          if ('targetUri' in loc) {
            results.push({
              uri: loc.targetUri.toString(),
              range: {
                start: { line: loc.targetRange.start.line, character: loc.targetRange.start.character },
                end: { line: loc.targetRange.end.line, character: loc.targetRange.end.character },
              },
            });
          } else if ('uri' in loc) {
            results.push({
              uri: loc.uri.toString(),
              range: {
                start: { line: loc.range.start.line, character: loc.range.start.character },
                end: { line: loc.range.end.line, character: loc.range.end.character },
              },
            });
          }
        }
      } catch (err) {
        console.error('Error in definition provider:', err);
      }
    }
    return results;
  }

  async provideFormatting(uriStr: string, options: any): Promise<any[]> {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const cancelToken = new CancellationTokenSource().token;

    for (const entry of this._formattingProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const edits: TextEdit[] = await entry.provider.provideDocumentFormattingEdits(doc, options, cancelToken);
        if (edits && edits.length > 0) {
          return edits.map((e) => ({
            range: {
              start: { line: e.range.start.line, character: e.range.start.character },
              end: { line: e.range.end.line, character: e.range.end.character },
            },
            newText: e.newText,
          }));
        }
      } catch (err) {
        console.error('Error in formatting provider:', err);
      }
    }
    return [];
  }

  async provideCodeActions(uriStr: string, rangeObj: any, context?: any): Promise<any[]> {
    const doc = this._workspace.getDocument(uriStr);
    if (!doc) return [];
    const range = new Range(rangeObj.start.line, rangeObj.start.character, rangeObj.end.line, rangeObj.end.character);
    const cancelToken = new CancellationTokenSource().token;

    const allActions: any[] = [];
    for (const entry of this._codeActionsProviders) {
      if (!this.matchDocument(entry.selector, doc)) continue;
      try {
        const actions: (CodeAction | any)[] = await entry.provider.provideCodeActions(doc, range, context || { diagnostics: [] }, cancelToken);
        if (!actions) continue;
        for (const action of actions) {
          allActions.push({
            title: action.title,
            kind: action.kind?.value || action.kind,
            isPreferred: action.isPreferred,
            command: action.command,
            edit: action.edit
              ? {
                  changes: action.edit.entries().map(([u, edits]: [Uri, TextEdit[]]) => ({
                    uri: u.toString(),
                    edits: edits.map((e) => ({
                      range: {
                        start: { line: e.range.start.line, character: e.range.start.character },
                        end: { line: e.range.end.line, character: e.range.end.character },
                      },
                      newText: e.newText,
                    })),
                  })),
                }
              : undefined,
          });
        }
      } catch (err) {
        console.error('Error in code action provider:', err);
      }
    }
    return allActions;
  }
}
