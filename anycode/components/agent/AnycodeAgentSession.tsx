import React, { useMemo } from 'react';
import {
  AgentSession,
  type AgentSessionProps,
  type AcpCustomComponents,
  type AcpEmptyStateRenderProps,
} from 'anycode-agent';
import { AnycodeCodeBlock, AnycodeDiffBlock } from './AnycodeBlocks';
import { AcpTerminalView } from './AcpTerminalView';
import { AcpEmptyTemplates } from './AcpEmptyTemplates';
import { AcpAvatar } from './AcpAvatar';

export const AnycodeAgentSession: React.FC<AgentSessionProps> = (props) => {
  const customComponents: AcpCustomComponents = useMemo(() => ({
    CodeBlock: AnycodeCodeBlock,
    DiffBlock: AnycodeDiffBlock,
    TerminalView: AcpTerminalView,
    Avatar: AcpAvatar,
    ...props.components,
  }), [props.components]);

  const emptyState = useMemo(() => {
    if (props.emptyState) return props.emptyState;
    return ({ onSelectTemplate, onOpenSettings, agentTitle, agentId, agentAuthors }: AcpEmptyStateRenderProps) => (
      <AcpEmptyTemplates
        onSelectTemplate={onSelectTemplate}
        onOpenSettings={onOpenSettings}
        agentTitle={agentTitle}
        agentId={agentId}
        agentAuthors={agentAuthors}
      />
    );
  }, [props.emptyState]);

  return (
    <AgentSession
      {...props}
      components={customComponents}
      emptyState={emptyState}
    />
  );
};

export { AnycodeAgentSession as AcpSession };
