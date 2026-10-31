import { Code, type Change, type EditState, type FoldRange, type HighlighedNode, type Position, type WordHighlight, type FilePosition, type Point } from './code';
import { BinaryTokens } from './tokens';
import { Selection } from './selection';
import { computeGitChangesWithStats, type DiffHunk, DiffModel } from './diff';

export type MultiBufferEntry = {
    id: string;
    path: string;
    displayPath?: string;
    iconClassName?: string;
    added?: number;
    removed?: number;
    readOnly?: boolean;
    code: Code;
    originalCode: Code;
};

export type MultiBufferFileChange = {
    fileId: string;
    change: Change;
};

export type MultiBufferHeaderInfo = {
    fileIndex: number;
    fileId: string;
    path: string;
    fileName: string;
    dirName: string;
    iconClassName?: string;
    line: number;
    collapsed: boolean;
    added: number;
    removed: number;
};

interface FileRange {
    fileIndex: number;
    fileId: string;
    path: string;
    collapsed: boolean;
    headerText: string;
    headerLine: number;
    bodyStartLine: number;
    bodyLineCount: number;
    totalLines: number;
    headerStartOffset: number;
    bodyStartOffset: number;
    bodyCharLength: number;
    nextStartOffset: number;
    headerNodes: HighlighedNode[];
    headerBinaryTokens: Uint32Array;
}

type ResolvedOffset = {
    fileIndex: number;
    localOffset: number;
    isHeader: boolean;
};

type CachedFileDiff = {
    version: number;
    diffs: DiffModel;
    added: number;
    removed: number;
};

const EMPTY_LINE = '\u200B';

const getFileName = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    return normalized.split('/').pop() || path;
};

const getDirName = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    const separatorIndex = normalized.lastIndexOf('/');
    return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : '';
};

/** `dirText` is the padded directory suffix shown after the file name; empty when the file is at the root. */
const formatEntryHeaderPath = (entry: MultiBufferEntry) => {
    const path = entry.displayPath ?? entry.path;
    const fileName = getFileName(path);
    const dirName = getDirName(path);
    return { fileName, dirName, dirText: dirName ? `  ${dirName}` : '' };
};

const formatFileStats = (added: number, removed: number) => ({
    added: added > 0 ? `  +${added}` : '',
    removed: removed > 0 ? `${added > 0 ? ' ' : '  '}−${removed}` : '',
});

/**
 * A single Code-compatible coordinate space made from several file buffers.
 * The editor/renderer sees one document, while edits are routed back to the
 * owning file buffer using the global row/offset map.
 */
export class MultiBufferCode extends Code {
    private readonly entries: MultiBufferEntry[];
    private readonly fileVersions: number[];
    private readonly headerPaths: ReturnType<typeof formatEntryHeaderPath>[];
    private readonly fileDiffs = new Map<string, CachedFileDiff>();
    private readonly collapsedFiles = new Set<string>();
    private fileRanges: FileRange[] = [];
    private totalLineCount = 0;
    private totalCharLength = 0;
    private headerInfos: MultiBufferHeaderInfo[] = [];
    private indexDirty = true;
    private cachedFoldRanges: FoldRange[] | null = null;
    private activeFileIndex = 0;
    private activeTxFileIndex: number | null = null;
    private onChangeCallback: ((change: Change) => void) | null = null;
    private onFileChangeCallback: ((change: MultiBufferFileChange) => void) | null = null;

    constructor(entries: MultiBufferEntry[]) {
        super('', 'multibuffer', '');
        this.entries = entries;
        this.fileVersions = entries.map(() => 0);
        this.headerPaths = entries.map(formatEntryHeaderPath);
        this.filename = entries[0]?.path ?? 'multibuffer';
    }

    public async init(): Promise<void> {
        // Current file buffers are owned and initialized by their regular
        // editors. Review only needs to initialize its separate baselines.
        const baselines = new Set(this.entries.map((entry) => entry.originalCode));
        await Promise.all([...baselines].map((code) => code.init()));
        this.indexDirty = true;
    }

    public async addEntries(entries: MultiBufferEntry[], atIndex = this.entries.length): Promise<void> {
        if (entries.length === 0) return;

        const insertionIndex = Math.max(0, Math.min(atIndex, this.entries.length));
        this.entries.splice(insertionIndex, 0, ...entries);
        this.fileVersions.splice(insertionIndex, 0, ...entries.map(() => 0));
        this.headerPaths.splice(insertionIndex, 0, ...entries.map(formatEntryHeaderPath));
        const baselines = new Set(entries.map((entry) => entry.originalCode));
        await Promise.all([...baselines].map((code) => code.init()));
        this.indexDirty = true;
    }

