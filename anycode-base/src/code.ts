import {
    PieceTreeBase,
    PieceTreeTextBufferBuilder
} from 'vscode-textbuffer';

import {
    Range
} from 'vscode-textbuffer/src/common/range';

import {
    Language, Tree, Query,
    Parser as TreeSitterParser,
    Node as SyntaxNode,
    Edit as TreeSitterEdit, QueryCapture
} from 'web-tree-sitter';
import History from './history';
import { Selection } from './selection';
import { BracketMatch } from './types';
import {
    getGraphemeAt, getNextGraphemeIndex, getPrevGraphemeIndex,
    getWasmPath, isWordGrapheme,
    BRACKET_PAIRS, OPEN_BRACKETS, CLOSE_BRACKETS
} from './utils';
import type { Lang } from './lang';

import javascript from './langs/javascript';
import typescript from './langs/typescript';
import tsx from './langs/tsx';
import python from './langs/python';
import rust from './langs/rust';
import yaml from './langs/yaml';
import json from './langs/json';
import toml from './langs/toml';
import html from './langs/html';
import css from './langs/css';
import go from './langs/go';
import java from './langs/java';
import kotlin from './langs/kotlin';
import lua from './langs/lua';
import bash from './langs/bash';
import zig from './langs/zig';
import csharp from './langs/csharp';
import c from './langs/c';
import cpp from './langs/cpp';
import markdown from './langs/markdown';
import markdownInline from './langs/markdown_inline';
import php from './langs/php';
import ruby from './langs/ruby';
import vue from './langs/vue';
import dockerfile from './langs/dockerfile';
import sql from './langs/sql';

export type FilePosition = {
    file: string;
    line: number;
    column: number;
};

export enum Operation {
    Insert = "insert",
    Remove = "remove"
}

export type Edit = {
    operation: Operation;
    start: number;
    text: string;
};

export type EditState = {
    offset: number;
    selection?: Selection;
};

export type Change = {
    edits: Edit[];
    stateBefore?: EditState;
    stateAfter?: EditState;
    isUndo?: boolean;
    isRedo?: boolean;
};

export type Position = {
    line: number;
    column: number;
}

export type WordHighlight = {
    text: string;
    token: string | null;
};

export function areWordHighlightsEqual(
    a: WordHighlight | null,
    b: WordHighlight | null
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.text === b.text && a.token === b.token;
}


export interface HighlighedNode {
    name: string | null;
    text: string;
}

export interface Patch {
    start: number;
    search: string;
    replace: string;
}

export interface FoldRange {
    startLine: number;
    endLine: number;
    kind: string;
}

var langsCache: Map<string, Language> = new Map();
var pendingLangsCache: Map<string, Promise<Language>> = new Map();
var queriesCache: Map<string, Query> = new Map();

function getCachedQuery(
    lang: Language, languageId: string, queryType: string, queryText: string
): Query {
    const key = `${languageId}:${queryType}`;
    if (queriesCache.has(key)) {
        return queriesCache.get(key)!;
    }
    const query = new Query(lang, queryText);
    queriesCache.set(key, query);
    return query;
}


async function loadLanguage(language: string): Promise<Language> {
    if (langsCache.has(language)) {
        return langsCache.get(language)!;
    }

    let loadPromise = pendingLangsCache.get(language);
    if (!loadPromise) {
        const wasmPath = getWasmPath(`tree-sitter-${language}.wasm`);
        loadPromise = Language.load(wasmPath);
        pendingLangsCache.set(language, loadPromise);
    }

    try {
        const lang = await loadPromise;
        if (!lang) {
            throw new Error(`Language.load returned ${String(lang)} for ${language}`);
        }
        langsCache.set(language, lang);
        return lang;
    } finally {
        pendingLangsCache.delete(language);
    }
}

export class Code {
    public filename: string
    private buffer: PieceTreeBase
    public language: string | undefined
    private parser: TreeSitterParser | undefined
    private tree: Tree | undefined
    private query: Query | undefined
    private foldsQuery: Query | undefined
    private runnablesQuery: Query | undefined
    private foldRanges: FoldRange[] = []
    private foldRangesInvalidated: boolean = true;

    public runnables: Map<number, any> = new Map()

    private linesCache: Map<number, HighlighedNode[]> = new Map()

    private history = new History<Change>()
    private changeActive: boolean = false;
    private changeEdits: Edit[] = [];
    private changeStateBefore?: EditState;
    private changeStateAfter?: EditState;

    private onChange: ((t: Change) => void) | null = null
    private readonly changeListeners = new Set<(t: Change) => void>();

