import React from 'react';
import type { AcpAgent, AcpSession } from '../../types';
import { resolveAgentDisplay } from '../../agents';
import { AgentIcon } from './AgentIcon';
import { AcpIcons } from './AcpIcons';

function getFirstMessagePreview(session: AcpSession): string | null {
  if (!session.messages || session.messages.length === 0) return null;
  for (const m of session.messages) {
    if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content.trim().replace(/\s+/g, ' ');
    }
  }
  for (const m of session.messages) {
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      return m.content.trim().replace(/\s+/g, ' ');
    }
  }
  return null;
}

export interface AcpOpenedAgentCardProps {
  session: AcpSession;
  availableAgents: AcpAgent[];
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
}

export const AcpOpenedAgentCard: React.FC<AcpOpenedAgentCardProps> = ({
  session,
  availableAgents,
  onSelectAgent,
  onCloseAgent,
}) => {
  const { baseName, accountName, fullName } = resolveAgentDisplay(session, availableAgents);
  const firstMessage = getFirstMessagePreview(session);
  const messages = session.messages || [];
  const chatMessageCount = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  const toolCallCount = messages.filter((m) => m.role === 'tool_call').length;
  const queueCount = session.queue?.length ?? 0;
  const unreadCount = Math.max(0, messages.length - (session.lastReadMessageCount ?? 0));
  const hasUnread = unreadCount > 0 && messages.length > 0;
  const isStarting = Boolean(session.isStarting);
  const isWorking = Boolean(session.isProcessing);
  const displaySessionId = session.sessionId;

  const [isCopied, setIsCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<number | null>(null);
  const closeTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleCopySessionId = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (!displaySessionId) return;

    navigator.clipboard.writeText(displaySessionId).then(() => {
      setIsCopied(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setIsCopied(false);
      }, 1500);
    }).catch(() => {});
  };

  const [isClosing, setIsClosing] = React.useState(false);

  const handleClose = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isClosing) return;
    setIsClosing(true);
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      onCloseAgent(session.agentId);
    }, 220);
  };

  return (
    <div
      className={`acp-pane-opened-agent-item ${isStarting ? 'is-starting' : ''} ${isWorking ? 'is-working' : ''} ${hasUnread ? 'has-unread' : ''} ${isClosing ? 'is-closing' : ''}`}
      onClick={(event) => {
        if (isClosing) return;
        event.stopPropagation();
        onSelectAgent(session.agentId);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (isClosing) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectAgent(session.agentId);
        }
      }}
      title={fullName}
    >
      <button
        className="acp-pane-close-button"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={handleClose}
        title={`Close ${fullName}`}
        type="button"
        disabled={isClosing}
      >
        <AcpIcons.CloseSmall />
      </button>

      <div className="acp-pane-opened-header">
        <div className="acp-pane-opened-identity">
          <AgentIcon name={baseName} id={session.agentId} size={15} className="acp-agent-btn-icon" />
          <span className="acp-pane-opened-name" title={baseName}>{baseName}</span>
          {accountName && (
            <span className="acp-pane-opened-account" title={accountName}>
              {accountName}
            </span>
          )}
        </div>
      </div>

      <div className="acp-pane-opened-info-row">
        {isStarting ? (
          <span className="acp-pane-opened-starting" title="Starting agent...">
            <span className="acp-pane-opened-spinner" />
            <span>Starting…</span>
          </span>
        ) : (
          <>
            <span className="acp-pane-opened-count" title={`${chatMessageCount} messages`}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5l-3 3V3z" />
              </svg>
              <span>{chatMessageCount} {chatMessageCount === 1 ? 'msg' : 'msgs'}</span>
            </span>
            {toolCallCount > 0 && (
              <span className="acp-pane-opened-tools" title={`${toolCallCount} tool calls`}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 2a4 4 0 0 0-3.4 6.1L1.5 13.2a1 1 0 0 0 1.4 1.4l5.1-5.1A4 4 0 1 0 10 2z" />
                </svg>
                <span>{toolCallCount} {toolCallCount === 1 ? 'tool' : 'tools'}</span>
              </span>
            )}
            {queueCount > 0 && (
              <span className="acp-pane-opened-queued" title={`${queueCount} queued prompt${queueCount === 1 ? '' : 's'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                <span>{queueCount} queued</span>
              </span>
            )}
            {displaySessionId && (
              <span
                className={`acp-pane-opened-session-id ${isCopied ? 'is-copied' : ''}`}
                onClick={handleCopySessionId}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleCopySessionId(e);
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title={isCopied ? 'Copied!' : `Session ID: ${displaySessionId} (click to copy)`}
                role="button"
                tabIndex={0}
              >
                <span>{isCopied ? 'Copied' : displaySessionId.length > 8 ? `${displaySessionId.slice(0, 8)}…` : displaySessionId}</span>
              </span>
            )}
            <span
              className={`acp-pane-opened-unread-badge ${hasUnread ? 'is-visible' : ''}`}
              title={hasUnread ? `${unreadCount} new message${unreadCount === 1 ? '' : 's'}` : undefined}
              aria-hidden={!hasUnread}
            >
              <span className="acp-pane-opened-unread-dot" />
              <span>{unreadCount > 1 ? `${unreadCount} new` : 'New'}</span>
            </span>
            {isWorking && (
              <span className="acp-pane-opened-working" title="Agent is working...">
                <span className="acp-pane-opened-working-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            )}
          </>
        )}
      </div>

      <div className="acp-pane-opened-preview" title={firstMessage || undefined}>
        {firstMessage ? (
          firstMessage
        ) : (
          <span className="acp-pane-opened-no-message">No messages yet</span>
        )}
      </div>
    </div>
  );
};
