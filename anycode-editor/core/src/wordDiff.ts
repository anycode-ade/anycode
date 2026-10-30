import { diffArrays, diffChars } from 'diff';

export interface TextRange {
    start: number;
    end: number;
}

/** Changed spans on both sides of a single-line replacement; each side is set only when non-empty. */
export interface WordDiffRanges {
    oldRanges?: TextRange[];
    newRanges?: TextRange[];
}

/** Compares rendered ranges with expected ones without allocating; same reference is the common case. */
export function sameTextRanges(
    a: readonly TextRange[] | undefined,
    b: readonly TextRange[] | undefined,
): boolean {
    if (a === b) return true;
    const aLength = a?.length ?? 0;
    if (aLength !== (b?.length ?? 0)) return false;
    for (let i = 0; i < aLength; i++) {
        if (a![i].start !== b![i].start || a![i].end !== b![i].end) return false;
    }
    return true;
}

function toWordDiffRanges(oldRanges: TextRange[], newRanges: TextRange[]): WordDiffRanges | undefined {
    if (oldRanges.length === 0 && newRanges.length === 0) return undefined;
    return {
        oldRanges: oldRanges.length > 0 ? oldRanges : undefined,
        newRanges: newRanges.length > 0 ? newRanges : undefined,
    };
}

interface WordToken {
    text: string;
    start: number;
    end: number;
}

const MAX_WORD_DIFF_LENGTH = 512;
const MAX_WORD_DIFF_TOKENS = 200;
const MAX_DIFF_TOKEN_PAIRS_PER_PAIR = 5_000;
const MIN_MATCH_RATIO = 0.6;
const WHITESPACE_ONLY_PATTERN = /^\p{White_Space}*$/u;
const WHITESPACE_CHARACTER_PATTERN = /\p{White_Space}/u;
// Unicode letters, combining marks, numbers, and underscore form word tokens.
const WORD_CHARACTER_PATTERN = /[\p{L}\p{M}\p{N}_]/u;

function diffWhitespaceLines(oldText: string, newText: string): WordDiffRanges | undefined {
    const oldRanges: TextRange[] = [];
    const newRanges: TextRange[] = [];
    let oldOffset = 0;
    let newOffset = 0;
    for (const change of diffChars(oldText, newText)) {
        const length = change.value.length;
        if (change.added) {
            newRanges.push({ start: newOffset, end: newOffset + length });
            newOffset += length;
        } else if (change.removed) {
            oldRanges.push({ start: oldOffset, end: oldOffset + length });
            oldOffset += length;
        } else {
            oldOffset += length;
            newOffset += length;
        }
    }
    return toWordDiffRanges(oldRanges, newRanges);
}

/** Keep UTF-16 offsets so changed tokens map directly to string and DOM ranges. */
function tokenize(text: string): WordToken[] | undefined {
    const tokens: WordToken[] = [];
    let offset = 0;
    let currentKind: 'whitespace' | 'word' | 'punctuation' | null = null;
    let currentStart = 0;
    let currentText = '';

    const flush = () => {
        if (currentKind !== null) {
            tokens.push({ text: currentText, start: currentStart, end: offset });
            currentKind = null;
            currentText = '';
        }
    };

    for (const character of text) {
        let kind: 'whitespace' | 'word' | 'punctuation';
        if (WHITESPACE_CHARACTER_PATTERN.test(character)) {
            kind = 'whitespace';
        } else if (WORD_CHARACTER_PATTERN.test(character)) {
            kind = 'word';
        } else {
            kind = 'punctuation';
        }

        if (kind !== currentKind || kind === 'punctuation') {
            flush();
            if (tokens.length > MAX_WORD_DIFF_TOKENS) return undefined;
            currentKind = kind;
            currentStart = offset;
        }

        currentText += character;
        offset += character.length;
    }

    flush();
    return tokens.length <= MAX_WORD_DIFF_TOKENS ? tokens : undefined;
}

function appendChangedTokenRange(tokens: readonly WordToken[], ranges: TextRange[]): void {
    if (tokens.length === 0) return;
    ranges.push({
        start: tokens[0].start,
        end: tokens[tokens.length - 1].end,
    });
}

/**
 * Word diff for one 1->1 line replacement, computed on first access and then cached.
 * Copies of a hunk share the instance, so they share the cached result.
 */
