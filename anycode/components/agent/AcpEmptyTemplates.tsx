import React from 'react';
import type { AgentPromptTemplate } from '../../types';
import { useAgentTemplates, agentTemplatesStore } from '../../features/agents/agentTemplatesStore';
import './AcpEmptyTemplates.css';

interface AcpEmptyTemplatesProps {
  onSelectTemplate: (template: AgentPromptTemplate, sendImmediately?: boolean) => void;
  onOpenSettings?: () => void;
  agentTitle?: string;
}

export const AcpEmptyTemplates: React.FC<AcpEmptyTemplatesProps> = ({
  onSelectTemplate,
  onOpenSettings,
  agentTitle,
}) => {
  const templates = useAgentTemplates();

  const handleCardClick = (event: React.MouseEvent, template: AgentPromptTemplate) => {
    event.preventDefault();
    // Shift+Click populates input without sending immediately
    const sendImmediately = !event.shiftKey;
    onSelectTemplate(template, sendImmediately);
  };

  return (
    <div className="acp-empty-templates-wrapper">
      <div className="acp-empty-templates-header">
        <div className="acp-empty-templates-subtitle">{agentTitle || 'your agent'}</div>
      </div>

      {templates.length > 0 ? (
        <div className="acp-empty-templates-list">
          {templates.map((template) => {
            const displayLabel = template.label || template.title || '';
            const promptText = template.text || template.prompt || displayLabel;
            const hasExtendedPrompt = promptText !== displayLabel;

            return (
              <button
                key={template.id}
                type="button"
                className="acp-template-card"
                onClick={(e) => handleCardClick(e, template)}
                title={hasExtendedPrompt ? `${promptText} (Shift+Click to edit)` : `${displayLabel} (Shift+Click to edit)`}
              >
                <span className="acp-template-title">{displayLabel}</span>
                <span className="acp-template-arrow" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="acp-empty-templates-none">
          <p>No prompt templates configured.</p>
          <button
            type="button"
            className="acp-template-reset-btn"
            onClick={() => agentTemplatesStore.resetToDefaults()}
          >
            Restore default templates
          </button>
        </div>
      )}
    </div>
  );
};