    private injection_parsers: Map<string, TreeSitterParser> = new Map()
    private injection_queries: Map<string, Query> = new Map()
    private injectionCache = new Map<string, {
        startIndex: number;
        endIndex: number;
        name: string;
    }[]>();

    constructor(content: string = '', filename: string = '', language: string = 'text') {
        const builder = new PieceTreeTextBufferBuilder();
        builder.acceptChunk(content);
        const pieceTree = builder.finish(true).create(1);
        this.buffer = pieceTree;
        this.language = language;
        this.filename = filename;
        this.input = this.input.bind(this);
    }

    public resolvePosition(row: number, column: number): FilePosition {
        return { file: this.filename, line: row, column };
    }

    private clearSyntaxState() {
        this.parser = undefined;
        this.tree = undefined;
        this.query = undefined;
        this.foldsQuery = undefined;
        this.runnablesQuery = undefined;
        this.foldRanges = [];
        this.injection_parsers.clear();
        this.injection_queries.clear();
        this.injectionCache.clear();
    }

    public async init() {
        if (!this.language || !this.getLang(this.language)) {
            this.language = undefined;
            this.clearSyntaxState();
            return;
        }

        let lang: Language;
        try {
            await TreeSitterParser.init();
            lang = await loadLanguage(this.language);
        } catch (error) {
            console.error(`Failed to initialize tree-sitter language "${this.language}"`, error);
            this.language = undefined;
            this.clearSyntaxState();
            return;
        }

        this.parser = new TreeSitterParser();
        this.parser.setLanguage(lang);

        this.tree = this.parser.parse(this.input) || undefined;

        if (this.language) {
            let q = this.getQuery();
            if (q) this.query = getCachedQuery(lang, this.language, 'highlight', q);
            const foldsQ = this.getFoldsQuery();
            if (foldsQ) this.foldsQuery = getCachedQuery(lang, this.language, 'folds', foldsQ);
            const runnablesQ = this.getRunnablesQuery();
            if (runnablesQ) this.runnablesQuery = getCachedQuery(lang, this.language, 'runnables', runnablesQ);
            this.foldRangesInvalidated = true;
            if (this.query) await this.initInjections();
            // let tq = this.getRunnablesQuery();
            // if (tq) this.runnablesQuery = lang.query(tq);
            // if (this.runnablesQuery || this.isExecutable()) this.updateRunnables();
        }
    }

