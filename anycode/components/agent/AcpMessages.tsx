import React from 'react';
import { AcpMessage as AcpMessageType, AcpToolCall } from '../../types';
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
}) => {
  if (messages.length === 0) {
    return (
      <div className="acp-empty-state">
        <p>No messages yet. Start a conversation with the agent.</p>
      </div>
    );
  }

  return (
    <>
      {messages.map((message, index) => {
        // Determine if this message should be expandable
        let isExpanded = false;
        let onToggle: (() => void) | undefined = undefined;

        if (message.role === 'tool_call') {
          isExpanded = expandedToolCalls.has(index);
          onToggle = () => onToggleToolCall(index);
        } else if (message.role === 'tool_result') {
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
            onPermissionResponse={onPermissionResponse}
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

