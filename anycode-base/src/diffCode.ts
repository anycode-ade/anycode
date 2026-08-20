import type { Position, HighlighedNode } from './code';
import type { DiffInfo } from './diff';
import type { ParsedDiffFile } from './diffParser';

/**
 * Lightweight per-file diff buffer.
 * Holds sliced diff lines for a single file parsed directly from raw git diff.
 * Does not instantiate Tree-Sitter WASM parsers, PieceTree, or undo history.
 */
export class DiffCode {
    public id: string;
    public path: string;
    public oldPath?: string;
    public status: 'modified' | 'added' | 'deleted' | 'renamed';
    public added: number;
    public removed: number;
    public filename: string;
    public language: string;

    private lines: string[] = [];
    private diffs: Map<number, DiffInfo> = new Map();
    private displayLineNumbers: (number | undefined)[] = [];
    private lineOffsets: number[] = [];
    private contentLength = 0;
    private originalDiffCode: DiffCode | null = null;

    constructor(parsed: Partial<ParsedDiffFile> & { path: string }, language = '', isOriginal = false) {
        this.id = parsed.id ?? parsed.path;
        this.path = parsed.path;
        this.oldPath = parsed.oldPath;
        this.status = parsed.status ?? 'modified';
        this.added = parsed.added ?? 0;
        this.removed = parsed.removed ?? 0;
        this.filename = parsed.path;
        this.language = language;

        if (parsed.newLines !== undefined || parsed.oldLines !== undefined) {
            this.setParsed(parsed as ParsedDiffFile, isOriginal);
        }
    }

    public setParsed(parsed: ParsedDiffFile, isOriginal = false): void {
        this.status = parsed.status;
        this.added = parsed.added;
        this.removed = parsed.removed;
        this.oldPath = parsed.oldPath;

        if (isOriginal) {
            this.lines = parsed.oldLines ?? [];
            this.displayLineNumbers = parsed.oldLineNumbers ?? [];
            this.diffs = new Map();
        } else {
            this.lines = parsed.newLines ?? [];
            this.displayLineNumbers = parsed.newLineNumbers ?? [];
            this.diffs = new Map(parsed.diffs ?? []);

            // Create matching original DiffCode with oldLines
            const orig = new DiffCode(parsed, this.language, true);
            this.originalDiffCode = orig;
        }

        this.computeOffsets();
    }

    public getOriginalDiffCode(): DiffCode {
        if (!this.originalDiffCode) {
            this.originalDiffCode = new DiffCode({
                id: this.id,
                path: this.path,
                oldPath: this.oldPath,
                status: this.status,
                added: this.added,
                removed: this.removed,
                oldLines: [],
                oldLineNumbers: [],
            }, this.language, true);
        }
        return this.originalDiffCode;
    }

    private computeOffsets(): void {
        this.lineOffsets = [];
        let offset = 0;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            this.lineOffsets.push(offset);
            offset += line.length + 1; // +1 for newline
        }

        this.contentLength = Math.max(0, offset > 0 ? offset - 1 : 0);
    }

    public linesLength(): number {
        return this.lines.length;
    }

    public line(index: number): string {
        return this.lines[index] ?? '';
    }

    public lineLength(index: number): number {
        return this.lines[index]?.length ?? 0;
    }

    public getLines(): string[] {
        return this.lines;
    }

    public getDiffs(): Map<number, DiffInfo> {
        return this.diffs;
    }

    public getDisplayLineNumber(index: number): number | undefined {
        return this.displayLineNumbers[index];
    }

    public getContentLength(): number {
        return this.contentLength;
    }

    public getPosition(offset: number): Position {
        if (this.lines.length === 0) {
            return { line: 0, column: 0 };
        }

        let low = 0;
        let high = this.lineOffsets.length - 1;
        let line = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (this.lineOffsets[mid] <= offset) {
                line = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const lineStartOffset = this.lineOffsets[line] ?? 0;
        const column = Math.max(0, offset - lineStartOffset);
        return { line, column };
    }

    public getOffset(line: number, column: number): number {
        if (this.lines.length === 0) return 0;
        const clampedLine = Math.max(0, Math.min(line, this.lines.length - 1));
        const lineOffset = this.lineOffsets[clampedLine] ?? 0;
        const lineLen = this.lines[clampedLine]?.length ?? 0;
        const clampedColumn = Math.max(0, Math.min(column, lineLen));
        return lineOffset + clampedColumn;
    }

    public highlightLine(line: number): HighlighedNode[] {
        const text = this.line(line);
        return [{ name: '', text }];
    }

    public getLineNodes(line: number): HighlighedNode[] {
        return this.highlightLine(line);
    }

    public getContent(): string {
        return this.lines.join('\n');
    }
}
