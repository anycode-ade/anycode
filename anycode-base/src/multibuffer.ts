import { Code, type Change, type Edit, type FoldRange, type HighlighedNode, type Position, type WordHighlight, type FilePosition, Operation } from './code';
import { BinaryTokens } from './tokens';
import type { Selection } from './selection';
import type { Lang } from './lang';
import { computeGitChangesWithStats, type DiffInfo, type DiffHunk, DiffModel } from './diff';
import { DiffCode } from './diffCode';
import { parseUnifiedDiff, type ParsedDiffFile } from './diffParser';
import { normalizePath, getFileName } from './utils';

export type CodeMultiBufferEntry = {
    id: string;
    path: string;
    added?: number;
    removed?: number;
    readOnly?: boolean;
    code: Code;
    originalCode: Code;
};

export type DiffMultiBufferEntry = {
    id: string;
    path: string;
    added?: number;
    removed?: number;
    readOnly?: boolean;
    diffCode: DiffCode;
    originalDiffCode?: DiffCode;
};

export type MultiBufferEntry = CodeMultiBufferEntry | DiffMultiBufferEntry;

export function isDiffEntry(entry: MultiBufferEntry): entry is DiffMultiBufferEntry {
    return 'diffCode' in entry;
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
    diffs: DiffModel;
    added: number;
    removed: number;
};