export class LineWordDiff {
    // undefined = not computed yet, null = computed with no ranges.
    private ranges: WordDiffRanges | null | undefined;

    private constructor(
        private readonly oldText: string,
        private readonly newText: string,
    ) {}

    /** Returns undefined when the pair can never produce ranges, so nothing is retained for it. */
    static create(oldText: string, newText: string): LineWordDiff | undefined {
        if (oldText === newText) return undefined;
        if (oldText.length > MAX_WORD_DIFF_LENGTH || newText.length > MAX_WORD_DIFF_LENGTH) {
            return undefined;
        }
        return new LineWordDiff(oldText, newText);
    }

    get oldRanges(): TextRange[] | undefined {
        return this.compute()?.oldRanges;
    }

    get newRanges(): TextRange[] | undefined {
        return this.compute()?.newRanges;
    }

    private compute(): WordDiffRanges | undefined {
        if (this.ranges === undefined) {
            this.ranges = computeWordDiffRanges(this.oldText, this.newText) ?? null;
        }
        return this.ranges ?? undefined;
    }
}

/**
 * Computes changed spans on both sides of a single-line replacement. Ranges use
 * UTF-16 offsets so they can be applied directly to JavaScript strings and DOM text.
 */
export function computeWordDiffRanges(oldText: string, newText: string): WordDiffRanges | undefined {
    if (oldText === newText) return undefined;
    if (oldText.length > MAX_WORD_DIFF_LENGTH || newText.length > MAX_WORD_DIFF_LENGTH) {
        return undefined;
    }

    if (WHITESPACE_ONLY_PATTERN.test(oldText) && WHITESPACE_ONLY_PATTERN.test(newText)) {
        return diffWhitespaceLines(oldText, newText);
    }

    const oldTokens = tokenize(oldText);
    if (!oldTokens?.length) return undefined;
    const newTokens = tokenize(newText);
    if (!newTokens?.length) return undefined;

    const totalTokens = oldTokens.length + newTokens.length;
    if (Math.min(oldTokens.length, newTokens.length) * 2 < totalTokens * MIN_MATCH_RATIO) {
        return undefined;
    }

    let commonPrefix = 0;
    while (
        commonPrefix < oldTokens.length &&
        commonPrefix < newTokens.length &&
        oldTokens[commonPrefix].text === newTokens[commonPrefix].text
    ) {
        commonPrefix++;
    }

    let commonSuffix = 0;
    while (
        commonSuffix < oldTokens.length - commonPrefix &&
        commonSuffix < newTokens.length - commonPrefix &&
        oldTokens[oldTokens.length - 1 - commonSuffix].text ===
            newTokens[newTokens.length - 1 - commonSuffix].text
    ) {
        commonSuffix++;
    }

    const oldMiddleEnd = oldTokens.length - commonSuffix;
    const newMiddleEnd = newTokens.length - commonSuffix;
    const oldMiddleLength = oldMiddleEnd - commonPrefix;
    const newMiddleLength = newMiddleEnd - commonPrefix;
    if (oldMiddleLength * newMiddleLength > MAX_DIFF_TOKEN_PAIRS_PER_PAIR) {
        return undefined;
    }

    // Use jsdiff's Myers diff while retaining our tokens' original UTF-16 offsets.
    const changes = diffArrays(
        oldTokens.slice(commonPrefix, oldMiddleEnd),
        newTokens.slice(commonPrefix, newMiddleEnd),
        {
            comparator: (oldToken, newToken) => oldToken.text === newToken.text,
        },
    );
    let matchedTokenCount = commonPrefix + commonSuffix;
    for (const change of changes) {
        if (!change.added && !change.removed) {
            matchedTokenCount += change.value.length;
        }
    }
    if (matchedTokenCount * 2 < totalTokens * MIN_MATCH_RATIO) return undefined;

    const oldRanges: TextRange[] = [];
    const newRanges: TextRange[] = [];
    for (const change of changes) {
        if (change.added) {
            appendChangedTokenRange(change.value, newRanges);
        } else if (change.removed) {
            appendChangedTokenRange(change.value, oldRanges);
        }
    }

    return toWordDiffRanges(oldRanges, newRanges);
}
