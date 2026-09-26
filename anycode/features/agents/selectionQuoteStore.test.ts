import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectionQuoteStore,
  formatPromptWithQuote,
  formatPromptWithQuotes,
  formatPromptBlocks,
  type SelectionQuote,
  type InputBlock,
} from './selectionQuoteStore';

describe('selectionQuoteStore', () => {
  beforeEach(() => {
    selectionQuoteStore.clear();
  });

  it('updates and clears the current selection quote', () => {
    expect(selectionQuoteStore.get()).toBeNull();

    const quote: SelectionQuote = {
      id: 'test-1',
      text: 'const x = 42;',
      source: 'editor',
      label: 'test.ts (L1-2)',
      filePath: 'src/test.ts',
      lineRange: [1, 2],
      language: 'typescript',
    };

    selectionQuoteStore.set(quote);
    expect(selectionQuoteStore.get()).toEqual(quote);

    selectionQuoteStore.clear();
    expect(selectionQuoteStore.get()).toBeNull();
  });

  it('notifies subscribers on change', () => {
    let callCount = 0;
    const unsubscribe = selectionQuoteStore.subscribe(() => {
      callCount += 1;
    });

    selectionQuoteStore.set({
      id: 'test-2',
      text: 'error in terminal',
      source: 'terminal',
      label: 'Terminal (zsh)',
    });

    expect(callCount).toBe(1);

    selectionQuoteStore.clear();
    expect(callCount).toBe(2);

    unsubscribe();
    selectionQuoteStore.set({
      id: 'test-3',
      text: 'hello',
      source: 'agent',
      label: 'Agent quote',
    });
    expect(callCount).toBe(2);
  });

  it('does not trigger subscribers when setting an identical quote', () => {
    let callCount = 0;
    selectionQuoteStore.subscribe(() => {
      callCount += 1;
    });

    const quote: SelectionQuote = {
      id: 'term-1',
      text: 'npm run build',
      source: 'terminal',
      label: 'Terminal: 1',
    };

    selectionQuoteStore.set(quote);
    expect(callCount).toBe(1);

    // Setting exact same object or matching fields
    selectionQuoteStore.set(quote);
    expect(callCount).toBe(1);

    selectionQuoteStore.set({
      id: 'term-1',
      text: 'npm run build',
      source: 'terminal',
      label: 'Terminal: 1',
    });
    expect(callCount).toBe(1);
  });

  it('does not trigger subscribers when calling clear on an already empty store', () => {
    let callCount = 0;
    selectionQuoteStore.subscribe(() => {
      callCount += 1;
    });

    selectionQuoteStore.clear();
    expect(callCount).toBe(0);
  });

  it('supports multiple independent subscribers and individual unsubscriptions', () => {
    let count1 = 0;
    let count2 = 0;

    const unsub1 = selectionQuoteStore.subscribe(() => {
      count1 += 1;
    });
    const unsub2 = selectionQuoteStore.subscribe(() => {
      count2 += 1;
    });

    selectionQuoteStore.set({
      id: 'term-2',
      text: 'git status',
      source: 'terminal',
      label: 'Terminal: 2',
    });

    expect(count1).toBe(1);
    expect(count2).toBe(1);

    unsub1();

    selectionQuoteStore.set({
      id: 'term-2',
      text: 'git diff',
      source: 'terminal',
      label: 'Terminal: 2',
    });

    expect(count1).toBe(1);
    expect(count2).toBe(2);

    unsub2();
  });

  it('triggers subscribers when quote text changes for the same id', () => {
    let callCount = 0;
    selectionQuoteStore.subscribe(() => {
      callCount += 1;
    });

    selectionQuoteStore.set({
      id: 'term-1',
      text: 'line 1',
      source: 'terminal',
      label: 'Terminal: 1',
    });
    expect(callCount).toBe(1);

    // User expanded selection
    selectionQuoteStore.set({
      id: 'term-1',
      text: 'line 1\nline 2',
      source: 'terminal',
      label: 'Terminal: 1',
    });
    expect(callCount).toBe(2);
    expect(selectionQuoteStore.get()?.text).toBe('line 1\nline 2');
  });
});

