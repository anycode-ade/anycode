import { useSyncExternalStore } from 'react';
import { getLanguageFromFileName, toRelativeDisplayPath, getFileName } from '../../utils';

export type QuoteSource = 'editor' | 'terminal' | 'agent';

export interface SelectionQuote {
  id: string;
  text: string;
  source: QuoteSource;
  label: string;
  filePath?: string;
  displayPath?: string;
  lineRange?: [number, number];
  language?: string;
  comment?: string;
}

let currentQuote: SelectionQuote | null = null;
const listeners = new Set<() => void>();

export const selectionQuoteStore = {
  get: (): SelectionQuote | null => currentQuote,

  set: (quote: SelectionQuote | null): void => {
    if (currentQuote === quote) return;
    if (
      currentQuote &&
      quote &&
      currentQuote.text === quote.text &&
      currentQuote.label === quote.label &&
      currentQuote.filePath === quote.filePath &&
      currentQuote.displayPath === quote.displayPath
    ) {
      return;
    }
    currentQuote = quote;
    listeners.forEach((listener) => listener());
  },

  clear: (): void => {
    if (currentQuote === null) return;
    currentQuote = null;
    listeners.forEach((listener) => listener());
  },

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useSelectionQuote = (): SelectionQuote | null => {
  return useSyncExternalStore(
    selectionQuoteStore.subscribe,
    selectionQuoteStore.get,
    selectionQuoteStore.get,
  );
};

export type InputBlock =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'quote'; quote: SelectionQuote };

export const formatSingleQuote = (quote: SelectionQuote): string => {
  const rawText = quote.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (quote.source === 'editor') {
    const lang =
      quote.language ||
      (quote.filePath ? getLanguageFromFileName(quote.filePath) : '') ||
      '';
    const lines = quote.lineRange
      ? quote.lineRange[0] === quote.lineRange[1]
        ? ` (line ${quote.lineRange[0]})`
        : ` (lines ${quote.lineRange[0]}–${quote.lineRange[1]})`
      : '';
    let header = '';
    if (quote.filePath) {
      const fileName = getFileName(quote.filePath);
      const targetPath = quote.displayPath || toRelativeDisplayPath(quote.filePath);
      const linesSuffix = quote.lineRange
        ? quote.lineRange[0] === quote.lineRange[1]
          ? `:${quote.lineRange[0]}`
          : `:${quote.lineRange[0]}-${quote.lineRange[1]}`
        : '';
      const linesHash = quote.lineRange
        ? quote.lineRange[0] === quote.lineRange[1]
          ? `#L${quote.lineRange[0]}`
          : `#L${quote.lineRange[0]}-L${quote.lineRange[1]}`
        : '';
      header = `[${fileName}${linesSuffix}](${targetPath}${linesHash})\n`;
    } else if (quote.label) {
      const lines = quote.lineRange
        ? quote.lineRange[0] === quote.lineRange[1]
          ? ` (line ${quote.lineRange[0]})`
          : ` (lines ${quote.lineRange[0]}–${quote.lineRange[1]})`
        : '';
      const labelHasLines = /\(L\d+|\(line/i.test(quote.label);
      header = labelHasLines ? `${quote.label}:\n` : `${quote.label}${lines}:\n`;
    }
    return `${header}\`\`\`${lang}\n${rawText}\n\`\`\``;
  } else if (quote.source === 'terminal') {
    return `Terminal output (${quote.label}):\n\`\`\`sh\n${rawText}\n\`\`\``;
  } else {
    return rawText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  }
};

export const formatPromptBlocks = (blocks: InputBlock[]): string => {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      const trimmed = block.text.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
    } else if (block.type === 'quote' && block.quote && block.quote.text.trim()) {
      parts.push(formatSingleQuote(block.quote));
    }
  }
  return parts.join('\n\n');
};

export const formatPromptWithQuotes = (
  promptText: string,
  quotes: SelectionQuote[],
  introText?: string,
): string => {
  const validQuotes = quotes.filter((q) => q && q.text.trim());
  const trimmedPrompt = promptText.trim();
  const trimmedIntro = (introText || '').trim();

  if (validQuotes.length === 0) {
    if (trimmedIntro && trimmedPrompt) {
      return `${trimmedIntro}\n\n${trimmedPrompt}`;
    }
    return trimmedIntro || trimmedPrompt;
  }

  const quoteBlocks = validQuotes.map((quote) => {
    const codeBlock = formatSingleQuote(quote);
    const trimmedComment = (quote.comment || '').trim();
    if (trimmedComment) {
      return `${codeBlock}\n\n${trimmedComment}`;
    }
    return codeBlock;
  });

  const combinedQuotes = quoteBlocks.join('\n\n');
  const parts: string[] = [];
  if (trimmedIntro) {
    parts.push(trimmedIntro);
  }
  parts.push(combinedQuotes);
  if (trimmedPrompt) {
    parts.push(trimmedPrompt);
  }
  return parts.join('\n\n');
};

export const formatPromptWithQuote = (
  promptText: string,
  quote: SelectionQuote | null,
): string => {
  return formatPromptWithQuotes(promptText, quote ? [quote] : []);
};
