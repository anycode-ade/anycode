import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    const items: Array<
      | { type: 'message'; index: number; message: AcpMessageType }
      | { type: 'group'; messages: WorkEntry[]; isLatest: boolean }
    > = [];

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
          items.push({ type: 'group', messages: currentGroup, isLatest: false });
          currentGroup = null;
        }
        items.push({ type: 'message', index: i, message });
      }
    }

    if (currentGroup && currentGroup.length > 0) {
      // A group is latest only when it is the final item. If a user message
      // was just sent, the previous work group must remain historical and
      // collapse immediately while the new response is pending.
      items.push({ type: 'group', messages: currentGroup, isLatest: true });
    } else if (agentWorking && items[items.length - 1]?.type !== 'group') {
      // Empty turn for the response that is about to stream. Reserving it here keeps
      // the working avatar on one element, so its pulse doesn't restart when text arrives.
      items.push({ type: 'group', messages: [], isLatest: true });
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
        return (
          <AcpWorkGroup
            key={`work-${segment.messages[0].index}`}
            isLatest={isLatest && segmentIndex === segments.length - 1}
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

  return (
    <>
      {groupedItems.map((item, idx) => {
        const isLatestAgentTurn = agentWorking && idx === groupedItems.length - 1;
        if (item.type === 'message') {
          const isUser = item.message.role === 'user';
          return (
            <AcpTurn
              key={`turn-${item.index}`}
              animateEnter={hasRenderedRef.current}
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
        } else if (item.type === 'group') {
          return (
            <AcpTurn
              key={`turn-group-${idx}`}
              animateEnter={hasRenderedRef.current}
              className={`acp-turn acp-turn-agent${isLatestAgentTurn ? ' acp-turn-agent-working' : ''}`}
              role={isLatestAgentTurn && item.messages.length === 0 ? 'status' : undefined}
              aria-label={isLatestAgentTurn && item.messages.length === 0 ? 'Agent is working' : undefined}
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
        }
        return null;
      })}

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
