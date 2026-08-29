import { HighlighedNode, Position } from './code';
import { DiffModel } from './diff';
import { ParsedDiffFile } from './diffParser';
import { FastSyntaxHighlighter } from './fastSyntax';

export class DiffCode {
    public readonly path: string;
    public readonly filename: string;
    public readonly language: string;
    public readonly lines: string[];
    public readonly displayLineNumbers: (number | undefined)[];
    public readonly diffs: DiffModel;
    public readonly added: number;
    public readonly removed: number;
    public readonly status: 'modified' | 'added' | 'deleted' | 'renamed';
    public readonly oldPath?: string;

    private lineOffsets: number[] = [];
    private totalLength: number = 0;
    private contentCache: string | null = null;

    public readonly parsedFile?: ParsedDiffFile;

    constructor(
        fileOrPath: ParsedDiffFile | string,
        lines?: string[],
        displayLineNumbers: (number | undefined)[] = [],
        diffs: DiffModel = DiffModel.empty(),
        added: number = 0,
        removed: number = 0,
        status: 'modified' | 'added' | 'deleted' | 'renamed' = 'modified',
        oldPath?: string,
        parsedFile?: ParsedDiffFile
    ) {
        if (typeof fileOrPath === 'object') {
            this.parsedFile = fileOrPath;
            this.path = fileOrPath.path;
            this.filename = fileOrPath.path.split('/').pop() || fileOrPath.path;
            this.language = this.detectLanguage(fileOrPath.path);
            this.lines = fileOrPath.newLines;
            this.displayLineNumbers = fileOrPath.newLineNumbers;
            this.diffs = fileOrPath.diffs;
            this.added = fileOrPath.added;
            this.removed = fileOrPath.removed;
            this.status = fileOrPath.status;
            this.oldPath = fileOrPath.oldPath;
        } else {
            this.parsedFile = parsedFile;
            this.path = fileOrPath;
            this.filename = fileOrPath.split('/').pop() || fileOrPath;
            this.language = this.detectLanguage(fileOrPath);
            this.lines = lines ?? [];
            this.displayLineNumbers = displayLineNumbers;
            this.diffs = diffs;
            this.added = added;
            this.removed = removed;
            this.status = status;
            this.oldPath = oldPath;
        }

        this.computeOffsets();
    }

    public getOriginalDiffCode(): DiffCode {
        if (this.parsedFile) {
            return DiffCode.fromParsedFile(this.parsedFile, true);
        }
        return new DiffCode(
            this.oldPath || this.path,
            this.lines,
            this.displayLineNumbers,
            this.diffs,
            this.added,
            this.removed,
            this.status,
            this.oldPath
        );
    }

    public static fromParsedFile(file: ParsedDiffFile, isOriginal: boolean = false): DiffCode {
        const lines = isOriginal ? file.oldLines : file.newLines;
        const lineNumbers = isOriginal ? file.oldLineNumbers : file.newLineNumbers;
        return new DiffCode(
            file.path,
            lines,
            lineNumbers,
            file.diffs,
            file.added,
            file.removed,
            file.status,
            file.oldPath,
            file
        );
    }

    private detectLanguage(filePath: string): string {
        return FastSyntaxHighlighter.detectLanguage(filePath);
    }

    private computeOffsets(): void {
        this.lineOffsets = [];
        let currentOffset = 0;
        for (let i = 0; i < this.lines.length; i++) {
            this.lineOffsets.push(currentOffset);
            currentOffset += this.lines[i].length + 1; // +1 for newline
        }
        this.totalLength = Math.max(0, currentOffset > 0 ? currentOffset - 1 : 0);
    }

    public getContent(): string {
        if (this.contentCache === null) {
            this.contentCache = this.lines.join('\n');
        }
        return this.contentCache;
    }

    public getContentLength(): number {
        return this.totalLength;
    }

    public getLines(): string[] {
        return this.lines;
    }

    public line(index: number): string {
        return this.lines[index] ?? '';
    }

    public linesLength(): number {
        return this.lines.length;
    }

    public getPosition(offset: number): Position {
        if (this.lines.length === 0) return { line: 0, column: 0 };
        if (offset <= 0) return { line: 0, column: 0 };

        let low = 0;
        let high = this.lineOffsets.length - 1;
        let line = 0;

        while (low <= high) {
            const mid = (low + high) >> 1;
            if (this.lineOffsets[mid] <= offset) {
                line = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const lineStart = this.lineOffsets[line] ?? 0;
        const column = Math.max(0, offset - lineStart);
        return { line, column };
    }

    public getOffset(line: number, column: number): number {
        if (line < 0) return 0;
        if (line >= this.lines.length) return this.totalLength;
        const lineStart = this.lineOffsets[line] ?? 0;
        const lineLen = this.lines[line]?.length ?? 0;
        return lineStart + Math.min(Math.max(0, column), lineLen);
    }

    public getIntervalContent2(start: number, end: number): string {
        const content = this.getContent();
        return content.substring(Math.max(0, start), Math.min(content.length, end));
    }

    public getLineNodes(index: number): HighlighedNode[] {
        const text = this.lines[index];
        if (text === undefined) return [{ name: null, text: '' }];
        return FastSyntaxHighlighter.tokenize(text, this.language);
    }

    public getLineBinaryTokens(_index: number): Uint32Array | undefined {
        return undefined;
    }

    public getDiffs(): DiffModel {
        return this.diffs;
    }
}
