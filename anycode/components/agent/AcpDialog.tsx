import React, { useState, useEffect, useRef } from 'react';
import { 
  AcpMessage, 
  AcpToolCall, 
  AcpSession,
  AcpAgent
} from '../../types';
import './AcpDialog.css';
import { AcpSettings } from './AcpSettings';
import { AcpAgentsList } from './AcpAgentsList';
import { AcpInput } from './AcpInput';
import { AcpMessages } from './AcpMessages';
import { AcpIcons } from './AcpIcons';

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
      } else if (scrollDirection === 'down' && checkIfScrolledToBottom(contentElement)) {
        userScrolledUpRef.current = false;
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
  onPermissionResponse: (agentId: string, permissionId: string, optionId: string) => void;
  onUndoPrompt: (agentId: string, checkpointId?: string, prompt?: string) => void;
  messages: AcpMessage[];
  toolCalls: AcpToolCall[];
  isConnected: boolean;
  isProcessing?: boolean;
  showSettings?: boolean;
  settingsAgents?: AcpAgent[];
  settingsDefaultAgentId?: string | null;
  onSaveSettings?: (agents: AcpAgent[], defaultAgentId: string | null) => void;
  onCloseSettings?: () => void;
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
  onSaveSettings,
  onCloseSettings,
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
  const contentRef = useAutoScroll(messages);

  if (!isOpen) return null;

  // If settings are shown, render settings dialog instead
  if (showSettings && onSaveSettings && onCloseSettings) {
    return (
      <div className="acp-dialog" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <AcpSettings
          agents={settingsAgents}
          defaultAgentId={settingsDefaultAgentId}
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

      <div className="acp-dialog-content" ref={contentRef}>
        <div className="acp-dialog-messages">
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
