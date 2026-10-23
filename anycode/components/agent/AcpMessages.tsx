import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  AcpMessage as AcpMessageType,
  AcpToolCall,
  AcpToolResultMessage,
  AcpToolUpdateMessage,
  AcpUserMessage,
  type AgentPromptTemplate,
} from '../../types';
import { AcpMessage, getToolResultImages, type ToolResultImage } from './AcpMessage';
import { AcpWorkGroup } from './AcpWorkGroup';
import { AcpEmptyTemplates } from './AcpEmptyTemplates';
import { AcpAvatar } from './AcpAvatar';
import './AcpMessages.css';

interface AcpMessagesProps {
  messages: AcpMessageType[];
  toolCalls: AcpToolCall[];
  expandedToolCalls: Set<number>;
  expandedToolResults: Set<number>;
  expandedThoughts: Set<number>;
  activeSearchMessageIndex?: number;
  onWorkGroupExpansionChange?: () => void;
  onUserMessageToggle?: () => void;
  onToggleToolCall: (index: number) => void;
  onToggleToolResult: (index: number) => void;
  onToggleThought: (index: number) => void;
  onUndoMessage?: (message: AcpUserMessage) => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
  onSelectTemplate?: (template: AgentPromptTemplate, sendImmediately?: boolean) => void;
  onOpenSettings?: () => void;
  agentTitle?: string;
  agentId?: string;
  agentAuthors?: string[];
  agentWorking?: boolean;
  onGetToolOutput?: (toolId: string, sessionId?: string) => Promise<string | null>;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  // Called after this component moves scrollTop itself, so the scroll handler doesn't read the move as the user's.
  onScrollPositionSet: () => void;
}


interface AcpTurnProps extends React.HTMLAttributes<HTMLDivElement> {
  // Read once on mount: only turns created after the list has rendered fade in.
  animateEnter: boolean;
}

const AcpTurn: React.FC<AcpTurnProps> = ({ animateEnter, className, children, ...rest }) => {
  const [isEntering] = useState(animateEnter);
  return (
    <div className={`${className ?? ''}${isEntering ? ' acp-turn-enter' : ''}`} {...rest}>
      {children}
    </div>
  );
};

type WorkEntry = { index: number; message: AcpMessageType };

// One row of the list: a user message, or an agent response with all its work groups and text.
type TurnItem =
  | { type: 'message'; key: string; index: number; message: AcpMessageType }
  | { type: 'group'; key: string; messages: WorkEntry[]; isLatest: boolean };

// Estimated height of a turn, including its bottom margin, until it has been measured once.
const ESTIMATED_TURN_HEIGHT = 240;
// Turns mounted beyond the viewport edges, so small scrolls don't mount and unmount them.
const WINDOW_OVERSCAN_PX = 1200;

// Index of the last turn whose top edge is at or above y.
const turnAt = (offsets: Float64Array, y: number, count: number) => {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= y) low = mid;
    else high = mid - 1;
  }
  return low;
};

// Turns [start, end) that intersect the viewport, plus overscan.
const turnWindowFor = (offsets: Float64Array, count: number, scrollTop: number, viewportHeight: number) => ({
  start: turnAt(offsets, Math.max(0, scrollTop - WINDOW_OVERSCAN_PX), count),
  end: Math.min(count, turnAt(offsets, scrollTop + viewportHeight + WINDOW_OVERSCAN_PX, count) + 1),
});

// Turns [start, end) holding either end of the browser selection, or null when nothing is selected in a turn.
// The browser drops selected nodes that unmount, so every turn between the two ends must stay mounted.
const selectedTurnSpan = (indexByKey: Map<string, number>) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  let first = Infinity;
  let last = -1;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = node instanceof Element ? node : node?.parentElement;
    const key = element?.closest<HTMLElement>('[data-turn-key]')?.dataset.turnKey;
    const index = key === undefined ? undefined : indexByKey.get(key);
    if (index === undefined) continue;
    first = Math.min(first, index);
    last = Math.max(last, index);
  }
  return last < 0 ? null : { start: first, end: last + 1 };
};

