import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { diffLines } from 'diff';
import { AnycodeEditorReact, AnycodeEditor } from 'anycode-react';
import {
  AcpMessage as AcpMessageType,
  AcpDiffContent,
  AcpToolCallMessage,
  AcpToolResultMessage,
  AcpToolUpdateMessage,
  AcpUserMessage,
  AcpAssistantMessage,
  AcpThoughtMessage,
  AcpPermissionRequestMessage,
  AcpErrorMessage,
} from '../../types';
import './AcpMessage.css';

const SUPPORTED_LANGUAGES: Record<string, string> = {
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  rust: 'rust',
  rs: 'rust',
  python: 'python',
  py: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  toml: 'toml',
  html: 'html',
  css: 'css',
  go: 'go',
  golang: 'go',
  java: 'java',
  kotlin: 'kotlin',
  lua: 'lua',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  zig: 'zig',
  csharp: 'csharp',
  cs: 'csharp',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'c',
  md: 'text',
  markdown: 'text',
  diff: 'text',
  text: 'text',
  plain: 'text',
};

const EDITOR_SUPPORTED_LANGUAGES = new Set([
  'javascript', 'typescript', 'rust',
  'python', 'yaml', 'json', 'toml', 'html',
  'css', 'go', 'java', 'kotlin', 'lua', 'bash',
  'zig', 'csharp', 'c', 'cpp',
]);

let codeBlockIdCounter = 0;

interface AcpMessageProps {
  message: AcpMessageType;
  toolResult?: AcpToolResultMessage;
  toolUpdates?: AcpToolUpdateMessage[];
  isExpanded?: boolean;
  onToggle?: () => void;
  onPermissionResponse?: (permissionId: string, optionId: string) => void;
  onUndo?: () => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}