const EMPTY_LINE = '\u200B';

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
    private bodyStartIndices: number[] = [];
    private originalBodyStarts: number[] = [];
    private indexDirty = true;
    private activeFileIndex = 0;
    private onChangeCallback: ((change: Change) => void) | null = null;
    private onFileChangeCallback: ((change: MultiBufferFileChange) => void) | null = null;

    private readonly entryIndexMap = new Map<string, number>();

    constructor(entries: MultiBufferEntry[]) {
        super('', 'multibuffer', '');
        this.entries = entries;
        this.fileVersions = entries.map(() => 0);
        this.rebuildEntryIndexMap();
        const first = entries[0];
        this.filename = first ? (isDiffEntry(first) ? first.diffCode.path : first.path) : 'multibuffer';
    }

    private rebuildEntryIndexMap(): void {
        this.entryIndexMap.clear();
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            this.entryIndexMap.set(entry.id, i);
            this.entryIndexMap.set(entry.path, i);
            const norm = normalizePath(entry.path);
            this.entryIndexMap.set(norm, i);
            if (entry.path.startsWith('/')) this.entryIndexMap.set(entry.path.slice(1), i);
            if (norm.startsWith('/')) this.entryIndexMap.set(norm.slice(1), i);
        }
    }

    public async init(): Promise<void> {
        // Current file buffers are owned and initialized by their regular
        // editors. Review only needs to initialize its separate baselines.
        const baselines = new Set(
            this.entries
                .filter((entry): entry is CodeMultiBufferEntry => !isDiffEntry(entry))
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
        this.rebuildEntryIndexMap();
        const baselines = new Set(
            entries
                .filter((entry): entry is CodeMultiBufferEntry => !isDiffEntry(entry))
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

        this.rebuildEntryIndexMap();
        this.fileDiffs.clear();
        this.collapsedFiles.clear();
        this.activeFileIndex = Math.min(this.activeFileIndex, Math.max(0, this.entries.length - 1));
        this.indexDirty = true;
    }

    private findEntryIndex(fileId: string): number {
        const found = this.entryIndexMap.get(fileId);
        if (found !== undefined) return found;
        const normalized = normalizePath(fileId);
        const foundNorm = this.entryIndexMap.get(normalized);
        if (foundNorm !== undefined) return foundNorm;
        const clean = normalized.startsWith('/') ? normalized.slice(1) : normalized;
        const foundClean = this.entryIndexMap.get(clean);
        if (foundClean !== undefined) return foundClean;

        return this.entries.findIndex((entry) => {
            if (entry.id === fileId || entry.path === fileId) return true;
            const entryNorm = normalizePath(entry.path);
            return entryNorm === normalized || entryNorm.endsWith('/' + normalized) || normalized.endsWith('/' + entryNorm);
        });
    }

    /**
     * Seamlessly swaps a DiffCode entry to a live Code entry on demand.
     */
    public materializeFile(fileId: string, code: Code, originalCode: Code): boolean {
        const index = this.findEntryIndex(fileId);
        if (index < 0) return false;

        const current = this.entries[index];
        const prevLinesLength = isDiffEntry(current)
            ? current.diffCode.linesLength()
            : current.code.linesLength();

        this.entries[index] = {
            id: current.id,
            path: current.path,
            added: current.added,
            removed: current.removed,
            readOnly: current.readOnly,
            code,
            originalCode,
        };
        this.fileVersions[index] += 1;

        if (code.linesLength() !== prevLinesLength) {
            this.indexDirty = true;
            this.linesCache.clear();
            this.fileDiffs.delete(current.id);
        }
        return true;
    }

    /**
     * Updates or sets DiffCode for a given file entry while preserving file ordering.
     */
    public setDiff(fileId: string, diffCode: DiffCode): boolean {
        const index = this.findEntryIndex(fileId);
        if (index < 0) return false;

        const current = this.entries[index];
        if (isDiffEntry(current)) {
            current.diffCode = diffCode;
            current.added = diffCode.added;
            current.removed = diffCode.removed;
            current.originalDiffCode = diffCode.getOriginalDiffCode();
        } else {
            this.entries[index] = {
                id: current.id,
                path: current.path,
                added: diffCode.added,
                removed: diffCode.removed,
                readOnly: current.readOnly,
                diffCode,
                originalDiffCode: diffCode.getOriginalDiffCode(),
            };
        }
        this.fileVersions[index] += 1;
        this.fileDiffs.delete(current.id);
        this.indexDirty = true;
        return true;
    }

    /**
     * Populates diff hunks across all matching file entries from a raw unified diff patch.
     * Preserves the predefined order of entries in the MultiBuffer.
     */
    public setRawDiff(rawDiff: string, isOriginal: boolean = false): void {
        const parsedFiles = parseUnifiedDiff(rawDiff);
        this.applyParsedDiffs(parsedFiles, isOriginal);
    }

    public applyParsedDiffs(parsedFiles: ParsedDiffFile[], isOriginal: boolean = false): void {
        for (const parsed of parsedFiles) {
            const diffCode = DiffCode.fromParsedFile(parsed, isOriginal);
            let index = this.entryIndexMap.get(parsed.id);
            if (index === undefined) index = this.entryIndexMap.get(parsed.path);
            if (index === undefined) index = this.findEntryIndex(parsed.id);
            if (index < 0) index = this.findEntryIndex(parsed.path);

            if (index >= 0) {
                const current = this.entries[index];
                if (isDiffEntry(current)) {
                    current.diffCode = diffCode;
                    current.added = diffCode.added;
                    current.removed = diffCode.removed;
                    current.originalDiffCode = diffCode.getOriginalDiffCode();
                } else {
                    this.entries[index] = {
                        id: current.id,
                        path: current.path,
                        added: diffCode.added,
                        removed: diffCode.removed,
                        readOnly: current.readOnly,
                        diffCode,
                        originalDiffCode: diffCode.getOriginalDiffCode(),
                    };
                }
                this.fileVersions[index] += 1;
                this.fileDiffs.delete(current.id);
            }
        }
        this.indexDirty = true;
    }

    public isDiffEntryAt(fileIndex: number): boolean {
        const entry = this.entries[fileIndex];
        return entry ? isDiffEntry(entry) : false;
    }

    public isDiffEntry(fileId: string): boolean {
        const index = this.findEntryIndex(fileId);
        return index >= 0 ? isDiffEntry(this.entries[index]) : false;
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
        const fileIndex = this.findEntryIndex(fileId);
        if (fileIndex < 0) return null;
        const rowIndex = this.rows.findIndex((row) => row.fileIndex === fileIndex);
        return rowIndex >= 0 ? rowIndex : null;
    }

    public getMultibufferLineNumber(line: number): number | null {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row || row.kind !== 'file') return null;
        const entry = this.entries[row.fileIndex];
        if (entry && isDiffEntry(entry)) {
            return entry.diffCode.displayLineNumbers[row.localLine] ?? null;
        }
        return row.localLine;
    }

    public getMultibufferLineForLocalLine(fileId: string, localLine: number): number | null {
        this.ensureIndex();
        const fileIndex = this.findEntryIndex(fileId);
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
        const index = this.findEntryIndex(fileId);
        if (index < 0) return null;
        const entry = this.entries[index];
        return isDiffEntry(entry) ? entry.diffCode.getContent() : entry.code.getContent();
    }

    public notifyFileChanged(fileId: string): void {
        const fileIndex = this.findEntryIndex(fileId);
        if (fileIndex < 0) return;
        this.markFileChanged(fileIndex);
    }

    public computeGitChanges(): DiffModel {
        this.ensureIndex();
        const allHunks: DiffHunk[] = [];
        let totalAdded = 0;
        let totalRemoved = 0;
        let nextHunkId = 1;

        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const entry = this.entries[fileIndex];
            const { diffs, added, removed } = this.getCachedFileDiff(fileIndex);
            totalAdded += added;
            totalRemoved += removed;

            const bodyStartRow = this.getBodyStart(fileIndex, false);
            const originalBodyStart = this.getBodyStart(fileIndex, true);
            if (bodyStartRow < 0 || this.collapsedFiles.has(entry.id)) continue;
            const currentBodyStart = bodyStartRow + 1;

            for (const hunk of diffs.getHunks()) {
                const remappedOldLineNumbers = hunk.oldLineNumbers?.map((n) => originalBodyStart + n - 1);
                const remappedGhostAnchorLine = hunk.ghostAnchorLine !== undefined
                    ? currentBodyStart + hunk.ghostAnchorLine - 1
                    : undefined;

                allHunks.push({
                    hunkId: nextHunkId++,
                    startLine: currentBodyStart + hunk.startLine - 1,
                    lineCount: hunk.lineCount,
                    changeType: hunk.changeType,
                    oldLineNumbers: remappedOldLineNumbers,
                    ghostAnchorLine: remappedGhostAnchorLine,
                });
            }
        }

        return new DiffModel(allHunks, totalAdded, totalRemoved);
    }

    public getMultibufferDiffs(): DiffModel {
        return this.computeGitChanges();
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
                const count = isDiffEntry(entry) ? entry.diffCode.linesLength() : entry.code.linesLength();
                rowIndex += Math.max(1, count);
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
        const entry = this.entries[row.fileIndex];
        if (!entry) return [{ name: null, text: row.text }];
        if (isDiffEntry(entry)) {
            return entry.diffCode.getLineNodes(row.localLine) ?? [{ name: null, text: row.text }];
        }
        return entry.code.getLineNodes(row.localLine) ?? [{ name: null, text: EMPTY_LINE }];
    }

    public override getLineBinaryTokens(line: number): Uint32Array {
        this.ensureIndex();
        const row = this.rows[line];
        if (!row) return new Uint32Array(0);
        if (row.kind === 'header') {
            const nodes = this.getLineNodes(line);
            return BinaryTokens.encode(nodes);
        }
        const entry = this.entries[row.fileIndex];
        if (!entry) return BinaryTokens.encode([{ name: null, text: row.text }]);
        if (isDiffEntry(entry)) {
            const nodes = entry.diffCode.getLineNodes(row.localLine) ?? [{ name: null, text: row.text }];
            return BinaryTokens.encode(nodes);
        }
        return entry.code.getLineBinaryTokens(row.localLine) ?? new Uint32Array(0);
    }

    public getFoldRanges(): FoldRange[] {
        this.ensureIndex();
        const ranges: FoldRange[] = [];
        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const entry = this.entries[fileIndex];
            if (isDiffEntry(entry)) continue;
            const firstBodyRow = this.bodyStartIndices[fileIndex] ?? -1;
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
        if (!entry || isDiffEntry(entry)) return null;
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

    public override getIndent(): Lang['indent'] | null {
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
        const entry = this.entries[fileIndex];
        if (!entry) return;
        this.onFileChangeCallback?.({ fileId: entry.id, change: { edits: [localEdit] } });
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
        this.linesCache.clear();
        this.rows = [];
        this.bodyStartIndices = new Array(this.entries.length);
        this.originalBodyStarts = new Array(this.entries.length);
        let offset = 0;
        let originalRunningOffset = 0;

        for (let fileIndex = 0; fileIndex < this.entries.length; fileIndex++) {
            const entry = this.entries[fileIndex];
            const { added, removed } = this.getCachedFileDiff(fileIndex);
            const stats = formatFileStats(added, removed);
            const indicator = this.collapsedFiles.has(entry.id) ? '▸' : '▾';
            const header = `${indicator} ${getFileName(entry.path)}${stats.added}${stats.removed}`;
            this.rows.push({ kind: 'header', fileIndex, localLine: -1, localStart: 0, text: header, start: offset });
            offset += header.length + 1;

            this.bodyStartIndices[fileIndex] = this.rows.length;
            this.originalBodyStarts[fileIndex] = originalRunningOffset;

            const lines = isDiffEntry(entry) ? entry.diffCode.getLines() : entry.code.getLines();
            const fileLines = lines.length > 0 ? lines : [''];
            const origLength = isDiffEntry(entry)
                ? (entry.originalDiffCode?.linesLength() ?? entry.diffCode.linesLength())
                : entry.originalCode.linesLength();
            originalRunningOffset += 1 + Math.max(1, origLength);

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
        if (!entry) return { version: 0, diffs: DiffModel.empty(), added: 0, removed: 0 };
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
            return this.bodyStartIndices[fileIndex] ?? -1;
        }
        return (this.originalBodyStarts[fileIndex] ?? 0) + 2;
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