const getBoxHeight = (element: HTMLElement) =>
  element.offsetHeight + (parseFloat(getComputedStyle(element).marginBottom) || 0);

type WorkSegment =
  | { type: 'tools'; messages: WorkEntry[] }
  | { type: 'images'; toolCallId: string; images: ToolResultImage[] }
  | { type: 'message'; index: number; message: AcpMessageType };

const isToolMessage = (message: AcpMessageType) =>
  message.role === 'tool_call' || message.role === 'tool_result' || message.role === 'tool_update';

// Only consecutive tool messages collapse into a work group. Other agent messages stay
// visible, and a tool's images are placed after its work group as their own segment.
const splitIntoSegments = (
  entries: WorkEntry[],
  toolResultsById: Map<string, { message: AcpToolResultMessage; index: number }>,
): WorkSegment[] => {
  const segments: WorkSegment[] = [];
  for (const entry of entries) {
    const { index, message } = entry;
    if (!isToolMessage(message)) {
      segments.push({ type: 'message', index, message });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.type === 'tools') {
      last.messages.push(entry);
    } else {
      segments.push({ type: 'tools', messages: [entry] });
    }
    if (message.role === 'tool_call') {
      const resultEntry = toolResultsById.get(message.id);
      const images = resultEntry && resultEntry.index > index ? getToolResultImages(resultEntry.message.result) : [];
      if (images.length > 0) {
        segments.push({ type: 'images', toolCallId: message.id, images });
      }
    }
  }
  return segments;
};

