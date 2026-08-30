import { Code, type Change, type Edit, type EditState, type FoldRange, type HighlighedNode, type Position, type WordHighlight, type FilePosition, Operation, type Point } from './code';
import { BinaryTokens } from './tokens';
import { Selection } from './selection';
import { computeGitChangesWithStats, type DiffInfo, type DiffHunk, DiffModel } from './diff';

export type MultiBufferEntry = {
    id: string;
    path: string;
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

type IndexedRow = {
    kind: 'header' | 'file';
    fileIndex: number;
    localLine: number;
    localStart: number;
    text: string;
    start: number;
};

type ResolvedOffset = {
    fileIndex: number;
    localOffset: number;
    row: IndexedRow;
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
    private readonly fileDiffs = new Map<string, CachedFileDiff>();
    private readonly collapsedFiles = new Set<string>();
    private rows: IndexedRow[] = [];
    private indexDirty = true;
    private activeFileIndex = 0;
    private activeTxFileIndex: number | null = null;
    private onChangeCallback: ((change: Change) => void) | null = null;
    private onFileChangeCallback: ((change: MultiBufferFileChange) => void) | null = null;

    constructor(entries: MultiBufferEntry[]) {
        super('', 'multibuffer', '');
        this.entries = entries;
        this.fileVersions = entries.map(() => 0);
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
        const row = this.rows[line];
        if (!row) return null;
        this.activateFile(row.fileIndex);
        return this.entries[row.fileIndex]?.id ?? null;
    }

    public getFirstLineForFile(fileId: string): number | null {
        this.ensureIndex();
        const fileIndex = this.entries.findIndex((entry) => entry.id === fileId || entry.path === fileId);
        if (fileIndex < 0) return null;
        const rowIndex = this.rows.findIndex((row) => row.fileIndex === fileIndex);
        return rowIndex >= 0 ? rowIndex : null;
    }

    public getMultibufferLineNumber(line: number): number | null {
        this.ensureIndex();
        const row = this.rows[line];
        return row?.kind === 'file' ? row.localLine : null;
    }

    public getMultibufferLineForLocalLine(fileId: string, localLine: number): number | null {
        this.ensureIndex();
        const fileIndex = this.entries.findIndex((entry) => entry.id === fileId || entry.path === fileId);
        if (fileIndex < 0) return null;
        const rowIndex = this.rows.findIndex(
            (row) => row.fileIndex === fileIndex && row.kind === 'file' && row.localLine === localLine,
        );
        return rowIndex >= 0 ? rowIndex : null;
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
        while (
            candidate >= 0
            && candidate < this.rows.length
            && this.rows[candidate].kind === 'header'
        ) {
            candidate += direction;
        }
        return candidate;
    }

    public override isLineEditable(line: number): boolean {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row || row.kind === 'header') return false;
        return !this.entries[row.fileIndex]?.readOnly;
    }

    public override findFirstEditableLine(): number {
        this.ensureIndex();
        const idx = this.rows.findIndex((r) => r.kind !== 'header' && !this.entries[r.fileIndex]?.readOnly);
        return idx !== -1 ? idx : 0;
    }

    public override clampPoint(point: Point, preferDirection: -1 | 1 = 1): Point {
        this.ensureIndex();
        if (this.rows.length === 0) return { row: 0, column: 0 };
        let row = Math.max(0, Math.min(point.row, this.rows.length - 1));
        if (this.rows[row]?.kind === 'header') {
            let candidate = row + preferDirection;
            while (candidate >= 0 && candidate < this.rows.length && this.rows[candidate].kind === 'header') {
                candidate += preferDirection;
            }
            if (candidate >= 0 && candidate < this.rows.length && this.rows[candidate].kind !== 'header') {
                row = candidate;
            } else {
                candidate = row - preferDirection;
                while (candidate >= 0 && candidate < this.rows.length && this.rows[candidate].kind === 'header') {
                    candidate -= preferDirection;
                }
                if (candidate >= 0 && candidate < this.rows.length && this.rows[candidate].kind !== 'header') {
                    row = candidate;
                }
            }
        }
        const col = Math.max(0, Math.min(point.column, this.lineLength(row)));
        return { row, column: col };
    }

    public toggleMultibufferFileAtLine(line: number): boolean {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row || row.kind !== 'header') return false;
        const entry = this.entries[row.fileIndex];
        if (!entry) return false;

        if (this.collapsedFiles.has(entry.id)) {
            this.collapsedFiles.delete(entry.id);
        } else {
            this.collapsedFiles.add(entry.id);
        }
        this.indexDirty = true;
        return true;
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
        const row = this.rows[line];
        return row?.kind === 'header' ? row.text : null;
    }

    public override isSameFileBody(lineA: number, lineB: number): boolean {
        this.ensureIndex();
        const rowA = this.rows[lineA];
        const rowB = this.rows[lineB];
        if (!rowA || !rowB) return false;
        if (rowA.kind !== 'file' || rowB.kind !== 'file') return false;
        return rowA.fileIndex === rowB.fileIndex;
    }

    public isMultibufferSameFileBody(lineA: number, lineB: number): boolean {
        return this.isSameFileBody(lineA, lineB);
    }

    public override getAlwaysVisibleLines(_totalLines: number): Set<number> {
        const headers = new Set<number>();
        let rowIndex = 0;
        for (const entry of this.entries) {
            headers.add(rowIndex);
            rowIndex += 1;
            if (!this.collapsedFiles.has(entry.id)) {
                rowIndex += Math.max(1, entry.code.linesLength());
            }
        }
        return headers;
    }

    public getMultibufferAlwaysVisibleLines(totalLines: number): Set<number> {
        return this.getAlwaysVisibleLines(totalLines);
    }

    public getLines(): string[] {
        this.ensureIndex();
        return this.rows.map((row) => row.text);
    }

    public getContent(): string {
        return this.getLines().join('\n');
    }

    public getContentLength(): number {
        this.ensureIndex();
        if (this.rows.length === 0) return 0;
        const last = this.rows[this.rows.length - 1];
        return last.start + last.text.length;
    }

    public length(): number {
        return this.getContentLength();
    }

    public linesLength(): number {
        this.ensureIndex();
        return this.rows.length;
    }

    public line(line: number): string {
        this.ensureIndex();
        return this.rows[line]?.text ?? '';
    }

    public lineLength(line: number): number {
        return this.line(line).length;
    }

    public getLineByOffset(offset: number): number {
        return this.findRow(offset)?.index ?? 0;
    }

    public getPosition(offset: number): Position {
        this.ensureIndex();
        const found = this.findRow(offset);
        if (!found) return { line: 0, column: 0 };

        this.activateFile(found.fileIndex);
        return {
            line: found.index,
            column: Math.max(0, Math.min(found.text.length, offset - found.start)),
        };
    }

    public override getPoint(offset: number): Point {
        const pos = this.getPosition(offset);
        return { row: pos.line, column: pos.column };
    }

    public getOffset(line: number, column: number): number {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row) return this.getContentLength();

        this.activateFile(row.fileIndex);
        return row.start + Math.max(0, Math.min(row.text.length, column));
    }

    public getIntervalContent2(from: number, to: number): string {
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
        const row = this.rows[line];
        if (!row) return [{ name: null, text: EMPTY_LINE }];
        if (row.kind === 'header') {
            const entry = this.entries[row.fileIndex];
            const { added, removed } = this.getCachedFileDiff(row.fileIndex);
            const stats = formatFileStats(added, removed);
            return [
                {
                    name: 'multibuffer-header',
                    text: `${this.collapsedFiles.has(entry.id) ? '▸' : '▾'} ${getFileName(entry.path)}`,
                },
                { name: 'multibuffer-header-added', text: stats.added },
                { name: 'multibuffer-header-removed', text: stats.removed },
            ];
        }
        return this.entries[row.fileIndex]?.code.getLineNodes(row.localLine) ?? [{ name: null, text: EMPTY_LINE }];
    }

    public override getLineBinaryTokens(line: number): Uint32Array {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row) return new Uint32Array(0);
        if (row.kind === 'header') {
            const nodes = this.getLineNodes(line);
            return BinaryTokens.encode(nodes);
        }
        return this.entries[row.fileIndex]?.code.getLineBinaryTokens(row.localLine) ?? new Uint32Array(0);
    }

    public getFoldRanges(): FoldRange[] {
        this.ensureIndex();
        const ranges: FoldRange[] = [];
        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const firstBodyRow = this.rows.findIndex((row) => row.fileIndex === fileIndex && row.kind === 'file');
            if (firstBodyRow < 0) continue;
            for (const range of this.entries[fileIndex].code.getFoldRanges()) {
                ranges.push({ ...range, startLine: firstBodyRow + range.startLine, endLine: firstBodyRow + range.endLine });
            }
        }
        return ranges;
    }

    public getWordAtOffset(offset: number): WordHighlight | null {
        const resolved = this.resolveOffset(offset);
        if (!resolved || resolved.row.kind === 'header') return null;
        return this.entries[resolved.fileIndex].code.getWordAtOffset(resolved.localOffset);
    }

    public search(pattern: string): { line: number; column: number }[] {
        if (!pattern) return [];
        this.ensureIndex();
        const matches: { line: number; column: number }[] = [];
        for (let line = 0; line < this.rows.length; line++) {
            let index = -1;
            while ((index = this.rows[line].text.indexOf(pattern, index + 1)) !== -1) {
                matches.push({ line, column: index });
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
        const row = this.rows[cursor.row];
        if (row && row.kind !== 'header') {
            this.activeTxFileIndex = row.fileIndex;
            const entry = this.entries[row.fileIndex];
            if (entry && !entry.readOnly) {
                entry.code.tx();
                const localCursor = { row: row.localLine, column: cursor.column };
                let localSelection: Selection | undefined = undefined;
                if (selection) {
                    const startRow = this.rows[selection.start.row];
                    const endRow = this.rows[selection.end.row];
                    if (startRow?.kind === 'file' && endRow?.kind === 'file' && startRow.fileIndex === row.fileIndex && endRow.fileIndex === row.fileIndex) {
                        localSelection = new Selection(
                            { row: startRow.localLine, column: selection.start.column },
                            { row: endRow.localLine, column: selection.end.column }
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
            const row = this.rows[cursor.row];
            if (row && row.kind !== 'header' && row.fileIndex === this.activeTxFileIndex) {
                const entry = this.entries[this.activeTxFileIndex];
                if (entry && !entry.readOnly) {
                    const localCursor = { row: row.localLine, column: cursor.column };
                    let localSelection: Selection | undefined = undefined;
                    if (selection) {
                        const startRow = this.rows[selection.start.row];
                        const endRow = this.rows[selection.end.row];
                        if (startRow?.kind === 'file' && endRow?.kind === 'file' && startRow.fileIndex === this.activeTxFileIndex && endRow.fileIndex === this.activeTxFileIndex) {
                            localSelection = new Selection(
                                { row: startRow.localLine, column: selection.start.column },
                                { row: endRow.localLine, column: selection.end.column }
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
        const row = this.rows[point.row];
        if (!row || row.kind === 'header') return;
        const entry = this.entries[row.fileIndex];
        if (entry.readOnly) return;
        if (this.activeTxFileIndex === null) {
            this.activeTxFileIndex = row.fileIndex;
            if (this.changeActive) {
                entry.code.tx();
            }
        }
        const localOffset = entry.code.getOffset(row.localLine, point.column);
        entry.code.insert(text, localOffset, this.changeActive ? false : addHistory);
        this.markFileChanged(row.fileIndex);
    }

    public override removeRange(start: Point, end: Point, addHistory: boolean = false): void {
        this.ensureIndex();
        const startRow = this.rows[start.row];
        const endRow = this.rows[end.row];
        if (!startRow || !endRow || startRow.kind === 'header' || endRow.kind === 'header') return;
        if (startRow.fileIndex !== endRow.fileIndex) return;

        const entry = this.entries[startRow.fileIndex];
        if (entry.readOnly) return;

        if (this.activeTxFileIndex === null) {
            this.activeTxFileIndex = startRow.fileIndex;
            if (this.changeActive) {
                entry.code.tx();
            }
        }

        const startLocalOffset = entry.code.getOffset(startRow.localLine, start.column);
        const endLocalOffset = entry.code.getOffset(endRow.localLine, end.column);
        const [sortedStart, sortedEnd] = startLocalOffset <= endLocalOffset
            ? [startLocalOffset, endLocalOffset]
            : [endLocalOffset, startLocalOffset];
        const removeLen = sortedEnd - sortedStart;
        if (removeLen <= 0) return;

        const text = entry.code.getIntervalContent2(sortedStart, sortedEnd);
        entry.code.remove(sortedStart, removeLen, this.changeActive ? false : addHistory);
        this.markFileChanged(startRow.fileIndex);
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
            const row = this.rows[cursor.row];
            if (row && row.kind !== 'header') {
                fileIndex = row.fileIndex;
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
            const row = this.rows[cursor.row];
            if (row && row.kind !== 'header') {
                fileIndex = row.fileIndex;
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
        if (!resolved || resolved.row.kind === 'header') return;

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
        if (!start || !end || start.row.kind === 'header' || start.fileIndex !== end.fileIndex) return;

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
        const row = this.rows[line];
        if (!row || row.kind === 'header') return null;
        this.activateFile(row.fileIndex);
        return { fileIndex: row.fileIndex, localLine: row.localLine };
    }

    private resolveOffset(offset: number): ResolvedOffset | null {
        this.ensureIndex();
        const found = this.findRow(offset);
        if (!found) return null;
        const row = found;
        this.activateFile(row.fileIndex);
        if (row.kind === 'header') {
            return { fileIndex: row.fileIndex, localOffset: 0, row };
        }
        return {
            fileIndex: row.fileIndex,
            localOffset: row.localStart + Math.max(0, Math.min(row.text.length, offset - row.start)),
            row,
        };
    }

    private findRow(offset: number): (IndexedRow & { index: number }) | null {
        this.ensureIndex();
        if (this.rows.length === 0) return null;
        const clamped = Math.max(0, Math.min(this.getContentLength(), offset));
        let low = 0;
        let high = this.rows.length - 1;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const row = this.rows[middle];
            const nextStart = this.rows[middle + 1]?.start ?? Number.POSITIVE_INFINITY;
            if (clamped >= row.start && clamped <= row.start + row.text.length) {
                return { ...row, index: middle };
            }
            if (clamped < row.start) high = middle - 1;
            else if (clamped < nextStart) return { ...row, index: middle };
            else low = middle + 1;
        }
        const last = this.rows[this.rows.length - 1];
        return { ...last, index: this.rows.length - 1 };
    }

    private ensureIndex(): void {
        if (!this.indexDirty) return;
        this.linesCache.clear();
        this.rows = [];
        let offset = 0;
        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const entry = this.entries[fileIndex];
            const { added, removed } = this.getCachedFileDiff(fileIndex);
            const stats = formatFileStats(added, removed);
            const indicator = this.collapsedFiles.has(entry.id) ? '▸' : '▾';
            const header = `${indicator} ${getFileName(entry.path)}${stats.added}${stats.removed}`;
            this.rows.push({ kind: 'header', fileIndex, localLine: -1, localStart: 0, text: header, start: offset });
            offset += header.length + 1;

            const lines = entry.code.getLines();
            const fileLines = lines.length > 0 ? lines : [''];
            if (this.collapsedFiles.has(entry.id)) continue;
            for (let localLine = 0; localLine < fileLines.length; localLine++) {
                const text = fileLines[localLine] ?? '';
                this.rows.push({
                    kind: 'file',
                    fileIndex,
                    localLine,
                    localStart: entry.code.getOffset(localLine, 0),
                    text,
                    start: offset,
                });
                offset += text.length + 1;
            }
        }
        if (this.rows.length > 0) {
            const last = this.rows[this.rows.length - 1];
            if (last.start + last.text.length + 1 === offset) offset -= 1;
        }
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
            return this.rows.findIndex((row) => row.fileIndex === fileIndex && row.kind === 'file');
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