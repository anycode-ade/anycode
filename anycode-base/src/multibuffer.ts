import { Code, type Change, type Edit, type FoldRange, type HighlighedNode, type Position, type WordHighlight, type FilePosition, Operation } from './code';
import type { Selection } from './selection';
import { computeGitChangesWithStats, type DiffInfo } from './diff';
import { DiffCode } from './diffCode';
import { parseUnifiedDiff } from './diffParser';

export type MultiBufferDiffEntry = {
    kind: 'diff';
    id: string;
    path: string;
    diffCode: DiffCode;
    added?: number;
    removed?: number;
    readOnly?: boolean;
};

export type MultiBufferCodeEntry = {
    kind?: 'code';
    id: string;
    path: string;
    code: Code;
    originalCode: Code;
    added?: number;
    removed?: number;
    readOnly?: boolean;
};

export type MultiBufferEntry = MultiBufferDiffEntry | MultiBufferCodeEntry;

export function isDiffEntry(entry: MultiBufferEntry): entry is MultiBufferDiffEntry {
    return (entry as MultiBufferDiffEntry).kind === 'diff' || 'diffCode' in entry;
}

export function isCodeEntry(entry: MultiBufferEntry): entry is MultiBufferCodeEntry {
    return !isDiffEntry(entry);
}

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
 * Supports both lightweight DiffCode (patch-only) and interactive Code entries.
 */
export class MultiBufferCode extends Code {
    private readonly entries: MultiBufferEntry[];
    private readonly fileVersions: number[];
    private readonly fileDiffs = new Map<string, CachedFileDiff>();
    private readonly collapsedFiles = new Set<string>();
    private rows: IndexedRow[] = [];
    private indexDirty = true;
    private activeFileIndex = 0;
    private onChangeCallback: ((change: Change) => void) | null = null;
    private onFileChangeCallback: ((change: MultiBufferFileChange) => void) | null = null;

    constructor(entries: MultiBufferEntry[]) {
        super('', 'multibuffer', '');
        this.entries = entries;
        this.fileVersions = entries.map(() => 0);
        this.filename = entries[0]?.path ?? 'multibuffer';
    }

    public async init(): Promise<void> {
        // Materialized file baselines need Tree-Sitter init; DiffCode entries are already ready.
        const baselines = new Set(
            this.entries
                .filter(isCodeEntry)
                .map((entry) => entry.originalCode)
        );
        await Promise.all([...baselines].map((code) => code.init()));
        this.indexDirty = true;
    }

