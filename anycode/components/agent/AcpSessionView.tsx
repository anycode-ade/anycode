import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AcpMessage,
  type AcpContextUsageMessage,
  type AcpModelSelectorMessage,
  type AcpReasoningSelectorMessage,
  type AcpSelectOption,
} from '../../types';
import { AcpInput } from './AcpInput';
import { AcpMessages } from './AcpMessages';
import { AcpIcons } from './AcpIcons';

const useAutoScroll = (messages: AcpMessage[], isProcessing: boolean) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const lastScrollTopRef = useRef<number>(0);
  const isProgrammaticScrollRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const checkIfScrolledToBottom = (element: HTMLElement): boolean => (
    element.scrollHeight - element.scrollTop - element.clientHeight <= 48
  );

  const setAutoScroll = (enabled: boolean) => {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabled((prev) => (prev === enabled ? prev : enabled));
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

  const toggle = useCallback((index: number) => {
    setExpanded((prev) => {
      const newSet = new Set(prev);
      newSet.has(index) ? newSet.delete(index) : newSet.add(index);
      return newSet;
    });
  }, []);

  return { expanded, toggle };
};

interface AcpSessionViewProps {
  agentId: string;
  title: string;
  isActivePane: boolean;
  isConnected: boolean;
  isProcessing?: boolean;
  messages: AcpMessage[];
  modelSelector?: Omit<AcpModelSelectorMessage, 'role'>;
  reasoningSelector?: Omit<AcpReasoningSelectorMessage, 'role'>;
  contextUsage?: Omit<AcpContextUsageMessage, 'role'>;
  onFocusPane: () => void;
  onSendPrompt: (agentId: string, prompt: string) => void;
  onCancelPrompt: (agentId: string) => void;
  onPermissionResponse: (agentId: string, permissionId: string, optionId: string) => void;
  onUndoPrompt: (agentId: string, checkpointId?: string, prompt?: string) => void;
  onCloseAgent: (agentId: string) => void;
  onSelectModel?: (agentId: string, option: AcpSelectOption) => void;
  onSelectReasoning?: (agentId: string, option: AcpSelectOption) => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}

export const AcpSessionView: React.FC<AcpSessionViewProps> = ({
  agentId,
  title,
  isActivePane,
  isConnected,
  isProcessing = false,
  messages,
  modelSelector,
  reasoningSelector,
  contextUsage,
  onFocusPane,
  onSendPrompt,
  onCancelPrompt,
  onPermissionResponse,
  onUndoPrompt,
  onCloseAgent,
  onSelectModel,
  onSelectReasoning,
  onOpenFile,
  onOpenFileDiff,
}) => {
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const { expanded: expandedToolCalls, toggle: toggleToolCall } = useExpandableItems();
  const { expanded: expandedToolResults, toggle: toggleToolResult } = useExpandableItems();
  const { expanded: expandedThoughts, toggle: toggleThought } = useExpandableItems();
  const { expanded: expandedPermissions, toggle: togglePermission } = useExpandableItems();
  const { contentRef, autoScrollEnabled, enableAutoScroll } = useAutoScroll(messages, isProcessing);

  const handlePermissionResponse = useCallback(
    (permissionId: string, optionId: string) => onPermissionResponse(agentId, permissionId, optionId),
    [agentId, onPermissionResponse],
  );

  const handleUndoMessage = useCallback(
    (message: AcpMessage) => {
      if (message.role !== 'user') return;
      onUndoPrompt(agentId, message.checkpoint_id, message.content);
    },
    [agentId, onUndoPrompt],
  );

  const inputValue = inputValues[agentId] ?? '';

  const handleInputChange = useCallback((value: string) => {
    setInputValues((prev) => {
      if ((prev[agentId] ?? '') === value) {
        return prev;
      }

      return {
        ...prev,
        [agentId]: value,
      };
    });
  }, [agentId]);

  const handleSend = () => {
    if (inputValue.trim() && isConnected) {
      onSendPrompt(agentId, inputValue.trim());
      setInputValues((prev) => {
        if ((prev[agentId] ?? '') === '') {
          return prev;
        }

        return {
          ...prev,
          [agentId]: '',
        };
      });
    }
  };

  return (
    <div
      className={`acp-pane-session ${isActivePane ? 'active' : ''}`}
      onMouseDown={onFocusPane}
    >
      <div className="acp-dialog-content">
        <div className="acp-dialog-messages" ref={contentRef}>
          <div className="acp-dialog-messages-inner">
            <AcpMessages
              messages={messages}
              toolCalls={[]}
              expandedToolCalls={expandedToolCalls}
              expandedToolResults={expandedToolResults}
              expandedThoughts={expandedThoughts}
              expandedPermissions={expandedPermissions}
              onToggleToolCall={toggleToolCall}
              onToggleToolResult={toggleToolResult}
              onToggleThought={toggleThought}
              onTogglePermission={togglePermission}
              onPermissionResponse={handlePermissionResponse}
              onUndoMessage={handleUndoMessage}
              onOpenFile={onOpenFile}
              onOpenFileDiff={onOpenFileDiff}
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
        onChange={handleInputChange}
        onSend={handleSend}
        onCancel={() => onCancelPrompt(agentId)}
        agentLabel={title}
        onCloseAgent={() => onCloseAgent(agentId)}
        isConnected={isConnected}
        isProcessing={isProcessing}
        modelSelector={modelSelector}
        reasoningSelector={reasoningSelector}
        contextUsage={contextUsage}
        onSelectModel={(option) => onSelectModel?.(agentId, option)}
        onSelectReasoning={(option) => onSelectReasoning?.(agentId, option)}
      />
    </div>
  );
};
