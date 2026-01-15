import React from 'react';
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
}

export const AcpMessages: React.FC<AcpMessagesProps> = ({
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
}) => {
  if (messages.length === 0) {
    return (
      <div className="acp-empty-state">
        <p>No messages yet. Start a conversation with the agent.</p>
      </div>
    );
  }

  const toolCallIndexesById = new Map<string, number>();
  const toolResultsById = new Map<string, { message: AcpToolResultMessage; index: number }>();
  const toolUpdatesById = new Map<string, { message: AcpToolUpdateMessage; index: number }>();
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === 'tool_call') {
      if (!toolCallIndexesById.has(message.id)) {
        toolCallIndexesById.set(message.id, i);
      }
    } else if (message.role === 'tool_result') {
      toolResultsById.set(message.id, { message, index: i });
    } else if (message.role === 'tool_update') {
      toolUpdatesById.set(message.id, { message, index: i });
    }
  }

  const toolResultIndexesToSkip = new Set<number>();
  const toolUpdateIndexesToSkip = new Set<number>();
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === 'tool_result') {
      const toolCallIndex = toolCallIndexesById.get(message.id);
      if (toolCallIndex !== undefined && toolCallIndex < i) {
        toolResultIndexesToSkip.add(i);
      }
    } else if (message.role === 'tool_update') {
      const toolCallIndex = toolCallIndexesById.get(message.id);
      if (toolCallIndex !== undefined && toolCallIndex < i) {
        toolUpdateIndexesToSkip.add(i);
      }
    }
  }

  return (
    <>
      {messages.map((message, index) => {
        // Determine if this message should be expandable
        let isExpanded = false;
        let onToggle: (() => void) | undefined = undefined;
        let toolResult: AcpToolResultMessage | undefined = undefined;
        let toolUpdate: AcpToolUpdateMessage | undefined = undefined;

        if (message.role === 'tool_call') {
          isExpanded = expandedToolCalls.has(index);
          onToggle = () => onToggleToolCall(index);
          const toolResultEntry = toolResultsById.get(message.id);
          if (toolResultEntry && toolResultEntry.index > index) {
            toolResult = toolResultEntry.message;
          } else {
            const toolUpdateEntry = toolUpdatesById.get(message.id);
            if (toolUpdateEntry && toolUpdateEntry.index > index) {
              toolUpdate = toolUpdateEntry.message;
            }
          }
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
            toolUpdate={toolUpdate}
            onPermissionResponse={onPermissionResponse}
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
