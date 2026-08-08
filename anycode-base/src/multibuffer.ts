import { Code, type Change, type Edit, type FoldRange, type HighlighedNode, type Position, type WordHighlight, type FilePosition, Operation } from './code';
import type { Selection } from './selection';
import { computeGitChangesWithStats, type DiffInfo } from './diff';
import History from './history';

export type MultiBufferEntry = {
    id: string;
    path: string;
    added?: number;
    removed?: number;
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
    diffs: Map<number, DiffInfo>;
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
    private readonly multiHistory = new History<Change>();
    private readonly fileVersions: number[];
    private readonly fileDiffs = new Map<string, CachedFileDiff>();
    private readonly collapsedFiles = new Set<string>();
    private rows: IndexedRow[] = [];
    private indexDirty = true;
    private activeFileIndex = 0;
    private activeTransaction = false;
    private transactionEdits: Edit[] = [];
    private transactionFileEdits = new Map<string, Edit[]>();
    private transactionStateBefore: unknown;
    private transactionStateAfter: unknown;
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
    public getMultibufferDiffs(): Map<number, DiffInfo> {
        this.ensureIndex();
        const diffs = new Map<number, DiffInfo>();

        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const cached = this.getCachedFileDiff(fileIndex);

            const currentBodyStart = this.getBodyStart(fileIndex, false);
            if (currentBodyStart < 0) continue;
            const originalBodyStart = this.getBodyStart(fileIndex, true);
            for (const [localLine, diff] of cached.diffs) {
                diffs.set(currentBodyStart + localLine, {
                    ...diff,
                    oldLineNumbers: diff.oldLineNumbers?.map((line) => originalBodyStart + line),
                    ghostAnchorLine: diff.ghostAnchorLine === undefined
                        ? undefined
                        : currentBodyStart + diff.ghostAnchorLine,
                    hunkId: fileIndex * 1_000_000 + diff.hunkId,
                });
            }
        }

        return diffs;
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

    public getOffset(line: number, column: number): number {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row) return this.getContentLength();

        this.activateFile(row.fileIndex);
        if (row.kind === 'header') {
            const bodyRow = this.rows.findIndex((candidate) => (
                candidate.fileIndex === row.fileIndex && candidate.kind === 'file'
            ));
            return bodyRow >= 0 ? this.rows[bodyRow].start : row.start;
        }

        return row.start + Math.max(0, Math.min(row.text.length, column));
    }

    public getIntervalContent2(from: number, to: number): string {
        return this.getContent().slice(Math.max(0, from), Math.max(0, to));
    }

    public getLineNodes(line: number): HighlighedNode[] {
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

    public getIndent() {
        return this.entries[this.activeFileIndex]?.code.getIndent() ?? null;
    }

    public getComment(): string {
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

    public setHistory(changes: Change[], index: number): void {
        this.multiHistory.setRawHistory(changes, index);
    }

    public tx(): void {
        this.activeTransaction = true;
        this.transactionEdits = [];
        this.transactionFileEdits.clear();
    }

    public setStateBefore(offset: number, selection?: Selection): void {
        this.transactionStateBefore = {
            offset,
            selection: selection?.clone(),
        };
    }

    public setStateAfter(offset: number, selection?: Selection): void {
        this.transactionStateAfter = {
            offset,
            selection: selection?.clone(),
        };
    }

    public commit(): void {
        if (!this.activeTransaction) return;
        const change: Change = {
            edits: [...this.transactionEdits],
            stateBefore: this.transactionStateBefore as Change['stateBefore'],
            stateAfter: this.transactionStateAfter as Change['stateAfter'],
        };
        this.multiHistory.push(change);
        this.emitChanges(change);
        this.resetTransaction();
    }

    public undo(): Change | undefined {
        const change = this.multiHistory.undo();
        if (!change) return undefined;
        this.tx();
        for (const edit of [...change.edits].reverse()) {
            if (edit.operation === Operation.Insert) this.removeRaw(edit.start, edit.text.length);
            else this.insertRaw(edit.text, edit.start);
        }
        this.emitChanges({ edits: [...this.transactionEdits], isUndo: true });
        this.resetTransaction();
        return change;
    }

    public redo(): Change | null {
        const change = this.multiHistory.redo();
        if (!change) return null;
        this.tx();
        for (const edit of change.edits) {
            if (edit.operation === Operation.Insert) this.insertRaw(edit.text, edit.start);
            else this.removeRaw(edit.start, edit.text.length);
        }
        this.emitChanges({ edits: [...this.transactionEdits], isRedo: true });
        this.resetTransaction();
        return change;
    }

    public insert(text: string, offset: number): void {
        this.insertRaw(text, offset);
    }

    public remove(offset: number, length: number): void {
        this.removeRaw(offset, length);
    }

    private insertRaw(text: string, offset: number): void {
        if (!text) return;
        const resolved = this.resolveOffset(offset);
        if (!resolved || resolved.row.kind === 'header') return;

        const entry = this.entries[resolved.fileIndex];
        const localOffset = Math.min(resolved.localOffset, entry.code.getContentLength());
        entry.code.insert(text, localOffset);
        this.fileVersions[resolved.fileIndex] += 1;
        this.indexDirty = true;
        this.recordEdit(
            resolved.fileIndex,
            { operation: Operation.Insert, start: localOffset, text },
            { operation: Operation.Insert, start: offset, text },
        );
    }

    private removeRaw(offset: number, length: number): void {
        if (length <= 0) return;
        const start = this.resolveOffset(offset);
        const end = this.resolveOffset(Math.max(offset, offset + length - 1));
        if (!start || !end || start.row.kind === 'header' || start.fileIndex !== end.fileIndex) return;

        const entry = this.entries[start.fileIndex];
        const maxLength = Math.max(0, entry.code.getContentLength() - start.localOffset);
        const removeLength = Math.min(length, maxLength);
        if (removeLength <= 0) return;
        const text = entry.code.getIntervalContent2(start.localOffset, start.localOffset + removeLength);
        entry.code.remove(start.localOffset, removeLength);
        this.fileVersions[start.fileIndex] += 1;
        this.indexDirty = true;
        this.recordEdit(
            start.fileIndex,
            { operation: Operation.Remove, start: start.localOffset, text },
            { operation: Operation.Remove, start: offset, text },
        );
    }

    private recordEdit(fileIndex: number, localEdit: Edit, globalEdit: Edit): void {
        if (!this.activeTransaction) return;
        this.transactionEdits.push(globalEdit);
        const fileId = this.entries[fileIndex].id;
        const edits = this.transactionFileEdits.get(fileId) ?? [];
        edits.push(localEdit);
        this.transactionFileEdits.set(fileId, edits);
    }

    private emitChanges(change: Change): void {
        for (const [fileId, edits] of this.transactionFileEdits) {
            this.onFileChangeCallback?.({ fileId, change: { edits, isUndo: change.isUndo, isRedo: change.isRedo } });
        }
        this.onChangeCallback?.(change);
    }

    private resetTransaction(): void {
        this.activeTransaction = false;
        this.transactionEdits = [];
        this.transactionFileEdits.clear();
        this.transactionStateBefore = undefined;
        this.transactionStateAfter = undefined;
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
        if (!entry) return { version: 0, diffs: new Map(), added: 0, removed: 0 };
        const version = this.fileVersions[fileIndex];
        let cached = this.fileDiffs.get(entry.id);
        if (!cached || cached.version !== version) {
            const result = computeGitChangesWithStats(entry.originalCode.getLines(), entry.code.getLines());
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
}
