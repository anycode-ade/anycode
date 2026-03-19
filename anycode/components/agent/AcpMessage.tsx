import React from 'react';
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

interface AcpMessageProps {
  message: AcpMessageType;
  toolResult?: AcpToolResultMessage;
  toolUpdate?: AcpToolUpdateMessage;
  isExpanded?: boolean;
  onToggle?: () => void;
  onPermissionResponse?: (permissionId: string, optionId: string) => void;
  onUndo?: () => void;
}

const ToolCallMessage: React.FC<{
  message: AcpToolCallMessage;
  toolResult?: AcpToolResultMessage;
  toolUpdate?: AcpToolUpdateMessage;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, toolResult, toolUpdate, isExpanded, onToggle }) => {
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
            {toolUpdate && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Update:</div>
                <pre className="acp-tool-result-content">
                  {JSON.stringify(toolUpdate.update, null, 2)}
                </pre>
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

  const title = result.title;
  const status = result.status;
  const rawInput = getField(result, 'rawInput', 'raw_input');
  const rawOutput = getField(result, 'rawOutput', 'raw_output');
  const content = result.content;

  const rawOutputCommand = rawOutput?.command;
  const command =
    rawInput?.command ??
    (Array.isArray(rawOutputCommand) ? rawOutputCommand.join(' ') : rawOutputCommand);
  const description = rawInput?.description ?? rawOutput?.metadata?.description;
  const output =
    rawOutput?.formatted_output ??
    rawOutput?.stdout ??
    rawOutput?.aggregated_output ??
    rawOutput?.output ??
    rawOutput?.metadata?.output ??
    rawOutput?.metadata?.stderr;
  const errorOutput =
    rawOutput?.stderr ??
    rawOutput?.metadata?.stderr;

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

const TextMessage: React.FC<{
  message: AcpUserMessage | AcpAssistantMessage;
  onUndo?: () => void;
}> = ({ message, onUndo }) => (
  <div className={`acp-message acp-message-${message.role}`}>
    <div className="acp-message-content acp-message-content-with-actions">
      <div className="acp-message-text">
        {message.content.trim().split('\n').map((line, i, lines) => (
          <React.Fragment key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </div>
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
  toolUpdate,
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
          toolUpdate={toolUpdate}
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
