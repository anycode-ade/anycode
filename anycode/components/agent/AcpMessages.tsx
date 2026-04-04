import React, { useMemo } from 'react';
import {
  AcpMessage as AcpMessageType,
  AcpToolCall,
  AcpToolResultMessage,
  AcpToolUpdateMessage,
  AcpUserMessage,
} from '../../types';
import { AcpMessage } from './AcpMessage';
import './AcpMessages.css';

interface AcpMessagesProps {
  messages: AcpMessageType[];
  toolCalls: AcpToolCall[];
  expandedToolCalls: Set<number>;
  expandedToolResults: Set<number>;
  expandedThoughts: Set<number>;
  expandedPermissions: Set<number>;
  onToggleToolCall: (index: number) => void;
  onToggleToolResult: (index: number) => void;
  onToggleThought: (index: number) => void;
  onTogglePermission: (index: number) => void;
  onPermissionResponse: (permissionId: string, optionId: string) => void;
  onUndoMessage?: (message: AcpUserMessage) => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}

const AcpMessagesComponent: React.FC<AcpMessagesProps> = ({
  messages,
  toolCalls,
  expandedToolCalls,
  expandedToolResults,
  expandedThoughts,
  expandedPermissions,
  onToggleToolCall,
  onToggleToolResult,
  onToggleThought,
  onTogglePermission,
  onPermissionResponse,
  onUndoMessage,
  onOpenFile,
  onOpenFileDiff,
}) => {
  if (messages.length === 0) {
    return (
      <div className="acp-empty-state">
        <p>No messages yet. Start a conversation with the agent.</p>
      </div>
    );
  }

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

  return (
    <>
      {messages.map((message, index) => {
        // Determine if this message should be expandable
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
          if (toolResultIndexesToSkip.has(index)) {
            return null;
          }
          isExpanded = expandedToolResults.has(index);
          onToggle = () => onToggleToolResult(index);
        } else if (message.role === 'tool_update') {
          if (toolUpdateIndexesToSkip.has(index)) {
            return null;
          }
          isExpanded = expandedToolResults.has(index);
          onToggle = () => onToggleToolResult(index);
        } else if (message.role === 'thought') {
          isExpanded = expandedThoughts.has(index);
          onToggle = () => onToggleThought(index);
        } else if (message.role === 'permission_request') {
          isExpanded = expandedPermissions.has(index);
          onToggle = () => onTogglePermission(index);
        }

        return (
          <AcpMessage
            key={index}
            message={message}
            isExpanded={isExpanded}
            onToggle={onToggle}
            toolResult={toolResult}
            toolUpdates={toolUpdates}
            onPermissionResponse={onPermissionResponse}
            onOpenFile={onOpenFile}
            onOpenFileDiff={onOpenFileDiff}
            onUndo={
              message.role === 'user' && onUndoMessage
                ? () => onUndoMessage(message)
                : undefined
            }
          />
        );
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