describe('formatPromptWithQuote', () => {
  it('formats editor code selection with markdown and language fence', () => {
    const quote: SelectionQuote = {
      id: 'editor-1',
      text: 'function test() {\n  return 1;\n}',
      source: 'editor',
      label: 'math.ts (L10-12)',
      filePath: 'src/math.ts',
      lineRange: [10, 12],
      language: 'ts',
    };

    const result = formatPromptWithQuote('Optimize this', quote);
    expect(result).toBe(
      '[math.ts:10-12](src/math.ts#L10-L12)\n```ts\nfunction test() {\n  return 1;\n}\n```\n\nOptimize this',
    );
  });

  it('formats editor quote with code fence even if filePath is missing', () => {
    const quote: SelectionQuote = {
      id: 'editor-2',
      text: 'const a = 1;',
      source: 'editor',
      label: 'StickyHeaderRenderer.ts (L5-6)',
      language: 'typescript',
    };

    const result = formatPromptWithQuote('what is this', quote);
    expect(result).toBe(
      'StickyHeaderRenderer.ts (L5-6):\n```typescript\nconst a = 1;\n```\n\nwhat is this',
    );
  });

  it('infers language from filePath if language is not provided', () => {
    const quote: SelectionQuote = {
      id: 'editor-3',
      text: 'def greet():\n    pass',
      source: 'editor',
      label: 'main.py (L1)',
      filePath: 'src/main.py',
      lineRange: [1, 1],
    };

    const result = formatPromptWithQuote('check python', quote);
    expect(result).toBe(
      '[main.py:1](src/main.py#L1)\n```python\ndef greet():\n    pass\n```\n\ncheck python',
    );
  });

  it('formats terminal output selection', () => {
    const quote: SelectionQuote = {
      id: 'term-1',
      text: 'cargo test failed with code 1',
      source: 'terminal',
      label: 'Terminal (zsh)',
    };

    const result = formatPromptWithQuote('Why did this fail?', quote);
    expect(result).toBe(
      'Terminal output (Terminal (zsh)):\n```sh\ncargo test failed with code 1\n```\n\nWhy did this fail?',
    );
  });

  it('formats chat message quote as markdown blockquote', () => {
    const quote: SelectionQuote = {
      id: 'agent-1',
      text: 'First line\nSecond line',
      source: 'agent',
      label: 'Quote from Claude',
    };

    const result = formatPromptWithQuote('Explain please', quote);
    expect(result).toBe('> First line\n> Second line\n\nExplain please');
  });

  it('returns raw prompt when no quote is provided', () => {
    expect(formatPromptWithQuote('Just a question', null)).toBe('Just a question');
  });

  it('returns formatted quote only when prompt is empty', () => {
    const quote: SelectionQuote = {
      id: 'agent-1',
      text: 'Hello world',
      source: 'agent',
      label: 'Quote from Claude',
    };

    expect(formatPromptWithQuote('', quote)).toBe('> Hello world');
  });

  it('formats multiple quotes sequentially with prompt', () => {
    const q1: SelectionQuote = {
      id: 'term-1',
      text: 'sleep 10',
      source: 'terminal',
      label: 'Terminal: 1',
    };
    const q2: SelectionQuote = {
      id: 'editor-1',
      text: 'console.log("hello");',
      source: 'editor',
      label: 'index.ts (line 5)',
      filePath: 'src/index.ts',
      lineRange: [5, 5],
      language: 'ts',
    };

    const result = formatPromptWithQuotes('How do these relate?', [q1, q2]);
    expect(result).toBe(
      'Terminal output (Terminal: 1):\n```sh\nsleep 10\n```\n\n[index.ts:5](src/index.ts#L5)\n```ts\nconsole.log("hello");\n```\n\nHow do these relate?',
    );
  });

  it('formats each quote with its own comment directly following the code block', () => {
    const q1: SelectionQuote = {
      id: 'editor-1',
      text: 'private element: HTMLDivElement;',
      source: 'editor',
      label: 'StickyHeaderRenderer.ts (L13-19)',
      filePath: 'src/renderer/StickyHeaderRenderer.ts',
      lineRange: [13, 19],
      language: 'typescript',
      comment: 'why is this private?',
    };
    const q2: SelectionQuote = {
      id: 'editor-2',
      text: 'wrapper: HTMLDivElement | undefined;',
      source: 'editor',
      label: 'StickyHeaderRenderer.ts (L26-28)',
      filePath: 'src/renderer/StickyHeaderRenderer.ts',
      lineRange: [26, 28],
      language: 'typescript',
      comment: 'why is this undefined here?',
    };

    const result = formatPromptWithQuotes('', [q1, q2]);
    expect(result).toBe(
      '[StickyHeaderRenderer.ts:13-19](src/renderer/StickyHeaderRenderer.ts#L13-L19)\n```typescript\nprivate element: HTMLDivElement;\n```\n\nwhy is this private?\n\n[StickyHeaderRenderer.ts:26-28](src/renderer/StickyHeaderRenderer.ts#L26-L28)\n```typescript\nwrapper: HTMLDivElement | undefined;\n```\n\nwhy is this undefined here?',
    );
  });

  it('formats introText, quotes with comments, and bottom prompt seamlessly', () => {
    const q1: SelectionQuote = {
      id: 'editor-1',
      text: 'const x = 1;',
      source: 'editor',
      label: 'a.ts (line 1)',
      filePath: 'a.ts',
      lineRange: [1, 1],
      language: 'ts',
      comment: 'first snippet note',
    };
    const q2: SelectionQuote = {
      id: 'editor-2',
      text: 'const y = 2;',
      source: 'editor',
      label: 'b.ts (line 2)',
      filePath: 'b.ts',
      lineRange: [2, 2],
      language: 'ts',
      comment: 'second snippet note',
    };

    const result = formatPromptWithQuotes(
      'How to combine these?',
      [q1, q2],
      'Look at these two snippets:',
    );
    expect(result).toBe(
      'Look at these two snippets:\n\n[a.ts:1](a.ts#L1)\n```ts\nconst x = 1;\n```\n\nfirst snippet note\n\n[b.ts:2](b.ts#L2)\n```ts\nconst y = 2;\n```\n\nsecond snippet note\n\nHow to combine these?',
    );
  });

  it('formats compact filename in brackets and full relative path with hash in parentheses', () => {
    const quote: SelectionQuote = {
      id: 'editor-sticky',
      text: 'private hide() {\n  this.element.style.display = "none";\n}',
      source: 'editor',
      label: 'StickyHeaderRenderer.ts (L94-105)',
      filePath: '/Users/max/dev/anycode/anycode-base/src/renderer/StickyHeaderRenderer.ts',
      displayPath: 'anycode-base/src/renderer/StickyHeaderRenderer.ts',
      lineRange: [94, 105],
      language: 'typescript',
    };

    const result = formatPromptWithQuote('Why is it hidden?', quote);
    expect(result).toBe(
      '[StickyHeaderRenderer.ts:94-105](anycode-base/src/renderer/StickyHeaderRenderer.ts#L94-L105)\n```typescript\nprivate hide() {\n  this.element.style.display = "none";\n}\n```\n\nWhy is it hidden?',
    );
  });

  it('normalizes CRLF and standalone CR line endings to standard LF', () => {
    const quote: SelectionQuote = {
      id: 'crlf-quote',
      text: 'line 1\r\nline 2\rline 3',
      source: 'editor',
      label: 'test.ts (L1-3)',
      filePath: 'test.ts',
      lineRange: [1, 3],
      language: 'ts',
    };

    const result = formatPromptWithQuote('Check newlines', quote);
    expect(result).toBe(
      '[test.ts:1-3](test.ts#L1-L3)\n```ts\nline 1\nline 2\nline 3\n```\n\nCheck newlines',
    );
  });

  it('trims extra surrounding whitespace from quote text', () => {
    const quote: SelectionQuote = {
      id: 'trimmed-quote',
      text: '   \n\nconst answer = 42;\n\n   ',
      source: 'editor',
      label: 'app.ts (L10)',
      filePath: 'app.ts',
      lineRange: [10, 10],
      language: 'ts',
    };

    const result = formatPromptWithQuote('What is the answer?', quote);
    expect(result).toBe(
      '[app.ts:10](app.ts#L10)\n```ts\nconst answer = 42;\n```\n\nWhat is the answer?',
    );
  });

  it('formats multi-line terminal command output cleanly', () => {
    const quote: SelectionQuote = {
      id: 'term-multi',
      text: 'total 68872\ndrwxr-xr-x  45 max  staff  1.4K Sep  1 19:00 .\n-rw-r--r--   1 max  staff  4.4K Aug 30 01:40 AGENTS.md',
      source: 'terminal',
      label: 'Terminal: 1',
    };

    const result = formatPromptWithQuote('Explain output', quote);
    expect(result).toBe(
      'Terminal output (Terminal: 1):\n```sh\ntotal 68872\ndrwxr-xr-x  45 max  staff  1.4K Sep  1 19:00 .\n-rw-r--r--   1 max  staff  4.4K Aug 30 01:40 AGENTS.md\n```\n\nExplain output',
    );
  });
});

