import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AcpMessage,
  type AcpContextUsageMessage,
  type AcpModelSelectorMessage,
  type AcpPromptAttachment,
  type AcpReasoningSelectorMessage,
  type AcpSelectOption,
} from '../../types';
import './AcpSession.css';
import { AcpInput } from './AcpInput';
import { AcpMessages } from './AcpMessages';
import { AcpIcons } from './AcpIcons';
import { loadItem, saveItem } from '../../storage';
import { usePersistedScroll } from '../../hooks/usePersistedScroll';

const ACP_INPUT_DRAFTS_STORAGE_KEY = 'acpInputDrafts';
const EMPTY_ARRAY: any[] = [];

const findTextMatches = (messages: AcpMessage[], query: string) => {
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) return [];

  return messages.flatMap((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'thought') return [];
    let count = 0;
    let offset = message.content.toLowerCase().indexOf(normalizedQuery);
    while (offset >= 0) {
      count += 1;
      offset = message.content.toLowerCase().indexOf(normalizedQuery, offset + normalizedQuery.length);
    }
    return Array.from({ length: count }, (_, occurrence) => ({ messageIndex: index, occurrence }));
  });
};

const useAutoScroll = (messages: AcpMessage[], isProcessing: boolean, agentId: string) => {
  const contentRef = usePersistedScroll<HTMLDivElement>('agent-session-' + agentId, 'session', []);
  const innerRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const lastScrollTopRef = useRef<number>(0);
  const lastTouchYRef = useRef<number | null>(null);
  const pointerScrollStartRef = useRef<number | null>(null);
  const userScrollUpIntentRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const pendingAutoScrollRafRef = useRef<number | null>(null);
  const autoScrollScrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceScrollAfterUpdateRef = useRef(false);
  const wasProcessingRef = useRef(isProcessing);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const checkIfScrolledToBottom = (element: HTMLElement): boolean => (
    element.scrollHeight - element.scrollTop - element.clientHeight <= 48
  );

  const setAutoScroll = (enabled: boolean) => {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabled((prev) => (prev === enabled ? prev : enabled));
  };

  const disableAutoScrollImmediately = () => {
    autoScrollEnabledRef.current = false;
    setAutoScrollEnabled((prev) => (prev ? false : prev));
    contentRef.current?.classList.remove('acp-messages-auto-scrolling');
    if (autoScrollScrollbarTimerRef.current !== null) {
      clearTimeout(autoScrollScrollbarTimerRef.current);
      autoScrollScrollbarTimerRef.current = null;
    }
  };

  const hideScrollbarDuringAutoScroll = () => {
    const element = contentRef.current;
    if (!element) return;

    element.classList.add('acp-messages-auto-scrolling');
    if (autoScrollScrollbarTimerRef.current !== null) {
      clearTimeout(autoScrollScrollbarTimerRef.current);
    }
    autoScrollScrollbarTimerRef.current = setTimeout(() => {
      element.classList.remove('acp-messages-auto-scrolling');
      autoScrollScrollbarTimerRef.current = null;
    }, 180);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const element = contentRef.current;
    if (!element) return;

    hideScrollbarDuringAutoScroll();
    isProgrammaticScrollRef.current = true;
    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
    requestAnimationFrame(() => {
      lastScrollTopRef.current = element.scrollTop;
      isProgrammaticScrollRef.current = false;
    });
  };

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const noteUserScrollIntent = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        userScrollUpIntentRef.current = true;
        disableAutoScrollImmediately();
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
        disableAutoScrollImmediately();
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
        disableAutoScrollImmediately();
      }
    };

    const handleScroll = () => {
      const currentScrollTop = contentElement.scrollTop;
      const delta = currentScrollTop - lastScrollTopRef.current;
      const scrollDirection = delta < -1 ? 'up' : delta > 1 ? 'down' : 'none';
      const isAtBottom = checkIfScrolledToBottom(contentElement);

      const pointerDraggedUp =
        pointerScrollStartRef.current !== null &&
        currentScrollTop < pointerScrollStartRef.current - 1;

      if (
        !isProgrammaticScrollRef.current &&
        !isAtBottom &&
        scrollDirection === 'up' &&
        (userScrollUpIntentRef.current || pointerDraggedUp || delta < -1)
      ) {
        disableAutoScrollImmediately();
      }

      if (isAtBottom) {
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
    if (pendingAutoScrollRafRef.current !== null) {
      cancelAnimationFrame(pendingAutoScrollRafRef.current);
      pendingAutoScrollRafRef.current = null;
    }

    if (contentRef.current) {
      pendingAutoScrollRafRef.current = requestAnimationFrame(() => {
        pendingAutoScrollRafRef.current = null;
        if (!autoScrollEnabledRef.current) return;
        scrollToBottom('smooth');
      });
    }
  }, [messages, isProcessing]);

  useLayoutEffect(() => {
    if (!forceScrollAfterUpdateRef.current) return;

    forceScrollAfterUpdateRef.current = false;
    scrollToBottom('smooth');
  }, [messages, isProcessing]);

  useEffect(() => {
    const justFinishedProcessing = wasProcessingRef.current && !isProcessing;
    wasProcessingRef.current = isProcessing;
    if (!justFinishedProcessing || !autoScrollEnabledRef.current) return;

    let settleRaf = 0;
    const scrollAfterLayoutSettles = () => {
      settleRaf = requestAnimationFrame(() => {
        if (autoScrollEnabledRef.current) {
          scrollToBottom('smooth');
        }
      });
    };

    settleRaf = requestAnimationFrame(scrollAfterLayoutSettles);
    return () => cancelAnimationFrame(settleRaf);
  }, [isProcessing]);

  useEffect(() => {
    const innerElement = innerRef.current;
    if (!innerElement) return;

    const observer = new ResizeObserver(() => {
      if (!autoScrollEnabledRef.current) return;
      scrollToBottom('smooth');
    });

    observer.observe(innerElement);
    return () => observer.disconnect();
  }, []);

  const enableAutoScroll = () => {
    forceScrollAfterUpdateRef.current = true;
    setAutoScroll(true);

    requestAnimationFrame(() => {
      scrollToBottom('smooth');
    });
  };

  useEffect(() => () => {
    if (pendingAutoScrollRafRef.current !== null) {
      cancelAnimationFrame(pendingAutoScrollRafRef.current);
      pendingAutoScrollRafRef.current = null;
    }
    if (autoScrollScrollbarTimerRef.current !== null) {
      clearTimeout(autoScrollScrollbarTimerRef.current);
      autoScrollScrollbarTimerRef.current = null;
    }
    contentRef.current?.classList.remove('acp-messages-auto-scrolling');
  }, []);

  return {
    contentRef,
    innerRef,
    autoScrollEnabled,
    enableAutoScroll,
    disableAutoScroll: disableAutoScrollImmediately,
  };
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
  onSendPrompt: (agentId: string, prompt: string, attachments?: AcpPromptAttachment[]) => void;
  onCancelPrompt: (agentId: string) => void;
  onUndoPrompt: (agentId: string, checkpointId?: string, prompt?: string) => void;
  onCloseAgent: (agentId: string) => void;
  onSelectModel?: (agentId: string, option: AcpSelectOption) => void;
  onSelectReasoning?: (agentId: string, option: AcpSelectOption) => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}

