import React from 'react';
import {
  AcpMessage as AcpMessageType,
  AcpToolCallMessage,
  AcpToolResultMessage,
  AcpUserMessage,
  AcpAssistantMessage,
} from '../../types';
import './AcpMessage.css';

interface AcpMessageProps {
  message: AcpMessageType;
  index: number;
  isExpanded?: boolean;
  onToggle?: () => void;
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

export const AcpMessage: React.FC<AcpMessageProps> = ({
  message,
  index,
  isExpanded = false,
  onToggle,
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
    case 'prompt_state':
      // Skip rendering prompt_state messages in the chat
      return null;
    default:
      return null;
  }
};