    public async initInjections() {
        if (!this.query) return;

        for (const name of this.query.captureNames) {
            if (name.startsWith("injection.content.")) {
                const language = name.slice("injection.content.".length);

                if (this.injection_parsers.has(language) 
                    && this.injection_queries.has(language)) {
                    continue;
                }

                let parser = new TreeSitterParser();

                if (!this.getLang(language)) {
                    continue;
                }

                let lang: Language;
                try {
                    lang = await loadLanguage(language);
                } catch (error) {
                    console.error(`Failed to initialize injected tree-sitter language "${language}"`, error);
                    continue;
                }

                parser.setLanguage(lang);
                this.injection_parsers.set(language, parser);

                try {
                    const l = this.getLang(language);
                    let query = l?.query;
                    if (query) {
                        this.injection_queries.set(language, getCachedQuery(lang, language, 'highlight', query));
                    } else {
                        console.error(`No query available for ${language}`);
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    private buildInjectionCaptures(captures: any[]) {
        const injectionCaptures: Array<{
            startIndex: number;
            endIndex: number;
            name: string;
        }> = [];
    
        for (const capture of captures) {
            if (!capture.name.startsWith("injection.content.")) continue;
    
            const injectionLanguage = capture.name.slice("injection.content.".length);
            if (!this.injection_parsers.has(injectionLanguage) || 
                !this.injection_queries.has(injectionLanguage)) continue;
    
            // ---- cache key ----
            const key = `${injectionLanguage}:${capture.node.startIndex}-${capture.node.endIndex}`;
            if (this.injectionCache.has(key)) {
                injectionCaptures.push(...this.injectionCache.get(key)!);
                continue;
            }
    
            const injectionParser = this.injection_parsers.get(injectionLanguage)!;
            const injectionQuery = this.injection_queries.get(injectionLanguage)!;
            const injectionContent = this.getIntervalContent2(
                capture.node.startIndex, 
                capture.node.endIndex
            );
    
            const injectionTree = injectionParser.parse(injectionContent);
            if (!injectionTree) continue;
            const injectionTreeCaptures = injectionQuery.captures(injectionTree.rootNode);
    
            const results = injectionTreeCaptures.map(ic => ({
                startIndex: capture.node.startIndex + ic.node.startIndex,
                endIndex: capture.node.startIndex + ic.node.endIndex,
                name: ic.name
            }));
    
            // save to cache
            this.injectionCache.set(key, results);
            injectionCaptures.push(...results);
        }
        return injectionCaptures;
    }

    /**
      * Custom parser input function for tree-sitter
    */
    private input(startIndex: number, startPoint: any, endIndex?: number): string {
        let start = startIndex;
        let end = endIndex !== undefined ? endIndex : this.buffer.getLength();

        let startPosition = this.buffer.getPositionAt(start);
        let endPosition = this.buffer.getPositionAt(end);

        let value = this.buffer.getValueInRange(new Range(
            startPosition.lineNumber, startPosition.column,
            endPosition.lineNumber, endPosition.column
        ));

        return value;
    };

    public getContent(): string {
        return this.buffer.getLinesContent().join("\n");
    }

    public getLines(): string[] {
        return this.buffer.getLinesContent();
    }

    public getContentLength(): number {
        return this.buffer.getLength();
    }

    public getIntervalContent(
        startLine: number, startColumn: number,
        endLine: number, endColumn: number
    ): string {
        let v = this.buffer.getValueInRange(
            new Range(startLine+1, startColumn+1, endLine + 1, endColumn+1)
        );
        return v;
    }

    public getIntervalContent2(from: number, to: number): string {
        let start = this.buffer.getPositionAt(from);
        let end = this.buffer.getPositionAt(to);

        let v = this.buffer.getValueInRange(
            new Range(
                start.lineNumber, start.column,
                end.lineNumber, end.column
            )
        );
        return v;
    }

    public setOnChange(onTx: (t: Change) => void ) {
        this.onChange = onTx;
    }

    public addChangeListener(listener: (change: Change) => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    public notifyChange(change: Change): void {
        this.onChange?.(change);
        for (const listener of this.changeListeners) {
            listener(change);
        }
    }

    public getOffset(line: number, column: number): number {
        return this.buffer.getOffsetAt(line + 1, column + 1)
    }

    public getPosition(offset: number): Position {
        let p = this.buffer.getPositionAt(offset);
        return { line: p.lineNumber -1, column: p.column -1};
    }

    public getLineByOffset(offset: number): number {
        let p = this.buffer.getPositionAt(offset);
        return p.lineNumber - 1;
    }

    public getPrevLine(line: number): number {
        return line - 1;
    }

    public getNextLine(line: number): number {
        return line + 1;
    }

    public length(): number {
        return this.buffer.getLength()
    }

    public linesLength(): number {
        return this.buffer.getLineCount()
    }

    public line(i: number): string {
        return this.buffer.getLineContent(i + 1)
    }

    public lineAt(offset: number): string {
        let position = this.getPosition(offset);
        return this.line(position.line)
    }

    public lineLength(i: number): number {
        return this.buffer.getLineLength(i + 1)
    }

    public insertText(text: string, line: number, column: number) {
        const offset = this.getOffset(line, column);
        this.insert(text, offset, true);
    }

    public setContent(content: string) {
        const pieceTreeTextBufferBuilder = new PieceTreeTextBufferBuilder();
        pieceTreeTextBufferBuilder.acceptChunk(content);
        const pieceTreeFactory = pieceTreeTextBufferBuilder.finish(true);
        const pieceTree = pieceTreeFactory.create(1);
        this.buffer = pieceTree;

        if (this.parser) this.tree = this.parser.parse(this.input) || undefined;
        this.foldRangesInvalidated = true;
    }

    public insert(text: string, offset: number, addHistory: boolean = false) {
        let edit: Edit = {
            operation: Operation.Insert,
            start: offset,
            text
        };

        if (addHistory) {
            let change: Change = { edits: [edit] };
            this.history.push(change);
        }

        if (this.changeActive) {
            this.changeEdits.push(edit);
        }

        const pos = this.getPosition(offset);

        this.buffer.insert(offset, text);
        if (this.tree) this.treeSitterInsert(text, offset);

        this.invalidateCacheFrom(pos.line);
    }

    public removeText(
        fromLine: number, fromColumn: number,
        toLine: number, toColumn: number
    ) {
        const fromOffset = this.getOffset(fromLine, fromColumn);
        const toOffset = this.getOffset(toLine, toColumn);
        this.remove(fromOffset, toOffset - fromOffset, true);
    }

    public remove(offset: number, length: number, addHistory: boolean = false) {
        let start = this.buffer.getPositionAt(offset);
        let end = this.buffer.getPositionAt(offset + length);

        let text = this.buffer.getValueInRange(new Range(
            start.lineNumber, start.column, end.lineNumber, end.column
        ));

        let edit: Edit = {
            operation: Operation.Remove,
            start: offset,
            text
        };

        if (addHistory) {
            let change: Change = { edits: [edit] };
            this.history.push(change);
        }

        if (this.changeActive) {
            this.changeEdits.push(edit);
        }

        const pos = this.getPosition(offset);

        this.buffer.delete(offset, length);
        if (this.tree) this.treeSitterRemove(offset + length, length);

        this.invalidateCacheFrom(pos.line);
    }

    private invalidateCacheFrom(line: number) {
        for (const key of Array.from(this.linesCache.keys())) {
            if (key >= line) {
                this.linesCache.delete(key);
            }
        }
    }

    treeSitterInsert(text: string, offset: number) {
        let len = text.length;

        const startPosition = this.buffer.getPositionAt(offset);
        const oldEndPosition = startPosition;
        const newEndPosition = this.buffer.getPositionAt(offset + len);

        let edit = new TreeSitterEdit({
            startIndex: offset,
            oldEndIndex: offset,
            newEndIndex: offset + len,
            startPosition: { row: startPosition.lineNumber, column: startPosition.column },
            oldEndPosition: { row: oldEndPosition.lineNumber, column: oldEndPosition.column },
            newEndPosition: { row: newEndPosition.lineNumber, column: newEndPosition.column },
        });

        this.treeSitterApplyEdit(edit);
    }

    treeSitterRemove(offset: number, len: number) {
        const startPosition = this.buffer.getPositionAt(offset - len);
        const oldEndPosition = this.buffer.getPositionAt(offset);
        const newEndPosition = startPosition;

        let edit = new TreeSitterEdit({
            startIndex: offset - len,
            oldEndIndex: offset,
            newEndIndex: offset - len,
            startPosition: { row: startPosition.lineNumber, column: startPosition.column },
            oldEndPosition: { row: oldEndPosition.lineNumber, column: oldEndPosition.column },
            newEndPosition: { row: newEndPosition.lineNumber, column: newEndPosition.column },
        });

        this.treeSitterApplyEdit(edit);
    }

    treeSitterApplyEdit(edit: TreeSitterEdit) {
        this.tree!.edit(edit);
        let old = this.tree!;
        const newTree = this.parser!.parse(this.input, old);
        this.tree!.delete();
        this.tree = newTree || undefined;
        this.foldRangesInvalidated = true;
    }
    
    tx() {
        this.changeActive = true;
        this.changeEdits = [];
    }

    setStateBefore(offset: number, selection?: Selection) {
        this.changeStateBefore = { offset, selection: selection?.clone() };
    }

    setStateAfter(offset: number, selection?: Selection) {
        this.changeStateAfter = { offset, selection: selection?.clone() };
    }

    commit() {
        if (this.changeActive) {
            let change = { 
                edits: this.changeEdits, 
                stateBefore:  this.changeStateBefore,
                stateAfter:  this.changeStateAfter,
            } as Change;

            this.history.push(change);

            this.notifyChange(change);

            this.changeActive = false;
            this.changeEdits = [];
            this.changeStateAfter = undefined;
            this.changeStateBefore = undefined;
        } else {
            console.error('No active changes to commit');
        }
    }

    public undo(_offset?: number): Change | undefined {
        const change = this.history.undo();
        if (!change) return undefined;

        const edits = [...change.edits].reverse();

        let undoChange: Change = { edits: [], isUndo: true };

        for (const edit of edits) {
            if (edit.operation === Operation.Insert) {
                undoChange.edits.push({
                    operation: Operation.Remove,
                    start: edit.start,
                    text: edit.text
                });
                this.remove(edit.start, edit.text.length);
            } else if (edit.operation === Operation.Remove) {
                undoChange.edits.push({
                    operation: Operation.Insert,
                    start: edit.start,
                    text: edit.text
                });
                this.insert(edit.text, edit.start);
            }
        }

        this.notifyChange(undoChange);

        return change;
    }

    public redo(_offset?: number): Change | null {
        const change = this.history.redo();
        if (!change) return null;
        const edits = change.edits;

        let redoChange: Change = { edits: [], isRedo: true };

        for (const edit of edits) {
            if (edit.operation === Operation.Insert) {
                redoChange.edits.push({
                    operation: Operation.Insert,
                    start: edit.start,
                    text: edit.text
                });
                this.insert(edit.text, edit.start);
            } else if (edit.operation === Operation.Remove) {
                redoChange.edits.push({
                    operation: Operation.Remove,
                    start: edit.start,
                    text: edit.text
                });
                this.remove(edit.start, edit.text.length);
            }
        }

        this.notifyChange(redoChange);

        return change;
    }

    public setHistory(changes: Change[], index: number) {
        this.history.setRawHistory(changes, index);
    }

    getLang(lang: string): Lang | null {
        if (lang === 'javascript') return javascript
        if (lang === 'typescript') return typescript
        if (lang === 'tsx') return tsx
        if (lang === 'rust') return rust
        if (lang === 'python') return python
        if (lang === 'yaml') return yaml
        if (lang === 'json') return json
        if (lang === 'toml') return toml
        if (lang === 'html') return html
        if (lang === 'css') return css
        if (lang === 'go') return go
        if (lang === 'java') return java
        if (lang === 'kotlin') return kotlin
        if (lang === 'lua') return lua
        if (lang === 'bash') return bash
        if (lang === 'zig') return zig
        if (lang === 'csharp') return csharp
        if (lang === 'c') return c
        if (lang === 'cpp') return cpp
        if (lang === 'markdown') return markdown
        if (lang === 'markdown_inline') return markdownInline
        if (lang === 'php') return php
        if (lang === 'ruby') return ruby
        if (lang === 'vue') return vue
        if (lang === 'dockerfile') return dockerfile
        if (lang === 'sql') return sql
        return null
    }

    getQuery(): string | null {
        if (!this.language) return null;

        const language = this.getLang(this.language);
        return language?.query || null;
    }

    getRunnablesQuery(): string | null {
        if (!this.language) return null;

        const language = this.getLang(this.language);
        return language?.runnablesQuery || null;
    }

    getFoldsQuery(): string | null {
        if (!this.language) return null;

        const language = this.getLang(this.language);
        return language?.foldsQuery || null;
    }

    private updateFoldRanges() {
        if (!this.tree || !this.foldsQuery) {
            this.foldRanges = [];
            return;
        }

        const ranges: FoldRange[] = [];
        const seen = new Set<string>();
        const captures = this.foldsQuery.captures(this.tree.rootNode);

        for (const capture of captures) {
            if (capture.name !== 'fold') continue;

            const range = this.foldRangeFromNode(capture.node);
            if (!range) continue;

            const { startLine, endLine } = range;

            const key = `${startLine}:${endLine}`;
            if (seen.has(key)) continue;
            seen.add(key);

            ranges.push({
                startLine,
                endLine,
                kind: capture.node.type,
            });
        }

        ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
        this.foldRanges = ranges;
    }

    public getFoldRanges(): FoldRange[] {
        if (this.foldRangesInvalidated) {
            this.updateFoldRanges();
            this.foldRangesInvalidated = false;
        }
        return this.foldRanges;
    }

    private foldRangeFromNode(node: SyntaxNode):
        { startLine: number; endLine: number } | null {
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;

        if (endLine <= startLine) return null;
        return { startLine, endLine };
    }

    getIndent(): Lang["indent"] | null {
        if (!this.language) return null;

        const language = this.getLang(this.language!);
        return language?.indent || null;
    }

    getComment(): string {
        if (!this.language) return "";

        const language = this.getLang(this.language!);
        return language?.comment || "";
    }

    isExecutable(): boolean {
        if (!this.language) return false;
        const language = this.getLang(this.language!);
        return language?.executable || false;
    }

    getLineNodes(line: number): HighlighedNode[] {
        // console.log('getLineNodes', line);
        if (this.linesCache.has(line)) {
            return this.linesCache.get(line)!;
        }
    
        const lineText = this.line(line) || "\u200B";
    
        if (!this.language || !this.tree || !this.query) {
            return [{ name: null, text: lineText }];
        }
    
        const captures = this.query.captures(
            this.tree.rootNode,
            {
                startPosition: { row: line, column: 0 },
                endPosition: { row: line + 1, column: 0 }
            }
        );
    
        const injectionCapturesArray = this.buildInjectionCaptures(captures);
    
        const lineNodes: HighlighedNode[] = [];
        let lastCapture: HighlighedNode | null = null;
    
        let bytesCounter = this.buffer.getOffsetAt(line + 1, 1);
    
        const appendNode = (name: string | null, text: string) => {
            if (lastCapture && lastCapture.name === name && (!name || !name.includes('bracket'))) {
                lastCapture.text += text;
            } else {
                lastCapture = { name, text };
                lineNodes.push(lastCapture);
            }
        };

        let column = 0;
        const advance = (len: number) => {
            column += len;
            bytesCounter += len;
        };
        
        for (; column < lineText.length;) {
            // Pick the narrowest capture range that contains current byte position.
            // This preserves nested/specific highlight precedence without sorting in the hot path.
            let capture: QueryCapture | undefined;
            let captureLen = 0;
            for (const c of captures) {
                if (c.node.startIndex <= bytesCounter && bytesCounter < c.node.endIndex) {
                    const len = c.node.endIndex - c.node.startIndex;
                    if (!capture || len < captureLen) {
                        capture = c;
                        captureLen = len;
                    }
                }
            }
            if (capture?.name.startsWith("injection.content.")) {
                // --- CASE 1: Injection ---
                const injectionData = injectionCapturesArray.find(
                    inj => bytesCounter >= inj.startIndex && bytesCounter < inj.endIndex
                );
    
                if (injectionData) {
                    const textLength = injectionData.endIndex - injectionData.startIndex;
                    const text = lineText.substring(column, column + textLength);
                    appendNode(injectionData.name, text);
                    advance(textLength);
                    continue;
                } else {
                    // --- CASE 3: Plain text ---
                    appendNode(null, lineText[column]);
                    advance(1);
                    continue;
                }
            }
            if (capture) {
                // --- CASE 2: Normal capture ---
                const captureEnd = capture.node.endPosition.row !== line
                    ? lineText.length
                    : capture.node.endPosition.column;
    
                const text = lineText.substring(column, captureEnd);
                appendNode(capture.name, text);
                advance(text.length);
            } else {
                // --- CASE 3: Plain text ---
                appendNode(null, lineText[column]);
                advance(1);
            }
        }
    
        if (lineNodes.length === 0) {
            lineNodes.push({ name: null, text: lineText || "\u200B" });
        }
    
        this.linesCache.set(line, lineNodes);
        return lineNodes;
    }

    private updateRunnables() {
        this.runnables.clear();

        if (this.isExecutable()) {
            this.runnables.set(0, { file: this.filename })
        }

        if (!this.language || !this.tree || !this.runnablesQuery) return;

        let captures = this.runnablesQuery.captures(this.tree.rootNode);
        for (let capture of captures){
            let line = capture.node.startPosition.row;

            let startPosition = this.buffer.getPositionAt(capture.node.startIndex);
            let endPosition = this.buffer.getPositionAt(capture.node.endIndex);

            let value = this.buffer.getValueInRange(new Range(
                startPosition.lineNumber, startPosition.column,
                endPosition.lineNumber, endPosition.column
            ));

            let runnable = this.runnables.get(line) || { file: this.filename };
            runnable[capture.name] = value;
            this.runnables.set(line, runnable)
        }
    }

    public hasRunnable(line: number): boolean {
        return this.runnables.has(line)
    }

    public getRunnable(line: number): string | null {
        let runnableValue = this.runnables.get(line);

        const language = this.getLang(this.language!);

        let template = language?.cmdTest || "";

        if (this.isExecutable() && line === 0)
            template = language?.cmd || "";

        let result = template.replace(/{(.*?)}/g, (_, key) => runnableValue[key] || `{${key}}`);
        return result
    }

    public getIndentationLevel(line: number, column?: number): number {
        let indent = this.getIndent();
        if (!indent) return 0;

        let lineText = this.line(line);

        // loop over lineText and count indent
        let indentation = 0;
        let i = 0;
        for (let char of lineText) {
            if (column !== undefined && i >= column) break;
            if (char === ' ') indentation++;
            else if (char === '\t') indentation += indent.width;
            else break;
            i++;
        }

        let width = indent.width || 2;
        return Math.ceil(indentation / width);
    }

    public isSameFileBody(_lineA: number, _lineB: number): boolean {
        return true;
    }

    public getAlwaysVisibleLines(_totalLines: number): Set<number> | null {
        return null;
    }

    public isOnlyIndentationBefore(line: number, column: number): boolean {
        let lineText = this.line(line);

        let col = 0;
        for (let char of lineText) {
            if (col >= column) break;
            if (char !== ' ') return false;
            col++;
        }
        return true;
    }

    public prevIndentation(line: number, column: number): number {
        let indent = this.getIndent();
        if (!indent) return 0;

        let iw = indent.width;
        let il = this.getIndentationLevel(line, column);

        if (indent.unit === '\t') {
            return il-1;
        }
        if (indent.unit === ' ') {
            return iw * (il-1);
        }

        return il-1;
    }

    public search(pattern: string): { line: number; column: number }[] {
        if (pattern === "") return [];
        const matches: { line: number; column: number }[] = [];

        // Split pattern into lines for multiline search
        const patternLines = pattern.split(/\r?\n/);
        const isMultiline = patternLines.length > 1;

        if (!isMultiline) {
            // Single-line search: optimized path for backward compatibility
            for (let lineIndex = 0; lineIndex < this.linesLength(); lineIndex++) {
                const lineText = this.line(lineIndex);
                let startIndex = 0;

                while ((startIndex = lineText.indexOf(pattern, startIndex)) !== -1) {
                    matches.push({
                        line: lineIndex,
                        column: startIndex,
                    });
                    startIndex += pattern.length;
                }
            }
            return matches;
        }

        // Multiline search: find matches line by line
        // Strategy: 
        // 1. Find first line pattern anywhere in document lines
        // 2. Verify subsequent lines match exactly (for intermediate lines)
        // 3. Last line must start with pattern or match exactly
        const firstLinePattern = patternLines[0];
        const remainingLines = patternLines.slice(1);

        // Iterate through all possible starting lines
        for (let startLineIndex = 0; startLineIndex < this.linesLength(); startLineIndex++) {
            const firstLineText = this.line(startLineIndex);
            let columnIndex = 0;

            // Find all occurrences of the first line pattern in current line
            while ((columnIndex = firstLineText.indexOf(firstLinePattern, columnIndex)) !== -1) {
                // Verify that all remaining pattern lines match sequentially
                let allLinesMatch = true;
                
                for (let i = 0; i < remainingLines.length; i++) {
                    const checkLineIndex = startLineIndex + i + 1;
                    
                    // Ensure we have enough lines remaining in document
                    if (checkLineIndex >= this.linesLength()) {
                        allLinesMatch = false;
                        break;
                    }

                    const checkLineText = this.line(checkLineIndex);
                    const patternLine = remainingLines[i];
                    
                    // Matching rules:
                    // - Intermediate lines: must match exactly
                    // - Last line: must start with pattern or match exactly
                    if (i === remainingLines.length - 1) {
                        // Last line: flexible matching (starts with or exact match)
                        if (!checkLineText.startsWith(patternLine) && 
                            checkLineText !== patternLine) {
                            allLinesMatch = false;
                            break;
                        }
                    } else {
                        // Intermediate lines: strict exact match required
                        if (checkLineText !== patternLine) {
                            allLinesMatch = false;
                            break;
                        }
                    }
                }

                if (allLinesMatch) {
                    matches.push({
                        line: startLineIndex,
                        column: columnIndex,
                    });
                }

                // Advance to next potential match position
                columnIndex += firstLinePattern.length;
            }
        }

        return matches;
    }

    public searchOnLine(lineIndex: number, columnIndex: number, pattern: string): number[] {
        if (pattern === "") return [];
        const columns: number[] = [];

        // Get the text of the specified line
        const lineText = this.line(lineIndex);
        let startIndex = 0;

        // Find all occurrences of the pattern in the line
        while ((startIndex = lineText.indexOf(pattern, startIndex)) !== -1) {
            if (startIndex >= columnIndex) break;
            columns.push(startIndex);
            startIndex += pattern.length;
        }

        return columns;
    }

    public getWordAtOffset(offset: number): WordHighlight | null {
        if (offset < 0 || offset > this.length()) {
            return null;
        }
        const pos = this.getPosition(offset);
        return this.getWordAtPosition(pos.line, pos.column);
    }

    public getWordAtPosition(lineIndex: number, columnIndex: number): WordHighlight | null {
        if (lineIndex < 0 || lineIndex >= this.linesLength()) {
            return null;
        }
        const lineText = this.line(lineIndex);
        if (columnIndex < 0 || columnIndex > lineText.length) {
            return null;
        }

        // Anchor: grapheme under cursor, otherwise grapheme on the left.
        let anchor = -1;
        if (columnIndex < lineText.length && isWordGrapheme(getGraphemeAt(lineText, columnIndex))) {
            anchor = columnIndex;
        } else if (columnIndex > 0) {
            const prev = getPrevGraphemeIndex(lineText, columnIndex);
            if (isWordGrapheme(getGraphemeAt(lineText, prev))) {
                anchor = prev;
            }
        }
        if (anchor === -1) {
            return null;
        }

        // Expand to the left by grapheme clusters.
        let start = anchor;
        while (start > 0) {
            const prev = getPrevGraphemeIndex(lineText, start);
            if (prev === start || !isWordGrapheme(getGraphemeAt(lineText, prev))) {
                break;
            }
            start = prev;
        }

        // Expand to the right by grapheme clusters.
        let end = getNextGraphemeIndex(lineText, anchor);
        while (end < lineText.length) {
            if (!isWordGrapheme(getGraphemeAt(lineText, end))) {
                break;
            }
            const next = getNextGraphemeIndex(lineText, end);
            if (next === end) {
                break;
            }
            end = next;
        }

        if (start === end) {
            return null;
        }

        const text = lineText.slice(start, end);

        // Find the class (name) of the token at the cursor position
        let classs: string | null = null;
        const nodes = this.getLineNodes(lineIndex);
        let currentCharCount = 0;
        for (const node of nodes) {
            const nextCharCount = currentCharCount + node.text.length;
            if (start >= currentCharCount && start < nextCharCount) {
                classs = node.name;
                break;
            }
            currentCharCount = nextCharCount;
        }

        return { text, token: classs };
    }

    public getMatchingBracket(offset: number): BracketMatch | null {
        const totalLines = this.linesLength();
        if (totalLines === 0) return null;

        const bracket = this.findBracketAtPosition(offset);
        if (!bracket) return null;

        const { line, column, char, offset: bracketOffset } = bracket;

        if (this.isInIgnoredContext(bracketOffset)) {
            return null;
        }

        const isOpening = OPEN_BRACKETS.has(char);
        const openChar = isOpening ? char : BRACKET_PAIRS[char];
        const closeChar = isOpening ? BRACKET_PAIRS[char] : char;

        return isOpening
            ? this.findMatchingClose(bracketOffset, line, column, openChar, closeChar)
            : this.findMatchingOpen(bracketOffset, line, column, openChar, closeChar);
    }

    private findBracketAtPosition(offset: number): { 
        line: number; 
        column: number; 
        char: string; 
        offset: number;
    } | null {
        const pos = this.getPosition(offset);
        const text = this.line(pos.line);

        if (pos.column < text.length && BRACKET_PAIRS[text[pos.column]]) {
            return {
                line: pos.line,
                column: pos.column,
                char: text[pos.column],
                offset: this.getOffset(pos.line, pos.column)
            };
        }

        if (pos.column > 0 && BRACKET_PAIRS[text[pos.column - 1]]) {
            return {
                line: pos.line,
                column: pos.column - 1,
                char: text[pos.column - 1],
                offset: this.getOffset(pos.line, pos.column - 1)
            };
        }

        return null;
    }

    private isInIgnoredContext(offset: number): boolean {
        if (!this.tree) return false;

        try {
            const node = this.tree.rootNode.descendantForIndex(offset);
            let current: SyntaxNode | null = node;

            while (current) {
                const type = current.type.toLowerCase();
                if (type.includes('comment') ||
                    type.includes('string') ||
                    type.includes('regex') ||
                    type.includes('template')) {
                    return true;
                }
                current = current.parent;
            }
        } catch (e) {
            
        }
        return false;
    }

    private findMatchingClose(
        openOffset: number,
        startLine: number,
        startColumn: number,
        openChar: string,
        closeChar: string
    ): BracketMatch | null {
        let count = 1;
        let line = startLine;

        while (line < this.linesLength()) {
            const text = this.line(line);
            const startCol = (line === startLine) ? startColumn + 1 : 0;
            const lineStartOffset = this.getOffset(line, 0);

            for (let col = startCol; col < text.length; col++) {
                const char = text[col];

                if (char !== openChar && char !== closeChar) continue;

                const charOffset = lineStartOffset + col;
                if (this.isInIgnoredContext(charOffset)) continue;

                if (char === openChar) {
                    count++;
                } else {
                    count--;
                    if (count === 0) {
                        return { openOffset, closeOffset: charOffset };
                    }
                }
            }

            line++;
        }

        return null;
    }

    private findMatchingOpen(
        closeOffset: number,
        startLine: number,
        startColumn: number,
        openChar: string,
        closeChar: string
    ): BracketMatch | null {
        let count = 1;
        let line = startLine;

        while (line >= 0) {
            const text = this.line(line);
            const startCol = (line === startLine) ? startColumn - 1 : text.length - 1;
            const lineStartOffset = this.getOffset(line, 0);

            for (let col = startCol; col >= 0; col--) {
                const char = text[col];

                if (char !== openChar && char !== closeChar) continue;

                const charOffset = lineStartOffset + col;
                if (this.isInIgnoredContext(charOffset)) continue;

                if (char === closeChar) {
                    count++;
                } else {
                    count--;
                    if (count === 0) {
                        return { openOffset: charOffset, closeOffset };
                    }
                }
            }

            line--;
        }

        return null;
    }

    clone() {
        return new Code(this.getContent(), this.filename, this.language!);
    }
}
