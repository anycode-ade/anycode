import React from 'react';
import {
  AcpMessage as AcpMessageType,
  AcpToolCallMessage,
  AcpToolResultMessage,
  AcpUserMessage,
  AcpAssistantMessage,
  AcpThoughtMessage,
  AcpPermissionRequestMessage,
  AcpErrorMessage,
} from '../../types';
import './AcpMessage.css';

interface AcpMessageProps {
  message: AcpMessageType;
  isExpanded?: boolean;
  onToggle?: () => void;
  onPermissionResponse?: (permissionId: string, optionId: string) => void;
}

const ToolCallMessage: React.FC<{
  message: AcpToolCallMessage;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, isExpanded, onToggle }) => {
  const hasArguments = message.arguments && 
    JSON.stringify(message.arguments) !== '{}' && 
    JSON.stringify(message.arguments) !== '[]';

  return (
    <div className="acp-message acp-message-tool_call">
      <div className="acp-message-content">
        <div className="acp-tool-call-indicator" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <div className="acp-tool-call-header">
            <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
            Tool Call:
          </div>
          <div className="acp-tool-call-name">{message.name}</div>
        </div>
        
        {isExpanded && (
          <>
            {message.command && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Command:</div>
                <pre className="acp-tool-call-command">{message.command}</pre>
              </div>
            )}
            {hasArguments && (
              <div className="acp-tool-call-section">
                <div className="acp-tool-call-label">Arguments:</div>
                <pre className="acp-tool-call-args">
                  {JSON.stringify(message.arguments, null, 2)}
                </pre>
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
        <pre className="acp-tool-result-content">
          {JSON.stringify(message.result, null, 2)}
        </pre>
      )}
    </div>
  </div>
);

const TextMessage: React.FC<{
  message: AcpUserMessage | AcpAssistantMessage;
}> = ({ message }) => (
  <div className={`acp-message acp-message-${message.role}`}>
    <div className="acp-message-content">
      {message.content.split('\n').map((line, i) => (
        <React.Fragment key={i}>
          {line}
          {i < message.content.split('\n').length - 1 && <br />}
        </React.Fragment>
      ))}
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
  return (
    <div className="acp-message acp-message-thought">
      <div className="acp-message-content">
        <div className="acp-thought-indicator" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <div className="acp-tool-call-header">
            <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
            Thought:
          </div>
        </div>
        {isExpanded && (
          <div className="acp-thought-content">
            {message.content.split('\n').map((line, i, lines) => (
              <React.Fragment key={i}>
                {line}
                {i < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </div>
        )}
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

  return (
    <div className="acp-message acp-message-permission_request">
      <div className="acp-message-content">
        <div className="acp-permission-header" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <div className="acp-tool-call-header">
            <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
            🔐 Permission Required:
          </div>
          <div className="acp-tool-call-name">{toolCall.name}</div>
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
  isExpanded = false,
  onToggle,
  onPermissionResponse,
}) => {
  switch (message.role) {
    case 'tool_call':
      if (!onToggle) return null;
      return (
        <ToolCallMessage
          message={message}
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
    case 'user':
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