describe('formatPromptBlocks', () => {
  it('formats interleaved text and quote blocks in exact chronological order', () => {
    const q1: SelectionQuote = {
      id: 'editor-1',
      text: 'const x = 1;',
      source: 'editor',
      label: 'a.ts (line 1)',
      filePath: 'a.ts',
      lineRange: [1, 1],
      language: 'ts',
    };
    const q2: SelectionQuote = {
      id: 'editor-2',
      text: 'const y = 2;',
      source: 'editor',
      label: 'b.ts (line 2)',
      filePath: 'b.ts',
      lineRange: [2, 2],
      language: 'ts',
    };

    const blocks: InputBlock[] = [
      { id: '1', type: 'text', text: 'Check this method:' },
      { id: '2', type: 'quote', quote: q1 },
      { id: '3', type: 'text', text: 'And now this one:' },
      { id: '4', type: 'quote', quote: q2 },
      { id: '5', type: 'text', text: 'What is the difference?' },
    ];

    expect(formatPromptBlocks(blocks)).toBe(
      'Check this method:\n\n[a.ts:1](a.ts#L1)\n```ts\nconst x = 1;\n```\n\nAnd now this one:\n\n[b.ts:2](b.ts#L2)\n```ts\nconst y = 2;\n```\n\nWhat is the difference?',
    );
  });

  it('omits empty text blocks seamlessly', () => {
    const q1: SelectionQuote = {
      id: 'editor-1',
      text: 'const x = 1;',
      source: 'editor',
      label: 'a.ts (line 1)',
      filePath: 'a.ts',
      lineRange: [1, 1],
      language: 'ts',
    };

    const blocks: InputBlock[] = [
      { id: '1', type: 'text', text: '   ' },
      { id: '2', type: 'quote', quote: q1 },
      { id: '3', type: 'text', text: 'Explain this code' },
    ];

    expect(formatPromptBlocks(blocks)).toBe(
      '[a.ts:1](a.ts#L1)\n```ts\nconst x = 1;\n```\n\nExplain this code',
    );
  });

  it('formats multibuffer quote for a single file with line range', () => {
    const quote: SelectionQuote = {
      id: 'editor:src/renderer/StickyHeaderRenderer.ts',
      text: 'private hide() {\n  this.element.style.display = "none";\n}',
      source: 'editor',
      label: 'StickyHeaderRenderer.ts (L94-105)',
      filePath: 'anycode-base/src/renderer/StickyHeaderRenderer.ts',
      displayPath: 'anycode-base/src/renderer/StickyHeaderRenderer.ts',
      lineRange: [94, 105],
      language: 'typescript',
    };

    const result = formatPromptWithQuote('Review this', quote);
    expect(result).toBe(
      '[StickyHeaderRenderer.ts:94-105](anycode-base/src/renderer/StickyHeaderRenderer.ts#L94-L105)\n```typescript\nprivate hide() {\n  this.element.style.display = "none";\n}\n```\n\nReview this',
    );
  });

  it('formats multibuffer cross-file selection quote without file link', () => {
    const quote: SelectionQuote = {
      id: 'editor:multibuffer',
      text: 'diff --git a/a.ts b/a.ts\n+const x = 1;',
      source: 'editor',
      label: 'multibuffer',
      language: 'diff',
    };

    const result = formatPromptWithQuote('Explain differences', quote);
    expect(result).toBe(
      'multibuffer:\n```diff\ndiff --git a/a.ts b/a.ts\n+const x = 1;\n```\n\nExplain differences',
    );
  });

  it('returns empty string when blocks array is empty', () => {
    expect(formatPromptBlocks([])).toBe('');
  });

  it('formats blocks containing only text blocks', () => {
    const blocks: InputBlock[] = [
      { id: '1', type: 'text', text: 'Hello' },
      { id: '2', type: 'text', text: 'World' },
    ];
    expect(formatPromptBlocks(blocks)).toBe('Hello\n\nWorld');
  });

  it('formats blocks containing only quote blocks', () => {
    const q1: SelectionQuote = {
      id: 'term-1',
      text: 'cargo test',
      source: 'terminal',
      label: 'Terminal: 1',
    };
    const q2: SelectionQuote = {
      id: 'agent-1',
      text: 'All passed',
      source: 'agent',
      label: 'Agent',
    };

    const blocks: InputBlock[] = [
      { id: '1', type: 'quote', quote: q1 },
      { id: '2', type: 'quote', quote: q2 },
    ];

    expect(formatPromptBlocks(blocks)).toBe(
      'Terminal output (Terminal: 1):\n```sh\ncargo test\n```\n\n> All passed',
    );
  });

  it('ignores quote blocks with empty or whitespace-only text', () => {
    const qValid: SelectionQuote = {
      id: 'q-valid',
      text: 'const valid = true;',
      source: 'editor',
      label: 'valid.ts',
      language: 'ts',
    };
    const qEmpty: SelectionQuote = {
      id: 'q-empty',
      text: '    ',
      source: 'editor',
      label: 'empty.ts',
      language: 'ts',
    };

    const blocks: InputBlock[] = [
      { id: '1', type: 'quote', quote: qEmpty },
      { id: '2', type: 'text', text: 'Explain valid:' },
      { id: '3', type: 'quote', quote: qValid },
    ];

    expect(formatPromptBlocks(blocks)).toBe(
      'Explain valid:\n\nvalid.ts:\n```ts\nconst valid = true;\n```',
    );
  });
});