    public async addEntries(entries: MultiBufferEntry[], atIndex = this.entries.length): Promise<void> {
        if (entries.length === 0) return;

        const insertionIndex = Math.max(0, Math.min(atIndex, this.entries.length));
        this.entries.splice(insertionIndex, 0, ...entries);
        this.fileVersions.splice(insertionIndex, 0, ...entries.map(() => 0));
        const baselines = new Set(
            entries
                .filter(isCodeEntry)
                .map((entry) => entry.originalCode)
        );
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

    /**
     * Seamlessly swaps a DiffCode entry to a full Code entry on demand.
     */
    public materializeFile(fileId: string, code: Code, originalCode: Code): boolean {
        const index = this.entries.findIndex((entry) => entry.id === fileId || entry.path === fileId);
        if (index < 0) return false;

        const current = this.entries[index];
        this.entries[index] = {
            kind: 'code',
            id: current.id,
            path: current.path,
            added: current.added,
            removed: current.removed,
            readOnly: current.readOnly,
            code,
            originalCode,
        };
        this.fileVersions[index] += 1;
        this.fileDiffs.delete(current.id);
        this.indexDirty = true;
        return true;
    }

    /**
     * Updates or sets DiffCode for a given file entry while preserving file ordering.
     */
    public setDiff(fileId: string, diffCode: DiffCode): boolean {
        const normalized = fileId.replace(/\\/g, '/').replace(/^\.\/+/, '');
        const index = this.entries.findIndex((entry) => {
            if (entry.id === fileId || entry.path === fileId) return true;
            const entryNorm = entry.path.replace(/\\/g, '/').replace(/^\.\/+/, '');
            return entryNorm === normalized || entryNorm.endsWith('/' + normalized) || normalized.endsWith('/' + entryNorm);
        });
        if (index < 0) return false;

        const current = this.entries[index];
        if (isDiffEntry(current)) {
            current.diffCode = diffCode;
            current.added = diffCode.added;
            current.removed = diffCode.removed;
        } else {
            this.entries[index] = {
                kind: 'diff',
                id: current.id,
                path: current.path,
                added: diffCode.added,
                removed: diffCode.removed,
                readOnly: current.readOnly,
                diffCode,
            };
        }
        this.fileDiffs.delete(current.id);
        this.indexDirty = true;
        return true;
    }

    /**
     * Populates diff hunks across all matching file entries from a raw unified diff patch.
     * Preserves the predefined order of entries in the MultiBuffer.
     */
    public setRawDiff(rawDiff: string): void {
        const parsedFiles = parseUnifiedDiff(rawDiff);
        for (const parsed of parsedFiles) {
            const diffCode = new DiffCode(parsed);
            this.setDiff(parsed.id, diffCode) || this.setDiff(parsed.path, diffCode);
        }
        this.indexDirty = true;
    }

    public isDiffEntryAt(fileIndex: number): boolean {
        const entry = this.entries[fileIndex];
        return entry ? isDiffEntry(entry) : false;
    }

    public isDiffEntry(fileId: string): boolean {
        const entry = this.entries.find((e) => e.id === fileId || e.path === fileId);
        return entry ? isDiffEntry(entry) : false;
    }

    public getEntries(): ReadonlyArray<MultiBufferEntry> {
        return this.entries;
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
        if (!row || row.kind !== 'file') return null;

        const entry = this.entries[row.fileIndex];
        if (!entry) return null;

        if (isDiffEntry(entry)) {
            const display = entry.diffCode.getDisplayLineNumber(row.localLine);
            return display !== undefined ? display : row.localLine + 1;
        }

        return row.localLine + 1;
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
        const entry = this.entries.find((e) => e.id === fileId);
        if (!entry) return null;
        return isDiffEntry(entry) ? entry.diffCode.getContent() : entry.code.getContent();
    }

    public notifyFileChanged(fileId: string): void {
        const fileIndex = this.entries.findIndex((entry) => entry.id === fileId);
        if (fileIndex < 0) return;
        this.fileVersions[fileIndex] += 1;
        this.indexDirty = true;
    }

    /**
     * Compute composite diff using per-file caches.
     * For DiffCode entries, pre-calculated diffs are reused instantly.
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
                const len = isDiffEntry(entry) ? entry.diffCode.linesLength() : entry.code.linesLength();
                rowIndex += Math.max(1, len);
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
        return row.start + Math.max(0, Math.min(row.text.length, column));
    }

    public getIntervalContent2(from: number, to: number): string {
        return this.getContent().slice(Math.max(0, from), Math.max(0, to));
    }

    public getMultibufferRowMeta(line: number): {
        nodes: HighlighedNode[];
        isHeader: boolean;
        displayLineNumber?: number;
    } {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row) {
            return { nodes: [{ name: null, text: EMPTY_LINE }], isHeader: false };
        }
        if (row.kind === 'header') {
            const entry = this.entries[row.fileIndex];
            const { added, removed } = this.getCachedFileDiff(row.fileIndex);
            const stats = formatFileStats(added, removed);
            return {
                nodes: [
                    {
                        name: 'multibuffer-header',
                        text: `${this.collapsedFiles.has(entry.id) ? '▸' : '▾'} ${getFileName(entry.path)}`,
                    },
                    { name: 'multibuffer-header-added', text: stats.added },
                    { name: 'multibuffer-header-removed', text: stats.removed },
                ],
                isHeader: true,
            };
        }
        const entry = this.entries[row.fileIndex];
        if (!entry) {
            return { nodes: [{ name: null, text: EMPTY_LINE }], isHeader: false };
        }
        if (isDiffEntry(entry)) {
            const display = entry.diffCode.getDisplayLineNumber(row.localLine);
            return {
                nodes: entry.diffCode.getLineNodes(row.localLine),
                isHeader: false,
                displayLineNumber: display !== undefined ? display : row.localLine + 1,
            };
        }
        return {
            nodes: entry.code.getLineNodes(row.localLine),
            isHeader: false,
            displayLineNumber: row.localLine + 1,
        };
    }

    public getLineNodes(line: number): HighlighedNode[] {
        return this.getMultibufferRowMeta(line).nodes;
    }

    public highlightLines(lines: number[]): { line: number; nodes: HighlighedNode[] }[] {
        return lines.map((line) => ({
            line,
            nodes: this.getLineNodes(line),
        }));
    }

    public getFoldRanges(): FoldRange[] {
        this.ensureIndex();
        const ranges: FoldRange[] = [];
        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const entry = this.entries[fileIndex];
            if (isDiffEntry(entry)) continue;
            const firstBodyRow = this.rows.findIndex((row) => row.fileIndex === fileIndex && row.kind === 'file');
            if (firstBodyRow < 0) continue;
            for (const range of entry.code.getFoldRanges()) {
                ranges.push({ ...range, startLine: firstBodyRow + range.startLine, endLine: firstBodyRow + range.endLine });
            }
        }
        return ranges;
    }

    public getWordAtOffset(offset: number): WordHighlight | null {
        const resolved = this.resolveOffset(offset);
        if (!resolved || resolved.row.kind === 'header') return null;
        const entry = this.entries[resolved.fileIndex];
        if (isDiffEntry(entry)) return null;
        return entry.code.getWordAtOffset(resolved.localOffset);
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

    public override getIndent(): { width: number; unit: string } | null {
        const entry = this.entries[this.activeFileIndex];
        if (!entry || isDiffEntry(entry)) return null;
        return entry.code.getIndent();
    }

    public getComment(): string {
        const entry = this.entries[this.activeFileIndex];
        if (!entry || isDiffEntry(entry)) return '';
        return entry.code.getComment();
    }

    public getIndentationLevel(line: number, column?: number): number {
        const resolved = this.resolveLine(line);
        if (!resolved) return 0;
        const entry = this.entries[resolved.fileIndex];
        if (!entry || isDiffEntry(entry)) return 0;
        return entry.code.getIndentationLevel(resolved.localLine, column);
    }

    public isOnlyIndentationBefore(line: number, column: number): boolean {
        const resolved = this.resolveLine(line);
        if (!resolved) return false;
        const entry = this.entries[resolved.fileIndex];
        if (!entry || isDiffEntry(entry)) return false;
        return entry.code.isOnlyIndentationBefore(resolved.localLine, column);
    }

    public prevIndentation(line: number, column: number): number {
        const resolved = this.resolveLine(line);
        if (!resolved) return 0;
        const entry = this.entries[resolved.fileIndex];
        if (!entry || isDiffEntry(entry)) return 0;
        return entry.code.prevIndentation(resolved.localLine, column);
    }

    public setOnChange(callback: ((change: Change) => void) | null): void {
        this.onChangeCallback = callback;
    }

    public override setHistory(_changes: Change[], _index: number): void {
        // MultiBufferCode does not own history. Each file's Code does.
    }

    public override tx(): void {}
    public override setStateBefore(_offset: number, _selection?: Selection): void {}
    public override setStateAfter(_offset: number, _selection?: Selection): void {}
    public override commit(): void {}

    public override undo(offset?: number): Change | undefined {
        const resolved = offset === undefined ? undefined : this.resolveOffset(offset);
        if (!resolved || resolved.row.kind === 'header') return undefined;

        const fileIndex = resolved.fileIndex;
        const entry = this.entries[fileIndex];
        if (!entry || isDiffEntry(entry)) return undefined;

        const change = entry.code.undo();
        if (!change) return undefined;
        this.markFileChanged(fileIndex);
        return this.toGlobalChange(change, fileIndex);
    }

    public override redo(offset?: number): Change | null {
        if (offset === undefined) return null;
        const resolved = this.resolveOffset(offset);
        if (!resolved || resolved.row.kind === 'header') return null;

        const fileIndex = resolved.fileIndex;
        const entry = this.entries[fileIndex];
        if (!entry || isDiffEntry(entry)) return null;

        const change = entry.code.redo() ?? null;
        if (!change) return null;
        this.markFileChanged(fileIndex);
        return this.toGlobalChange(change, fileIndex);
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
        if (!entry || isDiffEntry(entry) || entry.readOnly) return;
        const localOffset = Math.min(resolved.localOffset, entry.code.getContentLength());
        entry.code.insert(text, localOffset, true);
        this.markFileChanged(resolved.fileIndex);
        this.notifyEdit(
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
        if (!entry || isDiffEntry(entry) || entry.readOnly) return;
        const maxLength = Math.max(0, entry.code.getContentLength() - start.localOffset);
        const removeLength = Math.min(length, maxLength);
        if (removeLength <= 0) return;
        const text = entry.code.getIntervalContent2(start.localOffset, start.localOffset + removeLength);
        entry.code.remove(start.localOffset, removeLength, true);
        this.markFileChanged(start.fileIndex);
        this.notifyEdit(
            start.fileIndex,
            { operation: Operation.Remove, start: start.localOffset, text },
            { operation: Operation.Remove, start: offset, text },
        );
    }

    private notifyEdit(fileIndex: number, localEdit: Edit, globalEdit: Edit): void {
        const fileId = this.entries[fileIndex].id;
        this.onFileChangeCallback?.({ fileId, change: { edits: [localEdit] } });
        this.onChangeCallback?.({ edits: [globalEdit] });
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

            const lines = isDiffEntry(entry) ? entry.diffCode.getLines() : entry.code.getLines();
            const fileLines = lines.length > 0 ? lines : [''];
            if (this.collapsedFiles.has(entry.id)) continue;
            for (let localLine = 0; localLine < fileLines.length; localLine++) {
                const text = fileLines[localLine] ?? '';
                const localStart = isDiffEntry(entry)
                    ? entry.diffCode.getOffset(localLine, 0)
                    : entry.code.getOffset(localLine, 0);

                this.rows.push({
                    kind: 'file',
                    fileIndex,
                    localLine,
                    localStart,
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
        if (isDiffEntry(entry)) {
            return {
                version: 0,
                diffs: entry.diffCode.getDiffs(),
                added: entry.added ?? entry.diffCode.added,
                removed: entry.removed ?? entry.diffCode.removed,
            };
        }
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
            const entry = this.entries[index];
            const count = isDiffEntry(entry)
                ? entry.diffCode.linesLength()
                : (original ? entry.originalCode.linesLength() : entry.code.linesLength());
            start += 1 + Math.max(1, count);
        }
        return start + 1;
    }

    private activateFile(fileIndex: number): void {
        this.activeFileIndex = fileIndex;
        const entry = this.entries[fileIndex];
        if (entry) {
            if (isDiffEntry(entry)) {
                this.filename = entry.diffCode.path;
                this.language = entry.diffCode.language;
            } else {
                this.filename = entry.code.filename || entry.path;
                this.language = entry.code.language;
            }
        }
    }

    private markFileChanged(fileIndex: number): void {
        this.fileVersions[fileIndex] += 1;
        this.indexDirty = true;
    }

    private toGlobalChange(change: Change, fileIndex: number): Change {
        return {
            ...change,
            edits: change.edits.map((edit) => ({
                ...edit,
                start: this.toGlobalOffset(fileIndex, edit.start),
            })),
            // MultiBuffer does not record cursor state; local file state
            // cannot be used as a global MultiBuffer offset.
            stateBefore: undefined,
            stateAfter: undefined,
        };
    }

    private toGlobalOffset(fileIndex: number, localOffset: number): number {
        const entry = this.entries[fileIndex];
        if (!entry) return localOffset;

        const position = isDiffEntry(entry)
            ? entry.diffCode.getPosition(localOffset)
            : entry.code.getPosition(localOffset);
        const line = this.getMultibufferLineForLocalLine(entry.id, position.line);
        return line === null ? localOffset : this.getOffset(line, position.column);
    }
}