const ToolCallMessage: React.FC<{
  message: AcpToolCallMessage;
  toolResult?: AcpToolResultMessage;
  toolUpdates?: AcpToolUpdateMessage[];
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({ message, toolResult, toolUpdates, isExpanded, onToggle, onOpenFileDiff }) => {

  const displayCommand = message.command?.trim() || message.name;
  const toolCallView = React.useMemo(
    () => getToolCallView(message, toolUpdates, toolResult),
    [message, toolResult, toolUpdates],
  );
  const diffFileNames = getToolCallFileNames(toolCallView.diffs);
  const toggleLabel = formatToolCallLabel(diffFileNames, displayCommand);
  const toggleStats = getToolCallStats(toolCallView.diffs);

  return (
    <div className="acp-message acp-message-tool_call">
      <div className="acp-message-content">
        <div className="acp-tool-call-toggle" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
          <div className="acp-tool-call-toggle-main">
            <div className="acp-tool-call-toggle-title">
              {toggleStats && (
                <span className="acp-tool-call-kind-badge">Edit</span>
              )}
              <div className="acp-tool-call-name">{toggleLabel}</div>
            </div>
            {toggleStats && (
              <div className="acp-tool-call-toggle-stats">
                <span className="acp-tool-call-diff-added">+{toggleStats.added}</span>
                <span className="acp-tool-call-diff-deleted">-{toggleStats.deleted}</span>
              </div>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="acp-tool-call-expanded">
            {message.command && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Command:</div>
                <pre className="acp-tool-call-command">{message.command}</pre>
              </div>
            )}

            {toolUpdates && toolUpdates.length > 0 && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Updates:</div>
                {toolUpdates.map((toolUpdate, index) => (
                  <pre key={`${toolUpdate.id}-${index}`} className="acp-tool-result-content">
                    {JSON.stringify(toolUpdate.update, null, 2)}
                  </pre>
                ))}
              </div>
            )}
            {toolCallView.kind === 'edit' && toolCallView.diffs.length > 0 && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Diff:</div>
                <div className="acp-tool-call-diffs">
                  {toolCallView.diffs.map((diffEntry, index) => (
                    <div key={`${diffEntry.path}-${index}`} className="acp-tool-call-diff">
                      <button
                        type="button"
                        className="acp-tool-call-diff-link"
                        onClick={() => onOpenFileDiff?.(diffEntry.path)}
                        title={`Open ${diffEntry.path} in diff mode`}
                      >
                        {getFileNameFromPath(diffEntry.path)}
                      </button>
                      <DiffCodeBlock diff={diffEntry} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {toolResult && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Result:</div>
                <ToolResultDetails result={toolResult.result} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ToolResultMessage: React.FC<{
  message: AcpToolResultMessage;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, isExpanded, onToggle }) => (
  <div className="acp-message acp-message-tool_result">
    <div className="acp-message-content">
      <div className="acp-tool-result-indicator" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
        Tool result:
      </div>
      {isExpanded && (
        <ToolResultDetails result={message.result} />
      )}
    </div>
  </div>
);

type ToolResultDetailsView = {
  title?: string;
  status?: string;
  command?: string;
  description?: string;
  contentText?: string;
  output?: string;
  errorOutput?: string;
};

const extractToolResultDetails = (result: unknown): ToolResultDetailsView | null => {
  const resultRecord = asRecord(result);
  if (!resultRecord) {
    return null;
  }

  const fields = asRecord(resultRecord.fields);
  const title = getMaybeString(resultRecord.title) ?? getMaybeString(fields?.title);
  const status = getMaybeString(resultRecord.status) ?? getMaybeString(fields?.status);
  const rawInput = asRecord(
    getField(resultRecord, 'rawInput')
      ?? getField(resultRecord, 'raw_input')
      ?? getField(fields, 'rawInput')
      ?? getField(fields, 'raw_input'),
  );
  const rawOutput = getField(resultRecord, 'rawOutput')
    ?? getField(resultRecord, 'raw_output')
    ?? getField(fields, 'rawOutput')
    ?? getField(fields, 'raw_output');
  const rawOutputRecord = asRecord(rawOutput);
  const metadata = asRecord(rawOutputRecord?.metadata);
  const command =
    getMaybeString(rawInput?.cmd) ??
    getMaybeString(rawInput?.command) ??
    (Array.isArray(rawOutputRecord?.command)
      ? rawOutputRecord.command.join(' ')
      : getMaybeString(rawOutputRecord?.command));
  const description =
    getMaybeString(rawInput?.description) ??
    getMaybeString(metadata?.description);
  const output =
    getMaybeString(rawOutput) ??
    getMaybeString(rawOutputRecord?.formatted_output) ??
    getMaybeString(rawOutputRecord?.stdout) ??
    getMaybeString(rawOutputRecord?.aggregated_output) ??
    getMaybeString(rawOutputRecord?.output) ??
    getMaybeString(metadata?.output) ??
    getMaybeString(metadata?.stderr);
  const errorOutput = getMaybeString(rawOutputRecord?.stderr) ?? getMaybeString(metadata?.stderr);

  const content = resultRecord.content ?? fields?.content;
  const contentText = Array.isArray(content)
    ? content
      .map((item: unknown) => getMaybeString(asRecord(getField(item, 'content'))?.text))
      .filter((text): text is string => typeof text === 'string' && text.length > 0)
      .join('')
    : undefined;

  const hasParsed = Boolean(
    title ||
    status ||
    command ||
    description ||
    output ||
    errorOutput ||
    contentText,
  );

  if (!hasParsed) {
    return null;
  }

  return {
    title,
    status,
    command,
    description,
    contentText,
    output,
    errorOutput,
  };
};

const ToolResultDetails: React.FC<{ result: any }> = ({ result }) => {
  const details = extractToolResultDetails(result);
  if (!details) {
    return (
      <pre className="acp-tool-result-content">
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  const { title, status, command, description, contentText, output, errorOutput } = details;
  const normalizedContent = typeof contentText === 'string' ? contentText.trim() : undefined;
  const normalizedOutput = typeof output === 'string' ? output.trim() : undefined;
  const shouldShowOutput =
    typeof output === 'string' &&
    output.length > 0 &&
    normalizedOutput !== normalizedContent;
  const shouldShowError =
    typeof errorOutput === 'string' &&
    errorOutput.length > 0 &&
    errorOutput.trim() !== normalizedOutput;

  return (
    <div className="acp-tool-result-details">
      {(title || (status && status !== 'completed')) && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Status:</div>
          <div className="acp-tool-result-meta">
            {title && <div className="acp-tool-result-title">{title}</div>}
            {status && <div className="acp-tool-result-status">{status}</div>}
          </div>
        </div>
      )}
      {(command || description) && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Input:</div>
          {description && <div className="acp-tool-result-text">{description}</div>}
          {command && (
            <pre className="acp-tool-result-content">{command}</pre>
          )}
        </div>
      )}
      {contentText && (
        <div className="acp-tool-call-section">
          <pre className="acp-tool-result-content">{contentText}</pre>
        </div>
      )}
      {shouldShowOutput && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Output:</div>
          <pre className="acp-tool-result-content">{output}</pre>
        </div>
      )}
      {shouldShowError && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Error:</div>
          <pre className="acp-tool-result-content">{errorOutput}</pre>
        </div>
      )}
    </div>
  );
};

const ToolUpdateMessage: React.FC<{
  message: AcpToolUpdateMessage;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, isExpanded, onToggle }) => (
  <div className="acp-message acp-message-tool_update">
    <div className="acp-message-content">
      <div className="acp-tool-update-indicator" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
        Tool update:
      </div>
      {isExpanded && (
        <pre className="acp-tool-update-content">
          {JSON.stringify(message.update, null, 2)}
        </pre>
      )}
    </div>
  </div>
);

const canRenderWithAnycodeEditor = (language: string): boolean => {
  return EDITOR_SUPPORTED_LANGUAGES.has(language);
};

const getLanguageFromPath = (path?: string): string => {
  if (!path) return 'text';
  const fileName = path.split('/').pop() ?? path;
  const parts = fileName.toLowerCase().split('.');
  const extension = parts.length > 1 ? parts.pop() : undefined;
  return normalizeFenceLanguage(extension ?? 'text');
};

const getFileNameFromPath = (path: string): string => {
  return path.split('/').pop() ?? path;
};

const formatToolCallLabel = (diffPaths: string[], fallbackLabel: string): string => {
  if (diffPaths.length === 0) {
    return fallbackLabel;
  }

  if (diffPaths.length === 1) {
    return getFileNameFromPath(diffPaths[0]);
  }

  const visibleNames = diffPaths.slice(0, 2).map(getFileNameFromPath);
  const hiddenCount = diffPaths.length - visibleNames.length;
  return hiddenCount > 0
    ? `${visibleNames.join(', ')} +${hiddenCount}`
    : visibleNames.join(', ');
};

const getToolCallStats = (diffs: AcpDiffContent[]) => {
  if (diffs.length === 0) {
    return undefined;
  }

  return diffs.reduce(
    (acc, diff) => {
      const diffStats = countDiffLines(diff.oldText, diff.newText);
      acc.added += diffStats.added;
      acc.deleted += diffStats.deleted;
      return acc;
    },
    { added: 0, deleted: 0 },
  );
};

const getToolCallFileNames = (diffs: AcpDiffContent[]): string[] => {
  return Array.from(new Set(diffs.map((diff) => getFileNameFromPath(diff.path))));
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
};

const getField = (value: unknown, key: string) => {
  return asRecord(value)?.[key];
};

const getStringField = (value: unknown, key: string): string | undefined => {
  const field = getField(value, key);
  return typeof field === 'string' ? field : undefined;
};

const getMaybeString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const countDiffLines = (oldText?: string | null, newText?: string | null) => {
  const changes = diffLines(oldText ?? '', newText ?? '');
  return changes.reduce(
    (acc, change) => {
      if (change.added) {
        acc.added += change.count;
      }
      if (change.removed) {
        acc.deleted += change.count;
      }
      return acc;
    },
    { added: 0, deleted: 0 },
  );
};

const isAcpDiffContent = (value: unknown): value is AcpDiffContent => {
  const record = asRecord(value);
  if (!record || record.type !== 'diff') {
    return false;
  }

  const oldText = record.oldText;
  return typeof record.path === 'string'
    && typeof record.newText === 'string'
    && (oldText === undefined || oldText === null || typeof oldText === 'string');
};

const getDiffEntries = (content: unknown): AcpDiffContent[] => {
  return Array.isArray(content) ? content.filter(isAcpDiffContent) : [];
};

const getToolCallPayload = (message: AcpToolCallMessage): Record<string, unknown> | undefined => {
  if (message.content || message.kind || message.status || message.raw_input || message.raw_output) {
    return {
      kind: message.kind,
      status: message.status,
      content: message.content,
      locations: message.locations,
      raw_input: message.raw_input,
      raw_output: message.raw_output,
    };
  }

  return asRecord(message.arguments);
};

const getToolProgressPayload = (
  message?: AcpToolUpdateMessage | AcpToolResultMessage,
): Record<string, unknown> | undefined => {
  if (!message) return undefined;
  return asRecord(message.role === 'tool_update' ? message.update : message.result);
};

const dedupeDiffs = (diffs: AcpDiffContent[]): AcpDiffContent[] => {
  const seen = new Set<string>();
  return diffs.filter((diff) => {
    const key = `${diff.path}\u0000${diff.oldText ?? ''}\u0000${diff.newText}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const getToolCallView = (
  message: AcpToolCallMessage,
  toolUpdates?: AcpToolUpdateMessage[],
  toolResult?: AcpToolResultMessage,
) => {
  const toolCallPayload = getToolCallPayload(message);
  const progressPayloads = [
    ...(toolUpdates ?? []).map((toolUpdate) => getToolProgressPayload(toolUpdate)),
    getToolProgressPayload(toolResult),
  ].filter((payload): payload is Record<string, unknown> => payload !== undefined);

  const kind = message.kind ?? getStringField(toolCallPayload, 'kind') ?? getStringField(progressPayloads[0], 'kind');
  const diffs = dedupeDiffs([
    ...getDiffEntries(message.content),
    ...getDiffEntries(getField(toolCallPayload, 'content')),
    ...progressPayloads.flatMap((payload) => getDiffEntries(getField(payload, 'content'))),
  ]);

  return {
    kind,
    diffs,
  };
};

type ParsedFileLink = {
  path: string;
  line?: number;
  column?: number;
};

const parseLineNumber = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const toZeroBasedPosition = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  return value > 0 ? value - 1 : 0;
};

const parseMarkdownFileHref = (href: string): ParsedFileLink | null => {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('#')) {
    return null;
  }

  if (/^(https?:|mailto:|tel:)/i.test(trimmedHref)) {
    return null;
  }

  let workingHref = trimmedHref;
  let line: number | undefined;
  let column: number | undefined;

  const hashIndex = workingHref.indexOf('#');
  if (hashIndex >= 0) {
    const fragment = workingHref.slice(hashIndex + 1);
    workingHref = workingHref.slice(0, hashIndex);
    const lineMatch = fragment.match(/^L(\d+)(?:C(\d+))?$/i);
    if (lineMatch) {
      line = parseLineNumber(lineMatch[1]);
      column = parseLineNumber(lineMatch[2] ?? null);
    }
  }

  const queryIndex = workingHref.indexOf('?');
  if (queryIndex >= 0) {
    const queryString = workingHref.slice(queryIndex + 1);
    workingHref = workingHref.slice(0, queryIndex);
    const params = new URLSearchParams(queryString);
    line ??= parseLineNumber(params.get('line'));
    column ??= parseLineNumber(params.get('column'));
  }

  if (workingHref.startsWith('file://')) {
    workingHref = decodeURIComponent(workingHref.slice('file://'.length));
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(workingHref)) {
    return null;
  }

  const suffixMatch = workingHref.match(/^(.*):(\d+)(?::(\d+))?$/);
  if (suffixMatch) {
    workingHref = suffixMatch[1];
    line ??= parseLineNumber(suffixMatch[2]);
    column ??= parseLineNumber(suffixMatch[3] ?? null);
  }

  const path = decodeURIComponent(workingHref).trim();
  if (!path) {
    return null;
  }

  return {
    path,
    line: toZeroBasedPosition(line),
    column: toZeroBasedPosition(column ?? 0),
  };
};

const MarkdownLink: React.FC<React.ComponentProps<'a'> & {
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({
  children,
  href,
  onClick,
  onOpenFile,
  onOpenFileDiff,
  ...props
}) => {
  const parsedFileLink = href ? parseMarkdownFileHref(href) : null;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }

    const openFileLink = onOpenFileDiff ?? onOpenFile;

    if (parsedFileLink && openFileLink) {
      event.preventDefault();
      openFileLink(parsedFileLink.path, parsedFileLink.line, parsedFileLink.column);
      return;
    }

    if (!href || /^javascript:/i.test(href.trim())) {
      event.preventDefault();
    }
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      target={parsedFileLink ? undefined : '_blank'}
      rel={parsedFileLink ? undefined : 'noreferrer noopener'}
    >
      {children}
    </a>
  );
};

const MarkdownInlineCode: React.FC<{
  children?: React.ReactNode;
}> = ({ children }) => {
  return (
    <code className="acp-inline-code">
      {children}
    </code>
  );
};

type MarkdownPart =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language: string; isOpen: boolean };

const normalizeFenceLanguage = (rawLanguage: string): string => {
  const language = rawLanguage.trim().toLowerCase();
  if (!language) return 'text';
  return SUPPORTED_LANGUAGES[language] ?? language;
};

const parseMarkdownParts = (content: string): MarkdownPart[] => {
  const lines = content.split('\n');
  const parts: MarkdownPart[] = [];
  let textBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCodeFence = false;
  let currentLanguage = 'text';

  const flushText = () => {
    if (textBuffer.length === 0) return;
    parts.push({ kind: 'text', content: textBuffer.join('\n') });
    textBuffer = [];
  };

  const flushCode = (isOpen: boolean) => {
    parts.push({
      kind: 'code',
      content: codeBuffer.join('\n'),
      language: currentLanguage,
      isOpen,
    });
    codeBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_+-]*)\s*$/);

    if (!inCodeFence && fenceMatch) {
      flushText();
      inCodeFence = true;
      currentLanguage = normalizeFenceLanguage(fenceMatch[1] || '');
      codeBuffer = [];
      continue;
    }

    if (inCodeFence && trimmed === '```') {
      flushCode(false);
      inCodeFence = false;
      currentLanguage = 'text';
      continue;
    }

    if (inCodeFence) {
      codeBuffer.push(line);
    } else {
      textBuffer.push(line);
    }
  }

  if (inCodeFence) {
    flushCode(true);
  }

  flushText();
  return parts;
};

const MarkdownTextBlock: React.FC<{
  content: string;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({ content, onOpenFile, onOpenFileDiff }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkBreaks]}
    components={{
      a: ({ node: _node, ...props }) => (
        <MarkdownLink
          {...props}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
        />
      ),
      code: MarkdownInlineCode,
    }}
  >
    {content}
  </ReactMarkdown>
);

const MarkdownCodeBlock: React.FC<{
  code: string;
  language: string;
  isOpen?: boolean;
}> = ({ code, language, isOpen = false }) => {
  const [editor, setEditor] = React.useState<AnycodeEditor | null>(null);
  const blockIdRef = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const useEditor = canRenderWithAnycodeEditor(language);

  if (!blockIdRef.current) {
    codeBlockIdCounter += 1;
    blockIdRef.current = `acp-code-block-${codeBlockIdCounter}`;
  }

  React.useEffect(() => {
    if (editor) {
      editor.updateTextIncremental(code);
      // scroll to the bottom 
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [code, editor]);

  React.useEffect(() => {
    if (!useEditor) {
      setEditor(null);
      return;
    }

    let cancelled = false;
    let editor: AnycodeEditor | null = null;

    const init = async () => {
      try {
        editor = new AnycodeEditor(code, blockIdRef.current!, language, {
          readOnly: true,
        });
        await editor.init();

        if (cancelled) {
          editor.clean();
          return;
        }

        setEditor(editor);
      } catch (error) {
        console.warn(`Failed to render code block with AnycodeEditor for language "${language}"`, error);
        if (editor) {
          editor.clean();
        }
        setEditor(null);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (editor) {
        editor.clean();
      }
      setEditor(null);
    };
  }, [language, useEditor]);

  if (!useEditor) {
    return (
      <div className="acp-code">
        <pre className="acp-code-block-fallback">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`acp-code ${isOpen ? 'acp-code-streaming' : ''}`}
    >
      {editor ? (
        <AnycodeEditorReact id={blockIdRef.current!} editorState={editor} />
      ) : (
        <pre className="acp-code-block-fallback">{code}</pre>
      )}
    </div>
  );
};

const DiffCodeBlock: React.FC<{
  diff: AcpDiffContent;
}> = ({ diff }) => {
  const [editor, setEditor] = React.useState<AnycodeEditor | null>(null);
  const blockIdRef = React.useRef<string | null>(null);
  const language = getLanguageFromPath(diff.path);
  const useEditor = canRenderWithAnycodeEditor(language);

  if (!blockIdRef.current) {
    codeBlockIdCounter += 1;
    blockIdRef.current = `acp-diff-block-${codeBlockIdCounter}`;
  }

  React.useEffect(() => {
    if (!useEditor) {
      setEditor(null);
      return;
    }

    let cancelled = false;
    let nextEditor: AnycodeEditor | null = null;

    const init = async () => {
      try {
        nextEditor = new AnycodeEditor(diff.newText, blockIdRef.current!, language, {
          readOnly: true,
        });
        await nextEditor.init();
        nextEditor.setOriginalCode(diff.oldText ?? '');
        nextEditor.setDiffEnabled(true);

        if (cancelled) {
          nextEditor.clean();
          return;
        }

        setEditor(nextEditor);
      } catch (error) {
        console.warn(`Failed to render diff block with AnycodeEditor for language "${language}"`, error);
        if (nextEditor) {
          nextEditor.clean();
        }
        setEditor(null);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (nextEditor) {
        nextEditor.clean();
      }
      setEditor(null);
    };
  }, [diff.newText, diff.oldText, language, useEditor]);

  React.useEffect(() => {
    if (!editor) return;
    editor.updateTextIncremental(diff.newText);
    editor.setOriginalCode(diff.oldText ?? '');
    editor.setDiffEnabled(true);
  }, [diff.newText, diff.oldText, editor]);

  if (!useEditor) {
    return (
      <pre className="acp-tool-result-content">
        {`--- before\n${diff.oldText ?? ''}\n+++ after\n${diff.newText}`}
      </pre>
    );
  }

  return (
    <div className="acp-code acp-diff-code">
      {editor ? (
        <AnycodeEditorReact id={blockIdRef.current!} editorState={editor} />
      ) : (
        <pre className="acp-code-block-fallback">{diff.newText}</pre>
      )}
    </div>
  );
};

const StreamingMarkdownContent: React.FC<{
  content: string;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({ content, onOpenFile, onOpenFileDiff }) => (
  <div className="acp-message-markdown">
    {parseMarkdownParts(content).map((part, index) => {
      if (part.kind === 'code') {
        return (
          <MarkdownCodeBlock
            key={`code-${index}`}
            code={part.content}
            language={part.language}
            isOpen={part.isOpen}
          />
        );
      }

      return (
        <MarkdownTextBlock
          key={`text-${index}`}
          content={part.content}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
        />
      );
    })}
  </div>
);

const TextMessage: React.FC<{
  message: AcpUserMessage | AcpAssistantMessage;
  onUndo?: () => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({ message, onUndo, onOpenFile, onOpenFileDiff }) => (
  <div className={`acp-message acp-message-${message.role}`}>
    <div className="acp-message-content acp-message-content-with-actions">
      <StreamingMarkdownContent
        content={message.content}
        onOpenFile={onOpenFile}
        onOpenFileDiff={onOpenFileDiff}
      />
      {message.role === 'user' && onUndo && (
        <div className="acp-message-actions">
          <button className="acp-undo-button" onClick={onUndo} title="Undo">
            Undo
          </button>
        </div>
      )}
    </div>
  </div>
);

const ThoughtMessage: React.FC<{
  message: AcpThoughtMessage;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, isExpanded, onToggle }) => {
  if (!message.content || message.content.trim() === '') {
    return null;
  }
  const isLong = message.content.length > 180;
  const shouldToggle = isLong;
  const expanded = shouldToggle ? isExpanded : true;
  const lines = message.content.trim().split('\n');
  const previewLine = lines[0] || '';
  return (
    <div className="acp-message acp-message-thought">
      <div className="acp-message-content">
        <div
          className={`acp-thought-text ${!expanded ? 'acp-thought-text-collapsed' : ''}`}
          onClick={shouldToggle ? onToggle : undefined}
          style={shouldToggle ? { cursor: 'pointer' } : undefined}
        >
          {shouldToggle && (
            <span className="acp-toggle-icon acp-thought-toggle-inline">
              {expanded ? '▼' : '▶'}
            </span>
          )}
          {expanded ? (
            message.content.trim().split('\n').map((line, i, allLines) => (
              <React.Fragment key={i}>
                {line}
                {i < allLines.length - 1 && <br />}
              </React.Fragment>
            ))
          ) : (
            <>
              {previewLine}
              {'…'}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ErrorMessage: React.FC<{
  message: AcpErrorMessage;
}> = ({ message }) => (
  <div className="acp-message acp-message-error">
    <div className="acp-message-content">
      <div className="acp-error-indicator">Error</div>
      <div className="acp-error-content">{message.message}</div>
    </div>
  </div>
);

const PermissionRequestMessage: React.FC<{
  message: AcpPermissionRequestMessage;
  isExpanded: boolean;
  onToggle: () => void;
  onPermissionResponse: (permissionId: string, optionId: string) => void;
}> = ({ message, isExpanded, onToggle, onPermissionResponse }) => {
  const toolCall = message.tool_call;
  const hasArguments = toolCall.arguments &&
    JSON.stringify(toolCall.arguments) !== '{}' &&
    JSON.stringify(toolCall.arguments) !== '[]';
  const displayCommand = toolCall.command?.trim() || toolCall.name;

  return (
    <div className="acp-message acp-message-permission_request">
      <div className="acp-message-content">
        <div className="acp-permission-header" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
          <div className="acp-tool-call-name">{displayCommand}</div>
        </div>

        {isExpanded && (
          <>
            {toolCall.command && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Command:</div>
                <pre className="acp-tool-call-command">{toolCall.command}</pre>
              </div>
            )}
            {hasArguments && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Arguments:</div>
                <pre className="acp-tool-call-args">
                  {JSON.stringify(toolCall.arguments, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}

        <div className="acp-permission-buttons">
          {message.options.map((option) => (
            <button
              key={option.id}
              className={`acp-permission-button ${option.name.toLowerCase().includes('allow') ? 'acp-permission-allow' : 'acp-permission-deny'}`}
              onClick={() => onPermissionResponse(message.id, option.id)}
            >
              {option.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export const AcpMessage: React.FC<AcpMessageProps> = ({
  message,
  toolResult,
  toolUpdates,
  isExpanded = false,
  onToggle,
  onPermissionResponse,
  onUndo,
  onOpenFile,
  onOpenFileDiff,
}) => {
  switch (message.role) {
    case 'tool_call':
      if (!onToggle) return null;
      return (
        <ToolCallMessage
            message={message}
            toolResult={toolResult}
            toolUpdates={toolUpdates}
            isExpanded={isExpanded}
            onToggle={onToggle}
            onOpenFileDiff={onOpenFileDiff}
          />
      );
    case 'tool_result':
      if (!onToggle) return null;
      return (
        <ToolResultMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case 'tool_update':
      if (!onToggle) return null;
      return (
        <ToolUpdateMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case 'user':
      return (
        <TextMessage
          message={message}
          onUndo={onUndo}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
        />
      );
    case 'assistant':
      return (
        <TextMessage
          message={message}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
        />
      );
    case 'thought':
      if (!onToggle) return null;
      return (
        <ThoughtMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case 'permission_request':
      if (!onToggle || !onPermissionResponse) return null;
      return (
        <PermissionRequestMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
          onPermissionResponse={onPermissionResponse}
        />
      );
    case 'prompt_state':
      // Skip rendering prompt_state messages in the chat
      return null;
    case 'error':
      return <ErrorMessage message={message} />;
    default:
      console.warn('Unknown message role:', message);
      return null;
  }
};