const AcpMessagesComponent: React.FC<AcpMessagesProps> = ({
  messages,
  toolCalls,
  expandedToolCalls,
  expandedToolResults,
  expandedThoughts,
  activeSearchMessageIndex,
  onWorkGroupExpansionChange,
  onUserMessageToggle,
  onToggleToolCall,
  onToggleToolResult,
  onToggleThought,
  onUndoMessage,
  onOpenFile,
  onOpenFileDiff,
  onSelectTemplate,
  onOpenSettings,
  agentTitle,
  agentId,
  agentAuthors,
  agentWorking,
  onGetToolOutput,
  scrollerRef,
  onScrollPositionSet,
}) => {
  const hasRenderedRef = useRef(false);
  useEffect(() => {
    hasRenderedRef.current = true;
  }, []);

  // Indexes committed so far. A message that remounts (e.g. text moving into a work group
  // when a tool call arrives) must not replay its entrance animation.
  const committedMessageIndexesRef = useRef(new Set<number>());
  useEffect(() => {
    for (let i = 0; i < messages.length; i++) {
      committedMessageIndexesRef.current.add(i);
    }
  }, [messages]);

  const {
    toolCallIndexesById,
    toolResultsById,
    toolUpdatesById,
    toolResultIndexesToSkip,
    toolUpdateIndexesToSkip,
  } = useMemo(() => {
    const nextToolCallIndexesById = new Map<string, number>();
    const nextToolResultsById = new Map<string, { message: AcpToolResultMessage; index: number }>();
    const nextToolUpdatesById = new Map<string, Array<{ message: AcpToolUpdateMessage; index: number }>>();

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role === 'tool_call') {
        if (!nextToolCallIndexesById.has(message.id)) {
          nextToolCallIndexesById.set(message.id, i);
        }
      } else if (message.role === 'tool_result') {
        nextToolResultsById.set(message.id, { message, index: i });
      } else if (message.role === 'tool_update') {
        const existingUpdates = nextToolUpdatesById.get(message.id) ?? [];
        existingUpdates.push({ message, index: i });
        nextToolUpdatesById.set(message.id, existingUpdates);
      }
    }

    const nextToolResultIndexesToSkip = new Set<number>();
    const nextToolUpdateIndexesToSkip = new Set<number>();

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role === 'tool_result') {
        const toolCallIndex = nextToolCallIndexesById.get(message.id);
        if (toolCallIndex !== undefined && toolCallIndex < i) {
          nextToolResultIndexesToSkip.add(i);
        }
      } else if (message.role === 'tool_update') {
        const toolCallIndex = nextToolCallIndexesById.get(message.id);
        if (toolCallIndex !== undefined && toolCallIndex < i) {
          nextToolUpdateIndexesToSkip.add(i);
        }
      }
    }

    return {
      toolCallIndexesById: nextToolCallIndexesById,
      toolResultsById: nextToolResultsById,
      toolUpdatesById: nextToolUpdatesById,
      toolResultIndexesToSkip: nextToolResultIndexesToSkip,
      toolUpdateIndexesToSkip: nextToolUpdateIndexesToSkip,
    };
  }, [messages]);

  const groupedItems = useMemo(() => {
    const items: TurnItem[] = [];

    let currentGroup: Array<{ index: number; message: AcpMessageType }> | null = null;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];

      // Skip rendering if they are meant to be skipped
      if (message.role === 'tool_result' && toolResultIndexesToSkip.has(i)) {
        continue;
      }
      if (message.role === 'tool_update' && toolUpdateIndexesToSkip.has(i)) {
        continue;
      }

      if (message.role !== 'user') {
        if (!currentGroup) {
          currentGroup = [];
        }
        currentGroup.push({ index: i, message });
      } else {
        if (currentGroup && currentGroup.length > 0) {
          items.push({ type: 'group', key: `turn-group-${items.length}`, messages: currentGroup, isLatest: false });
          currentGroup = null;
        }
        items.push({ type: 'message', key: `turn-${i}`, index: i, message });
      }
    }

    if (currentGroup && currentGroup.length > 0) {
      // A group is latest only when it is the final item. If a user message
      // was just sent, the previous work group must remain historical and
      // collapse immediately while the new response is pending.
      items.push({ type: 'group', key: `turn-group-${items.length}`, messages: currentGroup, isLatest: true });
    } else if (agentWorking && items[items.length - 1]?.type !== 'group') {
      // Empty turn for the response that is about to stream. Reserving it here keeps
      // the working avatar on one element, so its pulse doesn't restart when text arrives.
      items.push({ type: 'group', key: `turn-group-${items.length}`, messages: [], isLatest: true });
    }

    return items;
  }, [messages, toolResultIndexesToSkip, toolUpdateIndexesToSkip, agentWorking]);

  const renderMessage = (message: AcpMessageType, index: number) => {
    let isExpanded = false;
    let onToggle: (() => void) | undefined = undefined;
    let toolResult: AcpToolResultMessage | undefined = undefined;
    let toolUpdates: AcpToolUpdateMessage[] | undefined = undefined;

    if (message.role === 'tool_call') {
      isExpanded = expandedToolCalls.has(index);
      onToggle = () => onToggleToolCall(index);
      const toolResultEntry = toolResultsById.get(message.id);
      if (toolResultEntry && toolResultEntry.index > index) {
        toolResult = toolResultEntry.message;
      }
      const toolUpdateEntries = toolUpdatesById.get(message.id) ?? [];
      toolUpdates = toolUpdateEntries
        .filter((entry) => entry.index > index)
        .map((entry) => entry.message);
    } else if (message.role === 'tool_result') {
      isExpanded = expandedToolResults.has(index);
      onToggle = () => onToggleToolResult(index);
    } else if (message.role === 'tool_update') {
      isExpanded = expandedToolResults.has(index);
      onToggle = () => onToggleToolResult(index);
    } else if (message.role === 'thought') {
      isExpanded = expandedThoughts.has(index);
      onToggle = () => onToggleThought(index);
    }

    const animateEnter = hasRenderedRef.current && !committedMessageIndexesRef.current.has(index);

    return (
      <div
        key={index}
        className="acp-message-search-target"
        data-message-index={index}
      >
        <AcpMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
          toolResult={toolResult}
          toolUpdates={toolUpdates}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
          onUserMessageToggle={onUserMessageToggle}
          onGetToolOutput={onGetToolOutput}
          animateEnter={animateEnter}
          onUndo={
            message.role === 'user' && onUndoMessage
              ? () => onUndoMessage(message)
              : undefined
          }
        />
      </div>
    );
  };

  const renderTurnContent = (entries: WorkEntry[], isLatest: boolean) => {
    const segments = splitIntoSegments(entries, toolResultsById);
    return segments.map((segment, segmentIndex) => {
      if (segment.type === 'tools') {
        const workKey = `work-${segment.messages[0].index}`;
        const isSegmentLatest = isLatest && segmentIndex === segments.length - 1;
        const stored = groupExpansionRef.current.get(workKey);
        return (
          <AcpWorkGroup
            key={workKey}
            storedExpanded={stored?.isLatest === isSegmentLatest ? stored.expanded : undefined}
            onExpandedChange={(expanded) => groupExpansionRef.current.set(workKey, { expanded, isLatest: isSegmentLatest })}
            isLatest={isSegmentLatest}
            messageCount={segment.messages.filter(({ message }) => message.role === 'tool_call').length}
            searchActive={activeSearchMessageIndex !== undefined}
            isSearchMatch={segment.messages.some(({ index }) => index === activeSearchMessageIndex)}
            onExpansionChange={onWorkGroupExpansionChange}
          >
            {segment.messages.map((m) => renderMessage(m.message, m.index))}
          </AcpWorkGroup>
        );
      }
      if (segment.type === 'images') {
        return (
          <div key={`images-${segment.toolCallId}`} className="acp-message acp-message-assistant">
            <div className="acp-message-content">
              {segment.images.map((image, imageIndex) => (
                <img
                  key={imageIndex}
                  className="acp-tool-result-image"
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt="Tool result image"
                />
              ))}
            </div>
          </div>
        );
      }
      return (
        <React.Fragment key={`message-${segment.index}`}>
          {renderMessage(segment.message, segment.index)}
        </React.Fragment>
      );
    });
  };

  // Turns are virtualized: only those near the viewport are mounted, the rest are spacers. A turn's
  // height is measured once it mounts and cached by its key, so the cache survives unmounting.
  const turnCount = groupedItems.length;
  const turnHeightsRef = useRef(new Map<string, number>());
  const [heightsVersion, setHeightsVersion] = useState(0);
  const [turnRange, setTurnRange] = useState({ start: 0, end: 0 });
  const layoutRef = useRef({ offsets: new Float64Array(1), count: 0, indexByKey: new Map<string, number>() });
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const seenTurnKeysRef = useRef(new Set<string>());
  // A user's work-group toggle lives here, not in the group, so it survives the group unmounting.
  // It only applies while the group keeps its latest/historical state; otherwise the default wins.
  const groupExpansionRef = useRef(new Map<string, { expanded: boolean; isLatest: boolean }>());

  const turnOffsets = useMemo(() => {
    const offsets = new Float64Array(turnCount + 1);
    for (let i = 0; i < turnCount; i += 1) {
      offsets[i + 1] = offsets[i] + (turnHeightsRef.current.get(groupedItems[i].key) ?? ESTIMATED_TURN_HEIGHT);
    }
    return offsets;
  }, [groupedItems, turnCount, heightsVersion]);

  const updateTurnRange = useCallback(() => {
    const scroller = scrollerRef.current;
    const { offsets, count, indexByKey } = layoutRef.current;
    if (!scroller || count === 0) return;
    const viewport = turnWindowFor(offsets, count, scroller.scrollTop, scroller.clientHeight);
    const selected = selectedTurnSpan(indexByKey);
    const next = selected
      ? { start: Math.min(viewport.start, selected.start), end: Math.max(viewport.end, selected.end) }
      : viewport;
    setTurnRange((current) => (current.start === next.start && current.end === next.end ? current : next));
  }, [scrollerRef]);

  useLayoutEffect(() => {
    const indexByKey = new Map(groupedItems.map((item, index) => [item.key, index]));
    layoutRef.current = { offsets: turnOffsets, count: turnCount, indexByKey };
    updateTurnRange();
  }, [groupedItems, turnOffsets, turnCount, updateTurnRange]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const resizeObserver = new ResizeObserver(() => updateTurnRange());
    resizeObserver.observe(scroller);
    scroller.addEventListener('scroll', updateTurnRange, { passive: true });
    // Dragging a selection past the mounted turns changes it without any scroll event.
    document.addEventListener('selectionchange', updateTurnRange);
    return () => {
      scroller.removeEventListener('scroll', updateTurnRange);
      document.removeEventListener('selectionchange', updateTurnRange);
      resizeObserver.disconnect();
    };
  }, [scrollerRef, updateTurnRange]);

  // Measures rows, stores their heights, and offsets the scroll position for changes above the viewport.
  // Returns true when any height changed.
  const measureRows = useCallback((rows: HTMLElement[]) => {
    const scroller = scrollerRef.current;
    if (!scroller) return false;
    const viewportTop = scroller.getBoundingClientRect().top;
    let changed = false;
    let scrollCompensation = 0;
    for (const row of rows) {
      const key = row.dataset.turnKey ?? '';
      const previous = turnHeightsRef.current.get(key) ?? ESTIMATED_TURN_HEIGHT;
      const next = getBoxHeight(row);
      if (next === previous) continue;
      turnHeightsRef.current.set(key, next);
      changed = true;
      // A row that ends above the viewport (after its change) shifts the visible content by the change.
      // Rows reaching into the viewport keep their top, so they are not offset.
      if (row.getBoundingClientRect().top + next <= viewportTop) {
        scrollCompensation += next - previous;
      }
    }
    if (scrollCompensation !== 0) {
      scroller.scrollTop += scrollCompensation;
      onScrollPositionSet();
    }
    return changed;
  }, [scrollerRef, onScrollPositionSet]);

  // Height changes outside a React commit (images, fonts, resizes) are caught by the ResizeObserver.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver((entries) => {
      const rows: HTMLElement[] = [];
      for (const entry of entries) {
        const row = entry.target as HTMLElement;
        if (row.isConnected) rows.push(row);
        else observer.unobserve(row);
      }
      if (measureRows(rows)) flushSync(() => setHeightsVersion((version) => version + 1));
    });
    rowObserverRef.current = observer;
    return () => observer.disconnect();
  }, [scrollerRef, measureRows]);

  // Runs after every commit, before paint: rows that just mounted are measured in the same frame, so the
  // scroll compensation for rows above the viewport doesn't lag one frame behind the new layout.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-turn-key]'));
    rows.forEach((row) => rowObserverRef.current?.observe(row));
    if (measureRows(rows)) setHeightsVersion((version) => version + 1);
  });

  const activeSearchTurn = useMemo(() => {
    if (activeSearchMessageIndex === undefined) return -1;
    return groupedItems.findIndex((item) => (
      item.type === 'message'
        ? item.index === activeSearchMessageIndex
        : item.messages.some((entry) => entry.index === activeSearchMessageIndex)
    ));
  }, [activeSearchMessageIndex, groupedItems]);

  // A search match can sit in a turn outside the window. Bring that turn into the window before the
  // search highlight effect in AcpSession looks up its DOM node. The key (not the groupedItems array)
  // is the dependency, so streaming updates don't pull the viewport back to the match.
  const activeSearchTurnKey = activeSearchTurn >= 0 ? groupedItems[activeSearchTurn].key : undefined;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const { offsets, count } = layoutRef.current;
    if (!scroller || activeSearchTurnKey === undefined || count === 0) return;
    // Already mounted: AcpSession centers the exact match itself.
    if (scroller.querySelector(`[data-turn-key="${activeSearchTurnKey}"]`)) return;
    const scrollTop = Math.max(0, offsets[activeSearchTurn] - scroller.clientHeight / 2);
    scroller.scrollTop = scrollTop;
    onScrollPositionSet();
    setTurnRange(turnWindowFor(offsets, count, scrollTop, scroller.clientHeight));
  }, [activeSearchMessageIndex, activeSearchTurn, activeSearchTurnKey, scrollerRef, onScrollPositionSet]);

  // Only turns created after the list has rendered fade in. Turns that merely re-mount on scroll don't.
  useEffect(() => {
    for (const item of groupedItems) seenTurnKeysRef.current.add(item.key);
  }, [groupedItems]);

  const renderTurn = (item: TurnItem, idx: number) => {
    const isLatestAgentTurn = agentWorking && idx === turnCount - 1;
    const animateEnter = hasRenderedRef.current && !seenTurnKeysRef.current.has(item.key);
    if (item.type === 'message') {
      const isUser = item.message.role === 'user';
      return (
        <AcpTurn
          key={item.key}
          data-turn-key={item.key}
          animateEnter={animateEnter}
          className={`acp-turn ${isUser ? 'acp-turn-user' : 'acp-turn-agent'}${!isUser && isLatestAgentTurn ? ' acp-turn-agent-working' : ''}`}
        >
          <div className="acp-turn-avatar">
            <AcpAvatar
              type={isUser ? 'user' : 'agent'}
              agentTitle={agentTitle}
              agentId={agentId}
            />
          </div>
          <div className="acp-turn-content">
            {renderMessage(item.message, item.index)}
          </div>
        </AcpTurn>
      );
    }
    const isPending = isLatestAgentTurn && item.messages.length === 0;
    return (
      <AcpTurn
        key={item.key}
        data-turn-key={item.key}
        animateEnter={animateEnter}
        className={`acp-turn acp-turn-agent${isLatestAgentTurn ? ' acp-turn-agent-working' : ''}`}
        role={isPending ? 'status' : undefined}
        aria-label={isPending ? 'Agent is working' : undefined}
      >
        <div className="acp-turn-avatar">
          <AcpAvatar
            type="agent"
            agentTitle={agentTitle}
            agentId={agentId}
          />
        </div>
        <div className="acp-turn-content">
          {renderTurnContent(item.messages, item.isLatest)}
        </div>
      </AcpTurn>
    );
  };

  // Early return must come after all hooks: messages can go from empty to non-empty on the same instance.
  if (messages.length === 0) {
    return (
      <div className="acp-empty-state">
        {onSelectTemplate ? (
          <AcpEmptyTemplates
            onSelectTemplate={onSelectTemplate}
            onOpenSettings={onOpenSettings}
            agentId={agentId}
            agentTitle={agentTitle}
            agentAuthors={agentAuthors}
          />
        ) : (
          <p>No messages yet. Start a conversation with the agent.</p>
        )}
      </div>
    );
  }

  const { start, end } = turnRange;
  const lastTurn = turnCount - 1;
  // The last turn is still streaming and holds the working avatar, so it stays mounted outside the window.
  const pinLastTurn = turnCount > 0 && end < turnCount;
  const turnNodes: React.ReactNode[] = [
    <div key="spacer-top" className="acp-turn-spacer" aria-hidden="true" style={{ height: turnOffsets[start] }} />,
  ];
  for (let i = start; i < end; i += 1) {
    turnNodes.push(renderTurn(groupedItems[i], i));
  }
  if (pinLastTurn) {
    turnNodes.push(
      <div key="spacer-middle" className="acp-turn-spacer" aria-hidden="true" style={{ height: turnOffsets[lastTurn] - turnOffsets[end] }} />,
      renderTurn(groupedItems[lastTurn], lastTurn),
    );
  }

  return (
    <>
      {turnNodes}

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
    </>
  );
};

export const AcpMessages = React.memo(AcpMessagesComponent);