    public removeEntries(fileIds: string[]): void {
        if (fileIds.length === 0) return;
        const ids = new Set(fileIds);

        for (let index = this.entries.length - 1; index >= 0; index--) {
            if (!ids.has(this.entries[index].id)) continue;
            this.entries.splice(index, 1);
            this.fileVersions.splice(index, 1);
            this.headerPaths.splice(index, 1);
        }

        this.fileDiffs.clear();
        this.collapsedFiles.clear();
        this.activeFileIndex = Math.min(this.activeFileIndex, Math.max(0, this.entries.length - 1));
        this.indexDirty = true;
    }

    public setOnFileChange(callback: ((change: MultiBufferFileChange) => void) | null): void {
        this.onFileChangeCallback = callback;
    }

    public getFileIdAtLine(line: number): string | null {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange) return null;
        this.activateFile(fileRange.fileIndex);
        return this.entries[fileRange.fileIndex]?.id ?? null;
    }

    public getFirstLineForFile(fileId: string): number | null {
        this.ensureIndex();
        const fileIndex = this.entries.findIndex((entry) => entry.id === fileId || entry.path === fileId);
        if (fileIndex < 0) return null;
        return this.fileRanges[fileIndex]?.headerLine ?? null;
    }

    public getMultibufferLineNumber(line: number): number | null {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange || line === fileRange.headerLine) return null;
        return line - fileRange.bodyStartLine;
    }

    public getMultibufferLineForLocalLine(fileId: string, localLine: number): number | null {
        this.ensureIndex();
        const fileIndex = this.entries.findIndex((entry) => entry.id === fileId || entry.path === fileId);
        if (fileIndex < 0) return null;
        const fileRange = this.fileRanges[fileIndex];
        if (!fileRange || fileRange.collapsed) return null;
        if (localLine < 0 || localLine >= fileRange.bodyLineCount) return null;
        return fileRange.bodyStartLine + localLine;
    }

    public override resolvePosition(row: number, column: number): FilePosition {
        const fileId = this.getFileIdAtLine(row);
        const localLine = this.getMultibufferLineNumber(row);
        if (!fileId || localLine === null) {
            return { file: this.filename, line: row, column };
        }
        return { file: fileId, line: localLine, column };
    }

    public getPrevLine(line: number): number {
        return this.getAdjacentFileLine(line, -1);
    }

    public getNextLine(line: number): number {
        return this.getAdjacentFileLine(line, 1);
    }

    private getAdjacentFileLine(line: number, direction: -1 | 1): number {
        this.ensureIndex();
        let candidate = line + direction;
        while (candidate >= 0 && candidate < this.totalLineCount) {
            const fileRange = this.findFileRangeByLine(candidate);
            if (!fileRange || candidate !== fileRange.headerLine) {
                break;
            }
            candidate += direction;
        }
        return candidate;
    }

    public override isLineEditable(line: number): boolean {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange || line === fileRange.headerLine) return false;
        return !this.entries[fileRange.fileIndex]?.readOnly;
    }

    public override findFirstEditableLine(): number {
        this.ensureIndex();
        for (const fileRange of this.fileRanges) {
            if (!this.entries[fileRange.fileIndex]?.readOnly && !fileRange.collapsed && fileRange.bodyLineCount > 0) {
                return fileRange.bodyStartLine;
            }
        }
        return 0;
    }

    public override clampPoint(point: Point, preferDirection: -1 | 1 = 1): Point {
        this.ensureIndex();
        if (this.totalLineCount === 0) return { row: 0, column: 0 };
        let row = Math.max(0, Math.min(point.row, this.totalLineCount - 1));
        const fileRange = this.findFileRangeByLine(row);
        if (fileRange && row === fileRange.headerLine) {
            const findEditable = (dir: -1 | 1): number | null => {
                let idx = fileRange.fileIndex;
                if (dir === 1 && !fileRange.collapsed && fileRange.bodyLineCount > 0) {
                    return fileRange.bodyStartLine;
                }
                idx += dir;
                while (idx >= 0 && idx < this.fileRanges.length) {
                    const f = this.fileRanges[idx];
                    if (!f.collapsed && f.bodyLineCount > 0) {
                        return dir === 1 ? f.bodyStartLine : f.bodyStartLine + f.bodyLineCount - 1;
                    }
                    idx += dir;
                }
                return null;
            };

            const found = findEditable(preferDirection) ?? findEditable(preferDirection === 1 ? -1 : 1);
            if (found !== null) {
                row = found;
            }
        }
        const col = Math.max(0, Math.min(point.column, this.lineLength(row)));
        return { row, column: col };
    }

    public toggleMultibufferFileAtLine(line: number): boolean {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange || line !== fileRange.headerLine) return false;
        const entry = this.entries[fileRange.fileIndex];
        if (!entry) return false;

        if (this.collapsedFiles.has(entry.id)) {
            this.collapsedFiles.delete(entry.id);
        } else {
            this.collapsedFiles.add(entry.id);
        }
        this.indexDirty = true;
        return true;
    }

    public setAllFilesCollapsed(collapsed: boolean): void {
        this.collapsedFiles.clear();
        if (collapsed) {
            for (const entry of this.entries) this.collapsedFiles.add(entry.id);
        }
        this.indexDirty = true;
    }

    public areAllFilesExpanded(): boolean {
        return this.entries.length > 0 && this.entries.every((entry) => !this.collapsedFiles.has(entry.id));
    }

    public getFileText(fileId: string): string | null {
        return this.entries.find((entry) => entry.id === fileId)?.code.getContent() ?? null;
    }

    public notifyFileChanged(fileId: string): void {
        const fileIndex = this.entries.findIndex((entry) => entry.id === fileId);
        if (fileIndex < 0) return;
        this.fileVersions[fileIndex] += 1;
        this.indexDirty = true;
    }

    /**
     * Compute the composite diff using per-file caches. Editing one file only
     * invalidates that file's JsDiff result; the other files are remapped into
     * the current global coordinate space without being diffed again.
     */
    public getMultibufferDiffs(): DiffModel {
        this.ensureIndex();
        const allHunks: DiffHunk[] = [];
        let totalAdded = 0;
        let totalRemoved = 0;

        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const cached = this.getCachedFileDiff(fileIndex);
            totalAdded += cached.added;
            totalRemoved += cached.removed;

            const currentBodyStart = this.getBodyStart(fileIndex, false);
            if (currentBodyStart < 0) continue;
            const originalBodyStart = this.getBodyStart(fileIndex, true);
            for (const hunk of cached.diffs.getHunks()) {
                allHunks.push({
                    ...hunk,
                    startLine: currentBodyStart + hunk.startLine,
                    oldLineNumbers: hunk.oldLineNumbers?.map((line) => originalBodyStart + line),
                    ghostAnchorLine: hunk.ghostAnchorLine === undefined
                        ? undefined
                        : currentBodyStart + hunk.ghostAnchorLine,
                    hunkId: fileIndex * 1_000_000 + hunk.hunkId,
                });
            }
        }

        return new DiffModel(allHunks, totalAdded, totalRemoved);
    }

    public getMultibufferHeader(line: number): string | null {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        return fileRange && line === fileRange.headerLine ? fileRange.headerText : null;
    }

    public getFileHeaders(): MultiBufferHeaderInfo[] {
        this.ensureIndex();
        return this.headerInfos;
    }

    public override isSameFileBody(lineA: number, lineB: number): boolean {
        this.ensureIndex();
        const fileRangeA = this.findFileRangeByLine(lineA);
        const fileRangeB = this.findFileRangeByLine(lineB);
        if (!fileRangeA || !fileRangeB) return false;
        if (lineA === fileRangeA.headerLine || lineB === fileRangeB.headerLine) return false;
        return fileRangeA.fileIndex === fileRangeB.fileIndex;
    }

    public isMultibufferSameFileBody(lineA: number, lineB: number): boolean {
        return this.isSameFileBody(lineA, lineB);
    }

    public override getAlwaysVisibleLines(_totalLines: number): Set<number> {
        this.ensureIndex();
        const headers = new Set<number>();
        for (const fileRange of this.fileRanges) {
            headers.add(fileRange.headerLine);
        }
        return headers;
    }

    public getMultibufferAlwaysVisibleLines(totalLines: number): Set<number> {
        return this.getAlwaysVisibleLines(totalLines);
    }

    public getLines(): string[] {
        this.ensureIndex();
        const result: string[] = [];
        for (const fileRange of this.fileRanges) {
            result.push(fileRange.headerText);
            if (!fileRange.collapsed) {
                const lines = this.entries[fileRange.fileIndex].code.getLines();
                result.push(...(lines.length > 0 ? lines : ['']));
            }
        }
        return result;
    }

    public getContent(): string {
        return this.getLines().join('\n');
    }

    public getContentLength(): number {
        this.ensureIndex();
        return this.totalCharLength;
    }

    public length(): number {
        return this.getContentLength();
    }

    public linesLength(): number {
        this.ensureIndex();
        return this.totalLineCount;
    }

    public line(line: number): string {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange) return '';
        if (line === fileRange.headerLine) return fileRange.headerText;
        return this.entries[fileRange.fileIndex]?.code.line(line - fileRange.bodyStartLine) ?? '';
    }

    public lineLength(line: number): number {
        return this.line(line).length;
    }

    public getLineByOffset(offset: number): number {
        return this.getPosition(offset).line;
    }

    public getPosition(offset: number): Position {
        this.ensureIndex();
        const fileRange = this.findFileRangeByOffset(offset);
        if (!fileRange) return { line: 0, column: 0 };

        this.activateFile(fileRange.fileIndex);
        if (offset < fileRange.bodyStartOffset) {
            return {
                line: fileRange.headerLine,
                column: Math.max(0, Math.min(fileRange.headerText.length, offset - fileRange.headerStartOffset)),
            };
        }

        const localOffset = Math.max(0, offset - fileRange.bodyStartOffset);
        const pos = this.entries[fileRange.fileIndex].code.getPosition(localOffset);
        return {
            line: fileRange.bodyStartLine + pos.line,
            column: pos.column,
        };
    }

    public override getPoint(offset: number): Point {
        const pos = this.getPosition(offset);
        return { row: pos.line, column: pos.column };
    }

    public getOffset(line: number, column: number): number {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange) return this.getContentLength();

        this.activateFile(fileRange.fileIndex);
        if (line === fileRange.headerLine) {
            return fileRange.headerStartOffset + Math.max(0, Math.min(fileRange.headerText.length, column));
        }

        const localLine = line - fileRange.bodyStartLine;
        return fileRange.bodyStartOffset + this.entries[fileRange.fileIndex].code.getOffset(localLine, column);
    }

    public getIntervalContent2(from: number, to: number): string {
        this.ensureIndex();
        if (from >= to) return '';
        const range = this.findFileRangeByOffset(from);
        if (range && !range.collapsed) {
            if (from >= range.bodyStartOffset && to <= range.bodyStartOffset + range.bodyCharLength) {
                const localFrom = from - range.bodyStartOffset;
                const localTo = to - range.bodyStartOffset;
                return this.entries[range.fileIndex]?.code.getIntervalContent2(localFrom, localTo) ?? '';
            }
        }
        return this.getContent().slice(Math.max(0, from), Math.max(0, to));
    }

    public override getTextRange(start: Point, end: Point): string {
        const startOffset = this.getOffset(start.row, start.column);
        const endOffset = this.getOffset(end.row, end.column);
        const [sortedStart, sortedEnd] = startOffset <= endOffset ? [startOffset, endOffset] : [endOffset, startOffset];
        return this.getIntervalContent2(sortedStart, sortedEnd);
    }

    public override getLineNodes(line: number): HighlighedNode[] {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange) return [{ name: null, text: EMPTY_LINE }];
        if (line === fileRange.headerLine) return fileRange.headerNodes;
        return this.entries[fileRange.fileIndex]?.code.getLineNodes(line - fileRange.bodyStartLine) ?? [{ name: null, text: EMPTY_LINE }];
    }

    public override getLineBinaryTokens(line: number): Uint32Array {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange) return new Uint32Array(0);
        if (line === fileRange.headerLine) {
            return fileRange.headerBinaryTokens;
        }
        return this.entries[fileRange.fileIndex]?.code.getLineBinaryTokens(line - fileRange.bodyStartLine) ?? new Uint32Array(0);
    }

    public override getFoldRanges(): FoldRange[] {
        this.ensureIndex();
        if (this.cachedFoldRanges !== null) {
            return this.cachedFoldRanges;
        }

        const ranges: FoldRange[] = [];
        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const headerInfo = this.headerInfos[fileIndex];
            if (!headerInfo || headerInfo.collapsed) continue;
            const firstBodyRow = headerInfo.line + 1;
            const entryFoldRanges = this.entries[fileIndex].code.getFoldRanges();
            for (let i = 0; i < entryFoldRanges.length; i++) {
                const range = entryFoldRanges[i];
                ranges.push({
                    ...range,
                    startLine: firstBodyRow + range.startLine,
                    endLine: firstBodyRow + range.endLine,
                });
            }
        }
        this.cachedFoldRanges = ranges;
        return ranges;
    }

    public getWordAtOffset(offset: number): WordHighlight | null {
        const resolved = this.resolveOffset(offset);
        if (!resolved || resolved.isHeader) return null;
        return this.entries[resolved.fileIndex].code.getWordAtOffset(resolved.localOffset);
    }

    public search(pattern: string): { line: number; column: number }[] {
        if (!pattern) return [];
        this.ensureIndex();
        const matches: { line: number; column: number }[] = [];
        for (const fileRange of this.fileRanges) {
            let index = -1;
            while ((index = fileRange.headerText.indexOf(pattern, index + 1)) !== -1) {
                matches.push({ line: fileRange.headerLine, column: index });
            }
            if (fileRange.collapsed) continue;
            const entry = this.entries[fileRange.fileIndex];
            const count = fileRange.bodyLineCount;
            for (let localLine = 0; localLine < count; localLine++) {
                const lineText = entry.code.line(localLine);
                let col = -1;
                while ((col = lineText.indexOf(pattern, col + 1)) !== -1) {
                    matches.push({ line: fileRange.bodyStartLine + localLine, column: col });
                }
            }
        }
        return matches;
    }

    public searchOnLine(line: number, column: number, pattern: string): number[] {
        const text = this.line(line);
        const matches: number[] = [];
        let index = Math.max(0, column);
        while ((index = text.indexOf(pattern, index)) !== -1) {
            matches.push(index);
            index += Math.max(1, pattern.length);
        }
        return matches;
    }

    public override getIndent(line?: number) {
        if (typeof line === 'number') {
            const resolved = this.resolveLine(line);
            return resolved ? this.entries[resolved.fileIndex]?.code.getIndent(resolved.localLine) ?? null : null;
        }
        return this.entries[this.activeFileIndex]?.code.getIndent() ?? null;
    }

    public override getComment(line?: number): string {
        if (typeof line === 'number') {
            const resolved = this.resolveLine(line);
            return resolved ? this.entries[resolved.fileIndex]?.code.getComment(resolved.localLine) ?? '' : '';
        }
        return this.entries[this.activeFileIndex]?.code.getComment() ?? '';
    }

    public getIndentationLevel(line: number, column?: number): number {
        const resolved = this.resolveLine(line);
        return resolved ? this.entries[resolved.fileIndex].code.getIndentationLevel(resolved.localLine, column) : 0;
    }

    public isOnlyIndentationBefore(line: number, column: number): boolean {
        const resolved = this.resolveLine(line);
        return resolved ? this.entries[resolved.fileIndex].code.isOnlyIndentationBefore(resolved.localLine, column) : false;
    }

    public prevIndentation(line: number, column: number): number {
        const resolved = this.resolveLine(line);
        return resolved ? this.entries[resolved.fileIndex].code.prevIndentation(resolved.localLine, column) : 0;
    }

    public setOnChange(callback: ((change: Change) => void) | null): void {
        this.onChangeCallback = callback;
    }

    public override setHistory(_changes: Change[], _index: number): void {
        // MultiBufferCode does not own history. Each file's Code does.
    }

    public override tx(): void {
        this.changeActive = true;
        this.activeTxFileIndex = null;
    }

    public override setStateBefore(cursor: Point, selection?: Selection): void {
        this.ensureIndex();
        const resolved = this.resolveLine(cursor.row);
        if (resolved) {
            this.activeTxFileIndex = resolved.fileIndex;
            const entry = this.entries[resolved.fileIndex];
            if (entry && !entry.readOnly) {
                entry.code.tx();
                const localCursor = { row: resolved.localLine, column: cursor.column };
                let localSelection: Selection | undefined = undefined;
                if (selection) {
                    const startResolved = this.resolveLine(selection.start.row);
                    const endResolved = this.resolveLine(selection.end.row);
                    if (startResolved && endResolved && startResolved.fileIndex === resolved.fileIndex && endResolved.fileIndex === resolved.fileIndex) {
                        localSelection = new Selection(
                            { row: startResolved.localLine, column: selection.start.column },
                            { row: endResolved.localLine, column: selection.end.column }
                        );
                    }
                }
                entry.code.setStateBefore(localCursor, localSelection);
            }
        }
    }

    public override setStateAfter(cursor: Point, selection?: Selection): void {
        if (this.activeTxFileIndex !== null) {
            this.ensureIndex();
            const resolved = this.resolveLine(cursor.row);
            if (resolved && resolved.fileIndex === this.activeTxFileIndex) {
                const entry = this.entries[this.activeTxFileIndex];
                if (entry && !entry.readOnly) {
                    const localCursor = { row: resolved.localLine, column: cursor.column };
                    let localSelection: Selection | undefined = undefined;
                    if (selection) {
                        const startResolved = this.resolveLine(selection.start.row);
                        const endResolved = this.resolveLine(selection.end.row);
                        if (startResolved && endResolved && startResolved.fileIndex === this.activeTxFileIndex && endResolved.fileIndex === this.activeTxFileIndex) {
                            localSelection = new Selection(
                                { row: startResolved.localLine, column: selection.start.column },
                                { row: endResolved.localLine, column: selection.end.column }
                            );
                        }
                    }
                    entry.code.setStateAfter(localCursor, localSelection);
                }
            }
        }
    }

    public override insertAt(point: Point, text: string, addHistory: boolean = false): void {
        this.ensureIndex();
        const resolved = this.resolveLine(point.row);
        if (!resolved) return;
        const entry = this.entries[resolved.fileIndex];
        if (entry.readOnly) return;
        if (this.activeTxFileIndex === null) {
            this.activeTxFileIndex = resolved.fileIndex;
            if (this.changeActive) {
                entry.code.tx();
            }
        }
        const localOffset = entry.code.getOffset(resolved.localLine, point.column);
        entry.code.insert(text, localOffset, this.changeActive ? false : addHistory);
        this.markFileChanged(resolved.fileIndex);
    }

    public override removeRange(start: Point, end: Point, addHistory: boolean = false): void {
        this.ensureIndex();
        const startResolved = this.resolveLine(start.row);
        const endResolved = this.resolveLine(end.row);
        if (!startResolved || !endResolved || startResolved.fileIndex !== endResolved.fileIndex) return;

        const entry = this.entries[startResolved.fileIndex];
        if (entry.readOnly) return;

        if (this.activeTxFileIndex === null) {
            this.activeTxFileIndex = startResolved.fileIndex;
            if (this.changeActive) {
                entry.code.tx();
            }
        }

        const startLocalOffset = entry.code.getOffset(startResolved.localLine, start.column);
        const endLocalOffset = entry.code.getOffset(endResolved.localLine, end.column);
        const [sortedStart, sortedEnd] = startLocalOffset <= endLocalOffset
            ? [startLocalOffset, endLocalOffset]
            : [endLocalOffset, startLocalOffset];
        const removeLen = sortedEnd - sortedStart;
        if (removeLen <= 0) return;

        const text = entry.code.getIntervalContent2(sortedStart, sortedEnd);
        entry.code.remove(sortedStart, removeLen, this.changeActive ? false : addHistory);
        this.markFileChanged(startResolved.fileIndex);
    }

    public override insert(text: string, offset: number, addHistory: boolean = false): void {
        this.insertRaw(text, offset, addHistory);
    }

    public override remove(offset: number, length: number, addHistory: boolean = false): void {
        this.removeRaw(offset, length, addHistory);
    }

    public override commit(): void {
        if (this.activeTxFileIndex !== null) {
            const entry = this.entries[this.activeTxFileIndex];
            if (entry && !entry.readOnly) {
                entry.code.commit();
            }
        }
        this.changeActive = false;
        this.activeTxFileIndex = null;
    }

    public override undo(cursor?: Point): Change | undefined {
        let fileIndex = this.activeFileIndex;
        if (cursor) {
            this.ensureIndex();
            const resolved = this.resolveLine(cursor.row);
            if (resolved) {
                fileIndex = resolved.fileIndex;
            }
        }

        const change = this.entries[fileIndex]?.code.undo();
        if (!change) return undefined;
        this.markFileChanged(fileIndex);
        return this.toGlobalChange(change, fileIndex);
    }

    public override redo(cursor?: Point): Change | null {
        let fileIndex = this.activeFileIndex;
        if (cursor) {
            this.ensureIndex();
            const resolved = this.resolveLine(cursor.row);
            if (resolved) {
                fileIndex = resolved.fileIndex;
            }
        }

        const change = this.entries[fileIndex]?.code.redo() ?? null;
        if (!change) return null;
        this.markFileChanged(fileIndex);
        return this.toGlobalChange(change, fileIndex);
    }

    private insertRaw(text: string, offset: number, addHistory: boolean = false): void {
        if (!text) return;
        const resolved = this.resolveOffset(offset);
        if (!resolved || resolved.isHeader) return;

        const entry = this.entries[resolved.fileIndex];
        if (entry.readOnly) return;

        if (this.activeTxFileIndex === null) {
            this.activeTxFileIndex = resolved.fileIndex;
            if (this.changeActive) {
                entry.code.tx();
            }
        }

        const localOffset = Math.min(resolved.localOffset, entry.code.getContentLength());
        entry.code.insert(text, localOffset, this.changeActive ? false : addHistory);
        this.markFileChanged(resolved.fileIndex);
    }

    private removeRaw(offset: number, length: number, addHistory: boolean = false): void {
        if (length <= 0) return;
        const start = this.resolveOffset(offset);
        const end = this.resolveOffset(Math.max(offset, offset + length - 1));
        if (!start || !end || start.isHeader || end.isHeader || start.fileIndex !== end.fileIndex) return;

        const entry = this.entries[start.fileIndex];
        if (entry.readOnly) return;

        if (this.activeTxFileIndex === null) {
            this.activeTxFileIndex = start.fileIndex;
            if (this.changeActive) {
                entry.code.tx();
            }
        }

        const maxLength = Math.max(0, entry.code.getContentLength() - start.localOffset);
        const removeLength = Math.min(length, maxLength);
        if (removeLength <= 0) return;
        const text = entry.code.getIntervalContent2(start.localOffset, start.localOffset + removeLength);
        entry.code.remove(start.localOffset, removeLength, this.changeActive ? false : addHistory);
        this.markFileChanged(start.fileIndex);
    }

    private resolveLine(line: number): { fileIndex: number; localLine: number } | null {
        this.ensureIndex();
        const fileRange = this.findFileRangeByLine(line);
        if (!fileRange || line === fileRange.headerLine) return null;
        this.activateFile(fileRange.fileIndex);
        return { fileIndex: fileRange.fileIndex, localLine: line - fileRange.bodyStartLine };
    }

    private resolveOffset(offset: number): ResolvedOffset | null {
        this.ensureIndex();
        const fileRange = this.findFileRangeByOffset(offset);
        if (!fileRange) return null;
        this.activateFile(fileRange.fileIndex);
        if (offset < fileRange.bodyStartOffset) {
            return { fileIndex: fileRange.fileIndex, localOffset: 0, isHeader: true };
        }
        const entry = this.entries[fileRange.fileIndex];
        const rawOffset = offset - fileRange.bodyStartOffset;
        const localOffset = entry ? Math.min(rawOffset, entry.code.getContentLength()) : rawOffset;
        return {
            fileIndex: fileRange.fileIndex,
            localOffset,
            isHeader: false,
        };
    }

    private findFileRangeByLine(line: number): FileRange | null {
        if (this.fileRanges.length === 0 || line < 0 || line >= this.totalLineCount) return null;
        let low = 0;
        let high = this.fileRanges.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const fileRange = this.fileRanges[mid];
            if (line < fileRange.headerLine) {
                high = mid - 1;
            } else if (line >= fileRange.headerLine + fileRange.totalLines) {
                low = mid + 1;
            } else {
                return fileRange;
            }
        }
        return null;
    }

    private findFileRangeByOffset(offset: number): FileRange | null {
        if (this.fileRanges.length === 0) return null;
        const clamped = Math.max(0, Math.min(this.totalCharLength, offset));
        let low = 0;
        let high = this.fileRanges.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const fileRange = this.fileRanges[mid];
            if (clamped < fileRange.headerStartOffset) {
                high = mid - 1;
            } else if (clamped >= fileRange.nextStartOffset && mid < this.fileRanges.length - 1) {
                low = mid + 1;
            } else {
                return fileRange;
            }
        }
        return this.fileRanges[this.fileRanges.length - 1] ?? null;
    }

    private ensureIndex(): void {
        if (!this.indexDirty) return;
        this.linesCache.clear();
        this.cachedFoldRanges = null;
        this.fileRanges = [];
        this.headerInfos = [];
        let offset = 0;
        let line = 0;

        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const entry = this.entries[fileIndex];
            const { added, removed } = this.getCachedFileDiff(fileIndex);
            const stats = formatFileStats(added, removed);
            const collapsed = this.collapsedFiles.has(entry.id);
            const { fileName, dirName, dirText } = this.headerPaths[fileIndex];
            // The icon slot is omitted (not left blank) when the entry has no icon.
            const headerNodes: HighlighedNode[] = [
                {
                    name: `multibuffer-header-chevron ${collapsed ? 'collapsed' : 'expanded'}`,
                    text: '  ',
                },
                ...(entry.iconClassName
                    ? [{ name: `multibuffer-header-icon ${entry.iconClassName}`, text: '  ' }]
                    : []),
                {
                    name: 'multibuffer-header',
                    text: fileName,
                },
                { name: 'multibuffer-header-dir', text: dirText },
                { name: 'multibuffer-header-added', text: stats.added },
                { name: 'multibuffer-header-removed', text: stats.removed },
            ];
            const headerText = headerNodes.map((node) => node.text).join('');
            const headerBinaryTokens = BinaryTokens.encode(headerNodes);

            const headerLine = line;
            const headerStartOffset = offset;
            offset += headerText.length + 1;
            line += 1;

            this.headerInfos.push({
                fileIndex,
                fileId: entry.id,
                path: entry.path,
                fileName,
                dirName,
                iconClassName: entry.iconClassName,
                line: headerLine,
                collapsed,
                added,
                removed,
            });

            const bodyStartLine = line;
            const bodyStartOffset = offset;
            let bodyLineCount = 0;
            let bodyCharLength = 0;

            if (!collapsed) {
                bodyLineCount = Math.max(1, entry.code.linesLength());
                bodyCharLength = entry.code.getContentLength();
                offset += bodyCharLength + 1;
                line += bodyLineCount;
            }

            const totalLines = 1 + bodyLineCount;

            this.fileRanges.push({
                fileIndex,
                fileId: entry.id,
                path: entry.path,
                collapsed,
                headerText,
                headerLine,
                bodyStartLine,
                bodyLineCount,
                totalLines,
                headerStartOffset,
                bodyStartOffset,
                bodyCharLength,
                nextStartOffset: offset,
                headerNodes,
                headerBinaryTokens,
            });
        }

        if (offset > 0) {
            offset -= 1;
        }
        this.totalLineCount = line;
        this.totalCharLength = offset;
        this.indexDirty = false;
    }

    private getCachedFileDiff(fileIndex: number): CachedFileDiff {
        const entry = this.entries[fileIndex];
        if (!entry) return { version: 0, diffs: DiffModel.empty(), added: 0, removed: 0 };
        const version = this.fileVersions[fileIndex];
        let cached = this.fileDiffs.get(entry.id);
        if (!cached || cached.version !== version) {
            const originalLines = entry.originalCode ? entry.originalCode.getLines() : entry.code.getLines();
            const result = computeGitChangesWithStats(originalLines, entry.code.getLines());
            cached = {
                version,
                diffs: result.diffs,
                added: result.added,
                removed: result.removed,
            };
            this.fileDiffs.set(entry.id, cached);
        }
        return cached;
    }

    private getBodyStart(fileIndex: number, original: boolean): number {
        if (!original) {
            const fileRange = this.fileRanges[fileIndex];
            return fileRange && !fileRange.collapsed ? fileRange.bodyStartLine : -1;
        }

        let start = 0;
        for (let index = 0; index < fileIndex; index++) {
            const code = original ? this.entries[index].originalCode : this.entries[index].code;
            start += 1 + Math.max(1, code.linesLength());
        }
        return start + 1;
    }

    private activateFile(fileIndex: number): void {
        this.activeFileIndex = fileIndex;
        const entry = this.entries[fileIndex];
        if (entry) {
            this.filename = entry.path;
            this.language = entry.code.language;
        }
    }

    private markFileChanged(fileIndex: number): void {
        this.fileVersions[fileIndex] += 1;
        this.indexDirty = true;
    }

    private toGlobalChange(change: Change, fileIndex: number): Change {
        const entry = this.entries[fileIndex];
        let stateBefore: EditState | undefined = undefined;
        let stateAfter: EditState | undefined = undefined;

        if (entry && change.stateBefore) {
            let cursor: Point | undefined = undefined;
            if (change.stateBefore.cursor) {
                const globalRow = this.getMultibufferLineForLocalLine(entry.id, change.stateBefore.cursor.row);
                if (globalRow !== null) {
                    cursor = { row: globalRow, column: change.stateBefore.cursor.column };
                }
            }
            let selection: Selection | undefined = undefined;
            if (change.stateBefore.selection) {
                const startRow = this.getMultibufferLineForLocalLine(entry.id, change.stateBefore.selection.start.row);
                const endRow = this.getMultibufferLineForLocalLine(entry.id, change.stateBefore.selection.end.row);
                if (startRow !== null && endRow !== null) {
                    selection = new Selection(
                        { row: startRow, column: change.stateBefore.selection.start.column },
                        { row: endRow, column: change.stateBefore.selection.end.column }
                    );
                }
            }
            stateBefore = { cursor, selection };
        }

        if (entry && change.stateAfter) {
            let cursor: Point | undefined = undefined;
            if (change.stateAfter.cursor) {
                const globalRow = this.getMultibufferLineForLocalLine(entry.id, change.stateAfter.cursor.row);
                if (globalRow !== null) {
                    cursor = { row: globalRow, column: change.stateAfter.cursor.column };
                }
            }
            let selection: Selection | undefined = undefined;
            if (change.stateAfter.selection) {
                const startRow = this.getMultibufferLineForLocalLine(entry.id, change.stateAfter.selection.start.row);
                const endRow = this.getMultibufferLineForLocalLine(entry.id, change.stateAfter.selection.end.row);
                if (startRow !== null && endRow !== null) {
                    selection = new Selection(
                        { row: startRow, column: change.stateAfter.selection.start.column },
                        { row: endRow, column: change.stateAfter.selection.end.column }
                    );
                }
            }
            stateAfter = { cursor, selection };
        }

        return {
            ...change,
            edits: change.edits.map((edit) => ({
                ...edit,
                start: this.toGlobalOffset(fileIndex, edit.start),
            })),
            stateBefore,
            stateAfter,
        };
    }

    private toGlobalOffset(fileIndex: number, localOffset: number): number {
        const entry = this.entries[fileIndex];
        if (!entry) return localOffset;

        const position = entry.code.getPosition(localOffset);
        const line = this.getMultibufferLineForLocalLine(entry.id, position.line);
        return line === null ? localOffset : this.getOffset(line, position.column);
    }
}