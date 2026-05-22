import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AcpMessage,
  type AcpContextUsageMessage,
  type AcpModelSelectorMessage,
  type AcpReasoningSelectorMessage,
  type AcpSelectOption,
} from '../../types';
import './AcpSession.css';
import { AcpInput } from './AcpInput';
import { AcpMessages } from './AcpMessages';
import { AcpIcons } from './AcpIcons';
import { loadItem, saveItem } from '../../storage';

const ACP_INPUT_DRAFTS_STORAGE_KEY = 'acpInputDrafts';

const useAutoScroll = (messages: AcpMessage[], isProcessing: boolean) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const lastScrollTopRef = useRef<number>(0);
  const lastTouchYRef = useRef<number | null>(null);
  const pointerScrollStartRef = useRef<number | null>(null);
  const userScrollUpIntentRef = useRef(false);
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

    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
    lastScrollTopRef.current = element.scrollTop;
  };

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const noteUserScrollIntent = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        userScrollUpIntentRef.current = true;
      }
    };

    const noteTouchStart = () => {
      userScrollUpIntentRef.current = false;
      lastTouchYRef.current = null;
    };

    const noteTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      const previousY = lastTouchYRef.current;
      lastTouchYRef.current = currentY ?? null;

      if (currentY !== undefined && previousY !== null && currentY > previousY) {
        userScrollUpIntentRef.current = true;
      }
    };

    const notePointerDown = (event: PointerEvent) => {
      if (event.target !== contentElement) {
        return;
      }

      pointerScrollStartRef.current = contentElement.scrollTop;
    };

    const notePointerUp = () => {
      pointerScrollStartRef.current = null;
    };

    const noteKeyboardScrollIntent = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        event.key === 'Home'
      ) {
        userScrollUpIntentRef.current = true;
      }
    };

    const handleScroll = () => {
      const currentScrollTop = contentElement.scrollTop;
      const delta = currentScrollTop - lastScrollTopRef.current;
      const scrollDirection = delta < -1 ? 'up' : delta > 1 ? 'down' : 'none';

      const pointerDraggedUp =
        pointerScrollStartRef.current !== null &&
        currentScrollTop < pointerScrollStartRef.current - 1;

      if (scrollDirection === 'up' && (userScrollUpIntentRef.current || pointerDraggedUp)) {
        setAutoScroll(false);
      }

      if (checkIfScrolledToBottom(contentElement)) {
        setAutoScroll(true);
      }

      userScrollUpIntentRef.current = false;
      lastScrollTopRef.current = currentScrollTop;
    };

    contentElement.addEventListener('wheel', noteUserScrollIntent, { passive: true });
    contentElement.addEventListener('touchstart', noteTouchStart, { passive: true });
    contentElement.addEventListener('touchmove', noteTouchMove, { passive: true });
    contentElement.addEventListener('pointerdown', notePointerDown);
    window.addEventListener('pointerup', notePointerUp);
    contentElement.addEventListener('keydown', noteKeyboardScrollIntent);
    contentElement.addEventListener('scroll', handleScroll);
    lastScrollTopRef.current = contentElement.scrollTop;
    return () => {
      contentElement.removeEventListener('wheel', noteUserScrollIntent);
      contentElement.removeEventListener('touchstart', noteTouchStart);
      contentElement.removeEventListener('touchmove', noteTouchMove);
      contentElement.removeEventListener('pointerdown', notePointerDown);
      window.removeEventListener('pointerup', notePointerUp);
      contentElement.removeEventListener('keydown', noteKeyboardScrollIntent);
      contentElement.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (autoScrollEnabledRef.current && contentRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom('auto');
      });
    }
  }, [messages, isProcessing]);

  useEffect(() => {
    const innerElement = innerRef.current;
    if (!innerElement) return;

    const observer = new ResizeObserver(() => {
      if (!autoScrollEnabledRef.current) return;

      requestAnimationFrame(() => {
        scrollToBottom('auto');
      });
    });

    observer.observe(innerElement);
    return () => observer.disconnect();
  }, []);

  const enableAutoScroll = () => {
    setAutoScroll(true);

    requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
  };

  return { contentRef, innerRef, autoScrollEnabled, enableAutoScroll };
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

interface AcpSessionProps {
  agentId: string;
  title: string;
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

export const AcpSession: React.FC<AcpSessionProps> = ({
  agentId,
  title,
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
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const savedDrafts = loadItem<Record<string, unknown>>(ACP_INPUT_DRAFTS_STORAGE_KEY);
    if (!savedDrafts || typeof savedDrafts !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(savedDrafts).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>;
  });
  const { expanded: expandedToolCalls, toggle: toggleToolCall } = useExpandableItems();
  const { expanded: expandedToolResults, toggle: toggleToolResult } = useExpandableItems();
  const { expanded: expandedThoughts, toggle: toggleThought } = useExpandableItems();
  const { expanded: expandedPermissions, toggle: togglePermission } = useExpandableItems();
  const { contentRef, innerRef, autoScrollEnabled, enableAutoScroll } = useAutoScroll(messages, isProcessing);

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

  useEffect(() => {
    const nonEmptyDrafts = Object.fromEntries(
      Object.entries(inputValues).filter(([, draft]) => draft.length > 0),
    );
    saveItem(ACP_INPUT_DRAFTS_STORAGE_KEY, nonEmptyDrafts);
  }, [inputValues]);

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
      className="acp-session"
      onMouseDown={onFocusPane}
    >
      <div className="acp-session-content">
        <div className="acp-messages" ref={contentRef}>
          <div className="acp-messages-inner" ref={innerRef}>
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