const AcpSessionComponent: React.FC<AcpSessionProps> = ({
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
  onUndoPrompt,
  onCloseAgent,
  onSelectModel,
  onSelectReasoning,
  onOpenFile,
  onOpenFileDiff,
}) => {
  const sessionRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pointerInsideRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSearchMatch, setCurrentSearchMatch] = useState(0);
  const [searchRenderVersion, setSearchRenderVersion] = useState(0);
  const [showWorkingIndicator, setShowWorkingIndicator] = useState(isProcessing);
  const [isWorkingIndicatorExiting, setIsWorkingIndicatorExiting] = useState(false);
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
  const {
    contentRef,
    innerRef,
    autoScrollEnabled,
    enableAutoScroll,
    disableAutoScroll,
  } = useAutoScroll(messages, isProcessing, agentId);

  useEffect(() => {
    if (isProcessing) {
      setShowWorkingIndicator(true);
      setIsWorkingIndicatorExiting(false);
      return;
    }

    if (!showWorkingIndicator) return;

    setIsWorkingIndicatorExiting(true);
    const hideTimer = window.setTimeout(() => {
      setShowWorkingIndicator(false);
      setIsWorkingIndicatorExiting(false);
    }, 260);

    return () => window.clearTimeout(hideTimer);
  }, [isProcessing, showWorkingIndicator]);
  const searchMatches = useMemo(
    () => findTextMatches(messages, searchOpen ? searchQuery : ''),
    [messages, searchOpen, searchQuery],
  );
  const activeSearchMessageIndex = searchMatches[currentSearchMatch]?.messageIndex;
  const activeOccurrence = searchMatches[currentSearchMatch]?.occurrence ?? 0;
  const handleWorkGroupExpansionChange = useCallback(() => {
    disableAutoScroll();
    setSearchRenderVersion((version) => version + 1);
  }, [disableAutoScroll]);

  const handleToggleToolCall = useCallback((index: number) => {
    disableAutoScroll();
    toggleToolCall(index);
  }, [disableAutoScroll, toggleToolCall]);

  const handleToggleToolResult = useCallback((index: number) => {
    disableAutoScroll();
    toggleToolResult(index);
  }, [disableAutoScroll, toggleToolResult]);

  const handleToggleThought = useCallback((index: number) => {
    disableAutoScroll();
    toggleThought(index);
  }, [disableAutoScroll, toggleThought]);

  useEffect(() => {
    if (searchMatches.length === 0 || currentSearchMatch < searchMatches.length) return;
    setCurrentSearchMatch(0);
  }, [currentSearchMatch, searchMatches.length]);

  const searchExpandedThoughts = useMemo(() => {
    if (activeSearchMessageIndex === undefined || messages[activeSearchMessageIndex]?.role !== 'thought') {
      return expandedThoughts;
    }
    return new Set([...expandedThoughts, activeSearchMessageIndex]);
  }, [activeSearchMessageIndex, expandedThoughts, messages]);

  const moveSearch = useCallback((direction: number) => {
    if (searchMatches.length === 0) return;
    disableAutoScroll();
    setCurrentSearchMatch((current) => (
      (current + direction + searchMatches.length) % searchMatches.length
    ));
  }, [disableAutoScroll, searchMatches.length]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  const openSearch = useCallback(() => {
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText) {
      disableAutoScroll();
      setSearchQuery(selectedText);
      setCurrentSearchMatch(0);
    }
    setSearchOpen(true);
  }, [disableAutoScroll]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      const root = sessionRef.current;
      const isThisSessionActive = pointerInsideRef.current || !!root?.contains(document.activeElement);

      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        if (!isThisSessionActive) return;
        event.preventDefault();
        event.stopPropagation();
        openSearch();
        return;
      }

      if (event.key === 'Escape' && searchOpen && root?.contains(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      }
    };

    window.addEventListener('keydown', handleFindShortcut, true);
    return () => window.removeEventListener('keydown', handleFindShortcut, true);
  }, [closeSearch, openSearch, searchOpen]);

  useEffect(() => {
    const clearHighlights = () => {
      CSS.highlights.delete('acp-search-match');
      CSS.highlights.delete('acp-search-current');
    };

    if (activeSearchMessageIndex === undefined || !searchQuery) {
      clearHighlights();
      return;
    }

    const frame = requestAnimationFrame(() => {
      const messageTargets = innerRef.current
        ? Array.from(innerRef.current.querySelectorAll<HTMLElement>('[data-message-index]'))
        : [];
      if (messageTargets.length === 0) {
        clearHighlights();
        return;
      }

      const query = searchQuery.toLowerCase();
      const ranges: Range[] = [];
      let currentRange: Range | undefined;

      for (const target of messageTargets) {
        const messageIndex = Number(target.dataset.messageIndex);
        const targetRanges: Range[] = [];
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          // Do not search text that is present in the DOM but is not visible.
          // ACP messages contain collapsed/auxiliary controls whose text can
          // otherwise produce a misleading highlight.
          const parent = node.parentElement;
          const isVisible = !!parent && parent.getClientRects().length > 0;
          const text = isVisible ? node.textContent?.toLowerCase() ?? '' : '';
          let offset = text.indexOf(query);
          while (offset >= 0) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + query.length);
            targetRanges.push(range);
            offset = text.indexOf(query, offset + query.length);
          }
          node = walker.nextNode();
        }

        if (messageIndex === activeSearchMessageIndex) {
          currentRange = targetRanges[activeOccurrence];
        }
        ranges.push(...targetRanges);
      }
      clearHighlights();
      CSS.highlights.set('acp-search-match', new Highlight(...ranges));
      if (currentRange) {
        CSS.highlights.set('acp-search-current', new Highlight(currentRange));
      }

      const scroller = contentRef.current;
      if (scroller) {
        const activeTarget = messageTargets.find(
          (target) => Number(target.dataset.messageIndex) === activeSearchMessageIndex,
        );
        const matchRect = (currentRange ?? activeTarget)?.getBoundingClientRect();
        if (!matchRect) return;
        const scrollerRect = scroller.getBoundingClientRect();
        scroller.scrollTo({
          top: scroller.scrollTop + matchRect.top - scrollerRect.top
            - (scroller.clientHeight - matchRect.height) / 2,
          behavior: 'auto',
        });
      }
    });

    return () => {
      cancelAnimationFrame(frame);
      clearHighlights();
    };
  }, [activeOccurrence, activeSearchMessageIndex, contentRef, innerRef, searchQuery, searchRenderVersion]);

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

  const handleSend = useCallback((attachments: AcpPromptAttachment[] = []) => {
    if ((inputValue.trim() || attachments.length > 0) && isConnected) {
      enableAutoScroll();
      onSendPrompt(agentId, inputValue.trim(), attachments);
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
  }, [agentId, enableAutoScroll, inputValue, isConnected, onSendPrompt]);

  const handleCancel = useCallback(() => {
    onCancelPrompt(agentId);
  }, [agentId, onCancelPrompt]);

  const handleCloseAgent = useCallback(() => {
    onCloseAgent(agentId);
  }, [agentId, onCloseAgent]);

  const handleSelectModel = useCallback((option: AcpSelectOption) => {
    onSelectModel?.(agentId, option);
  }, [agentId, onSelectModel]);

  const handleSelectReasoning = useCallback((option: AcpSelectOption) => {
    onSelectReasoning?.(agentId, option);
  }, [agentId, onSelectReasoning]);

  return (
    <div
      ref={sessionRef}
      className="acp-session"
      onMouseDown={onFocusPane}
      onMouseEnter={() => { pointerInsideRef.current = true; }}
      onMouseLeave={() => { pointerInsideRef.current = false; }}
    >
      <div className="acp-session-content">
        {searchOpen ? (
          <div className="acp-search-bar" role="search">
            <AcpIcons.Search />
            <input
              ref={searchInputRef}
              className="acp-search-input"
              type="text"
              value={searchQuery}
              placeholder="Find in conversation"
              aria-label="Find in conversation"
              onChange={(event) => {
                disableAutoScroll();
                setCurrentSearchMatch(0);
                setSearchQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  moveSearch(event.shiftKey ? -1 : 1);
                }
              }}
            />
            <span className="acp-search-count" aria-live="polite">
              {searchQuery ? (
                searchMatches.length > 0
                  ? `${currentSearchMatch + 1} / ${searchMatches.length}`
                  : 'No results'
              ) : ''}
            </span>
            <button
              type="button"
              className="acp-search-action"
              onClick={() => moveSearch(-1)}
              disabled={searchMatches.length === 0}
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
            >
              <AcpIcons.ChevronUp />
            </button>
            <button
              type="button"
              className="acp-search-action"
              onClick={() => moveSearch(1)}
              disabled={searchMatches.length === 0}
              aria-label="Next match"
              title="Next match (Enter)"
            >
              <AcpIcons.ChevronDown />
            </button>
            <button
              type="button"
              className="acp-search-action"
              onClick={closeSearch}
              aria-label="Close search"
              title="Close search (Escape)"
            >
              <AcpIcons.CloseSmall />
            </button>
          </div>
        ) : null}
        <div className="acp-messages" ref={contentRef}>
          <div className="acp-messages-inner" ref={innerRef}>
            <AcpMessages
              messages={messages}
              toolCalls={EMPTY_ARRAY}
              expandedToolCalls={expandedToolCalls}
              expandedToolResults={expandedToolResults}
              expandedThoughts={searchExpandedThoughts}
              activeSearchMessageIndex={activeSearchMessageIndex}
              onWorkGroupExpansionChange={handleWorkGroupExpansionChange}
              onUserMessageToggle={disableAutoScroll}
              onToggleToolCall={handleToggleToolCall}
              onToggleToolResult={handleToggleToolResult}
              onToggleThought={handleToggleThought}
              onUndoMessage={handleUndoMessage}
              onOpenFile={onOpenFile}
              onOpenFileDiff={onOpenFileDiff}
            />
            {showWorkingIndicator && (
              <div
                className={`acp-chat-working${isWorkingIndicatorExiting ? ' acp-chat-working-exiting' : ''}`}
                role="status"
                aria-live="polite"
                aria-label="Agent is working"
              >
                <span className="acp-chat-working-dots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
            </div>
            )}
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
        onCancel={handleCancel}
        agentLabel={title}
        onCloseAgent={handleCloseAgent}
        isConnected={isConnected}
        isProcessing={isProcessing}
        showProcessingDots={!autoScrollEnabled}
        modelSelector={modelSelector}
        reasoningSelector={reasoningSelector}
        contextUsage={contextUsage}
        onSelectModel={handleSelectModel}
        onSelectReasoning={handleSelectReasoning}
      />
    </div>
  );
};

export const AcpSession = React.memo(AcpSessionComponent);
