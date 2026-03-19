import React, { useState, useEffect, useRef } from 'react';
import { 
  AcpMessage, 
  AcpToolCall, 
  AcpToolCallMessage, 
  AcpToolResultMessage,
  AcpUserMessage,
  AcpAssistantMessage,
  AcpThoughtMessage,
  AcpSession,
  AcpAgent,
  type AcpPermissionMode,
} from '../types';
import './AcpDialog.css';
import { AcpSettings } from './agent/AcpSettings';

const Icons = {
  Stop: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Start: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M10 5V15M5 10H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Send: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <path d="M10 6V14M10 6L6 10M10 6L14 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Cancel: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="6" y="6" width="8" height="8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    </svg>
  ),
  Close: () => (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Add: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M10 5V15M5 10H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Settings: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="5" r="1.5" fill="currentColor"/>
      <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
      <circle cx="10" cy="15" r="1.5" fill="currentColor"/>
    </svg>
  )
};

interface ToolCallMessageProps {
  message: AcpToolCallMessage;
  isExpanded: boolean;
  onToggle: () => void;
}

const ToolCallMessage: React.FC<ToolCallMessageProps> = ({ message, isExpanded, onToggle }) => {
  const hasArguments = message.arguments && 
    JSON.stringify(message.arguments) !== '{}' && 
    JSON.stringify(message.arguments) !== '[]';
  const displayCommand = message.command?.trim() || message.name;

  return (
    <div className="acp-message acp-message-tool_call">
      <div className="acp-message-content">
        <div className="acp-tool-call-toggle" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <div className="acp-tool-call-header">
            <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
            Tool Call:
          </div>
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

interface ToolResultMessageProps {
  message: AcpToolResultMessage;
  isExpanded: boolean;
  onToggle: () => void;
}

const ToolResultMessage: React.FC<ToolResultMessageProps> = ({ message, isExpanded, onToggle }) => (
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

interface TextMessageProps {
  message: AcpUserMessage | AcpAssistantMessage;
}

const TextMessage: React.FC<TextMessageProps> = ({ message }) => (
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

interface ThoughtMessageProps {
  message: AcpThoughtMessage;
}

const ThoughtMessage: React.FC<ThoughtMessageProps> = ({ message }) => {
  if (!message.content || message.content.trim() === '') {
    return null;
  }
  return (
    <div className="acp-message acp-message-thought">
      <div className="acp-message-content">
        <div className="acp-thought-indicator">Thought:</div>
        {message.content.split('\n').map((line, i, lines) => (
          <React.Fragment key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const useAutoScroll = (messages: AcpMessage[]) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottomRef = useRef(true);
  const lastScrollTopRef = useRef<number>(0);
  const userScrolledUpRef = useRef(false);

  const checkIfScrolledToBottom = (element: HTMLElement): boolean => {
    const threshold = 70;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
  };

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const currentScrollTop = contentElement.scrollTop;
      const scrollDirection = currentScrollTop < lastScrollTopRef.current ? 'up' : 'down';
      
      if (scrollDirection === 'up') {
        userScrolledUpRef.current = true;
      }
      
      isScrolledToBottomRef.current = checkIfScrolledToBottom(contentElement);
      lastScrollTopRef.current = currentScrollTop;
    };

    contentElement.addEventListener('scroll', handleScroll);
    return () => contentElement.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (contentRef.current && isScrolledToBottomRef.current && !userScrolledUpRef.current) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
      });
    }
  }, [messages]);

  return contentRef;
};

const useExpandableItems = () => {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setExpanded(prev => {
      const newSet = new Set(prev);
      newSet.has(index) ? newSet.delete(index) : newSet.add(index);
      return newSet;
    });
  };

  return { expanded, toggle };
};

interface AcpDialogProps {
  agents: AcpSession[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
  onAddAgent: () => void;
  onOpenSettings: () => void;
  agentId: string;
  isOpen: boolean;
  onClose: () => void;
  onSendPrompt: (agentId: string, prompt: string) => void;
  onCancelPrompt: (agentId: string) => void;
  messages: AcpMessage[];
  toolCalls: AcpToolCall[];
  isConnected: boolean;
  isProcessing?: boolean;
  showSettings?: boolean;
  settingsAgents?: AcpAgent[];
  settingsDefaultAgentId?: string | null;
  settingsPermissionMode?: AcpPermissionMode;
  onSaveSettings?: (agents: AcpAgent[], defaultAgentId: string | null, permissionMode: AcpPermissionMode) => void;
  onCloseSettings?: () => void;
}

export const AcpDialog: React.FC<AcpDialogProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onCloseAgent,
  onAddAgent,
  onOpenSettings,
  agentId,
  isOpen,
  onSendPrompt,
  onCancelPrompt,
  messages,
  toolCalls,
  isConnected,
  isProcessing = false,
  showSettings = false,
  settingsAgents = [],
  settingsDefaultAgentId = null,
  settingsPermissionMode = 'full_access',
  onSaveSettings,
  onCloseSettings,
}) => {
  const [inputValue, setInputValue] = useState('');
  const { expanded: expandedToolCalls, toggle: toggleToolCall } = useExpandableItems();
  const { expanded: expandedToolResults, toggle: toggleToolResult } = useExpandableItems();
  const contentRef = useAutoScroll(messages);
  const agentsListRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  // If settings are shown, render settings dialog instead
  if (showSettings && onSaveSettings && onCloseSettings) {
    return (
      <div className="acp-dialog" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <AcpSettings
          agents={settingsAgents}
          defaultAgentId={settingsDefaultAgentId}
          permissionMode={settingsPermissionMode}
          onSave={onSaveSettings}
          onClose={onCloseSettings}
        />
      </div>
    );
  }

  const handleSend = () => {
    if (inputValue.trim() && isConnected) {
      onSendPrompt(agentId, inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };


  const renderMessage = (message: AcpMessage, index: number) => {

    switch (message.role) {
      case 'tool_call':
        return (
          <ToolCallMessage
            key={index}
            message={message}
            isExpanded={expandedToolCalls.has(index)}
            onToggle={() => toggleToolCall(index)}
          />
        );
      case 'tool_result':
        return (
          <ToolResultMessage
            key={index}
            message={message}
            isExpanded={expandedToolResults.has(index)}
            onToggle={() => toggleToolResult(index)}
          />
        );
      case 'user':
      case 'assistant':
        return <TextMessage key={index} message={message} />;
      case 'thought':
        return <ThoughtMessage key={index} message={message} />;
      case 'prompt_state':
        // Skip rendering prompt_state messages in the chat
        return null;
      default:
        return null;
    }
  };

  return (
    <div className="acp-dialog" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="acp-dialog-header">
        <div className="acp-agents-container">
          <div className="acp-agents-list" ref={agentsListRef}>
            {agents.map((agent) => {
              const isSelected = agent.agentId === selectedAgentId;
              const isActive = agent.isActive;
              return (
                <div
                  key={agent.agentId}
                  className={`acp-agent-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : 'inactive'}`}
                  onClick={() => onSelectAgent(agent.agentId)}
                >
                  <span className="acp-agent-name">{agent.agentId}</span>
                  <button
                    className="acp-agent-close-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseAgent(agent.agentId);
                    }}
                    title="Close agent"
                  >
                    <Icons.Close />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            className="acp-add-agent-btn"
            onClick={onAddAgent}
            title="Add agent"
          >
            <Icons.Add />
          </button>
          <button
            className="acp-settings-btn"
            onClick={onOpenSettings}
            title="Agent settings"
          >
            <Icons.Settings />
          </button>
        </div>
      </div>

      <div className="acp-dialog-content" ref={contentRef}>
        <div className="acp-dialog-messages">
          {messages.length === 0 ? (
            <div className="acp-empty-state">
              <p>No messages yet. Start a conversation with the agent.</p>
            </div>
          ) : (
            messages.map(renderMessage)
          )}

          {toolCalls.length > 0 && (
            <div className="acp-tool-calls">
              <h4>Tool Calls:</h4>
              {toolCalls.map((toolCall, index) => (
                <div key={index} className="acp-tool-call">
                  <strong>{toolCall.name}</strong>
                  <pre>{JSON.stringify(toolCall.arguments, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="acp-dialog-input">
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask anything..."
          rows={3}
          disabled={!isConnected || isProcessing}
        />
        {isProcessing ? (
          <button
            className="acp-stop-prompt-btn"
            onClick={() => onCancelPrompt(agentId)}
            disabled={!isConnected}
          >
            <Icons.Cancel />
          </button>
        ) : (
          <button
            className="acp-send-btn"
            onClick={handleSend}
            disabled={!inputValue.trim() || !isConnected}
          >
            <Icons.Send />
          </button>
        )}
      </div>
    </div>
  );
};
