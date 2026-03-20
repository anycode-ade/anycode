import React, { useState, useEffect, useRef } from 'react';
import { 
  AcpMessage, 
  AcpToolCall, 
  AcpSession,
  AcpAgent,
  type AcpSessionSummary,
  type AcpPermissionMode,
} from '../../types';
import './AcpDialog.css';
import { AcpSettings } from './AcpSettings';
import { AcpAgentsList } from './AcpAgentsList';
import { AcpInput } from './AcpInput';
import { AcpMessages } from './AcpMessages';
import { AcpIcons } from './AcpIcons';

const useAutoScroll = (messages: AcpMessage[], isProcessing: boolean) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const lastScrollTopRef = useRef<number>(0);
  const isProgrammaticScrollRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const checkIfScrolledToBottom = (element: HTMLElement): boolean => {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
  };

  const setAutoScroll = (enabled: boolean) => {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabled(prev => (prev === enabled ? prev : enabled));
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const element = contentRef.current;
    if (!element) return;

    isProgrammaticScrollRef.current = true;
    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
  };

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const currentScrollTop = contentElement.scrollTop;
      const delta = currentScrollTop - lastScrollTopRef.current;
      const scrollDirection = delta < -1 ? 'up' : delta > 1 ? 'down' : 'none';

      if (isProgrammaticScrollRef.current) {
        if (checkIfScrolledToBottom(contentElement)) {
          isProgrammaticScrollRef.current = false;
        }
        lastScrollTopRef.current = currentScrollTop;
        return;
      }

      if (scrollDirection === 'up') {
        setAutoScroll(false);
      }

      lastScrollTopRef.current = currentScrollTop;
    };

    contentElement.addEventListener('scroll', handleScroll);
    lastScrollTopRef.current = contentElement.scrollTop;
    return () => contentElement.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isProcessing) return;

    if (autoScrollEnabledRef.current && contentRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom('auto');
      });
    }
  }, [messages, isProcessing]);

  const enableAutoScroll = () => {
    setAutoScroll(true);

    requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
  };

  return { contentRef, autoScrollEnabled, enableAutoScroll };
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
  onPermissionResponse: (agentId: string, permissionId: string, optionId: string) => void;
  onUndoPrompt: (agentId: string, checkpointId?: string, prompt?: string) => void;
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
  onLoadSettingsSessions?: (agent: AcpAgent) => Promise<AcpSessionSummary[]>;
  onResumeSettingsSession?: (agent: AcpAgent, sessionId: string) => void;
  diffEnabled?: boolean;
  onToggleDiff?: () => void;
  followEnabled?: boolean;
  onToggleFollow?: () => void;
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
  onPermissionResponse,
  onUndoPrompt,
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
  onLoadSettingsSessions,
  onResumeSettingsSession,
  diffEnabled = false,
  onToggleDiff,
  followEnabled = false,
  onToggleFollow,
}) => {
  const [inputValue, setInputValue] = useState('');
  const { expanded: expandedToolCalls, toggle: toggleToolCall } = useExpandableItems();
  const { expanded: expandedToolResults, toggle: toggleToolResult } = useExpandableItems();
  const { expanded: expandedThoughts, toggle: toggleThought } = useExpandableItems();
  const { expanded: expandedPermissions, toggle: togglePermission } = useExpandableItems();
  const { contentRef, autoScrollEnabled, enableAutoScroll } = useAutoScroll(messages, isProcessing);

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
          onLoadSessions={onLoadSettingsSessions ?? (async () => [])}
          onResumeSession={(agent, sessionId) => onResumeSettingsSession?.(agent, sessionId)}
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

  return (
    <div className="acp-dialog" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="acp-dialog-header">
        <div className="acp-agents-container">
          <AcpAgentsList
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
            onCloseAgent={onCloseAgent}
          />
          <button
            className="acp-add-agent-btn"
            onClick={onAddAgent}
            title="Add agent"
          >
            <AcpIcons.Add />
          </button>
          {onToggleFollow && (
            <button
              className={`acp-follow-btn ${followEnabled ? 'active' : ''}`}
              onClick={onToggleFollow}
              title={followEnabled ? 'Disable Follow Mode' : 'Enable Follow Mode'}
            >
              <AcpIcons.Follow />
            </button>
          )}
          {onToggleDiff && (
            <button
              className={`acp-diff-btn ${diffEnabled ? 'active' : ''}`}
              onClick={onToggleDiff}
              title={diffEnabled ? 'Disable Diff Mode' : 'Enable Diff Mode'}
            >
              <AcpIcons.Diff />
            </button>
          )}
          <button
            className="acp-settings-btn"
            onClick={onOpenSettings}
            title="Agent settings"
          >
            <AcpIcons.Settings />
          </button>
        </div>
      </div>

      <div className="acp-dialog-content">
        <div className="acp-dialog-messages" ref={contentRef}>
          <div className="acp-dialog-messages-inner">
            <AcpMessages
              messages={messages}
              toolCalls={toolCalls}
              expandedToolCalls={expandedToolCalls}
              expandedToolResults={expandedToolResults}
              expandedThoughts={expandedThoughts}
              expandedPermissions={expandedPermissions}
              onToggleToolCall={toggleToolCall}
              onToggleToolResult={toggleToolResult}
              onToggleThought={toggleThought}
              onTogglePermission={togglePermission}
              onPermissionResponse={(permissionId, optionId) => onPermissionResponse(agentId, permissionId, optionId)}
              onUndoMessage={(message) => onUndoPrompt(agentId, message.checkpoint_id, message.content)}
            />
          </div>
        </div>
        {!autoScrollEnabled && (
          <button
            className="acp-scroll-to-bottom-btn"
            onClick={enableAutoScroll}
            title="Enable auto-scroll"
            aria-label="Enable auto-scroll"
          >
            <AcpIcons.ScrollDown />
          </button>
        )}
      </div>

      <AcpInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        onCancel={() => onCancelPrompt(agentId)}
        isConnected={isConnected}
        isProcessing={isProcessing}
      />
    </div>
  );
};
