import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { AnycodeEditorReact, AnycodeEditor } from 'anycode-react';
import {
  AcpMessage as AcpMessageType,
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
  'javascript',
  'typescript',
  'rust',
  'python',
  'yaml',
  'json',
  'toml',
  'html',
  'css',
  'go',
  'java',
  'kotlin',
  'lua',
  'bash',
  'zig',
  'csharp',
  'c',
  'cpp',
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
}

const ToolCallMessage: React.FC<{
  message: AcpToolCallMessage;
  toolResult?: AcpToolResultMessage;
  toolUpdates?: AcpToolUpdateMessage[];
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, toolResult, toolUpdates, isExpanded, onToggle }) => {
  const hasArguments = message.arguments &&
    JSON.stringify(message.arguments) !== '{}' &&
    JSON.stringify(message.arguments) !== '[]';
  const displayCommand = message.command?.trim() || message.name;

  return (
    <div className="acp-message acp-message-tool_call">
      <div className="acp-message-content">
        <div className="acp-tool-call-toggle" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
          <div className="acp-tool-call-name">{displayCommand}</div>
        </div>

        {isExpanded && (
          <>
            {message.command && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Command:</div>
                <pre className="acp-tool-call-command">{message.command}</pre>
              </div>
            )}
            {/* {hasArguments && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Arguments:</div>
                <pre className="acp-tool-call-args">
                  {JSON.stringify(message.arguments, null, 2)}
                </pre>
              </div>
            )} */}
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
            {toolResult && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Result:</div>
                <ToolResultDetails result={toolResult.result} />
              </div>
            )}
          </>
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

const ToolResultDetails: React.FC<{ result: any }> = ({ result }) => {
  if (!result || typeof result !== 'object') {
    return (
      <pre className="acp-tool-result-content">
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  const getField = (value: any, camel: string, snake: string) => {
    if (value && typeof value === 'object') {
      if (camel in value) return value[camel];
      if (snake in value) return value[snake];
    }
    return undefined;
  };

  const fields = result.fields && typeof result.fields === 'object' ? result.fields : undefined;
  const title = result.title ?? fields?.title;
  const status = result.status ?? fields?.status;
  const rawInput = getField(result, 'rawInput', 'raw_input')
    ?? getField(fields, 'rawInput', 'raw_input');
  const rawOutput = getField(result, 'rawOutput', 'raw_output')
    ?? getField(fields, 'rawOutput', 'raw_output');
  const content = result.content ?? fields?.content;

  const rawOutputCommand = typeof rawOutput === 'object' ? rawOutput?.command : undefined;
  const command =
    rawInput?.cmd ??
    rawInput?.command ??
    (Array.isArray(rawOutputCommand) ? rawOutputCommand.join(' ') : rawOutputCommand);
  const description =
    rawInput?.description ??
    (typeof rawOutput === 'object' ? rawOutput?.metadata?.description : undefined);
  const output =
    (typeof rawOutput === 'string' ? rawOutput : undefined) ??
    rawOutput?.formatted_output ??
    rawOutput?.stdout ??
    rawOutput?.aggregated_output ??
    rawOutput?.output ??
    rawOutput?.metadata?.output ??
    rawOutput?.metadata?.stderr;
  const errorOutput =
    typeof rawOutput === 'object'
      ? rawOutput?.stderr ?? rawOutput?.metadata?.stderr
      : undefined;

  const contentText = Array.isArray(content)
    ? content
      .map((item: any) => item?.content?.text)
      .filter((text: any) => typeof text === 'string' && text.length > 0)
      .join('')
    : undefined;

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

  const hasParsed =
    title ||
    status ||
    command ||
    description ||
    output ||
    contentText;

  if (!hasParsed) {
    return (
      <pre className="acp-tool-result-content">
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  return (
    <div className="acp-tool-result-details">
      {(title || status !== "completed") && (
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
          {/* <div className="acp-tool-call-label">Content:</div> */}
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

const MarkdownLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({
  children,
  ...props
}) => (
  <a {...props} target="_blank" rel="noreferrer noopener">
    {children}
  </a>
);

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
}> = ({ content }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkBreaks]}
    components={{
      a: MarkdownLink,
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

const StreamingMarkdownContent: React.FC<{
  content: string;
}> = ({ content }) => (
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
        <MarkdownTextBlock key={`text-${index}`} content={part.content} />
      );
    })}
  </div>
);

const TextMessage: React.FC<{
  message: AcpUserMessage | AcpAssistantMessage;
  onUndo?: () => void;
}> = ({ message, onUndo }) => (
  <div className={`acp-message acp-message-${message.role}`}>
    <div className="acp-message-content acp-message-content-with-actions">
      <StreamingMarkdownContent content={message.content} />
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
      return <TextMessage message={message} onUndo={onUndo} />;
    case 'assistant':
      return <TextMessage message={message} />;
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
