import React, { useState, useEffect } from 'react';
import type { AgentPromptTemplate } from '../../types';
import { useAgentTemplates, agentTemplatesStore } from '../../features/agents/agentTemplatesStore';
import { AcpAvatar } from './AcpAvatar';
import { AcpIcons } from './AcpIcons';
import { AgentTemplatesManager } from './AgentTemplatesManager';
import { parseAgentDisplayName } from '../../agents';
import './AcpEmptyTemplates.css';

interface AcpEmptyTemplatesProps {
  onSelectTemplate: (template: AgentPromptTemplate, sendImmediately?: boolean) => void;
  onOpenSettings?: () => void;
  agentId?: string;
  agentTitle?: string;
  agentAuthors?: string[];
}

export const AcpEmptyTemplates: React.FC<AcpEmptyTemplatesProps> = ({
  onSelectTemplate,
  onOpenSettings,
  agentId,
  agentTitle,
  agentAuthors,
}) => {
  const templates = useAgentTemplates();
  const [isCustomizing, setIsCustomizing] = useState(false);

  useEffect(() => {
    if (!isCustomizing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCustomizing(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCustomizing]);

  const handleCardClick = (event: React.MouseEvent, template: AgentPromptTemplate) => {
    event.preventDefault();
    // Shift+Click populates input without sending immediately
    const sendImmediately = !event.shiftKey;
    onSelectTemplate(template, sendImmediately);
  };

  const parsed = agentTitle ? parseAgentDisplayName(agentTitle) : { baseName: 'Agent' };
  const baseName = parsed.baseName;
  const profileName = parsed.accountName;
  const authorsLabel = agentAuthors?.filter((author) => author.trim()).join(', ');

  if (isCustomizing) {
    return (
      <div className="acp-empty-templates-wrapper is-customizing">
        <div className="acp-empty-templates-customize-body">
          <AgentTemplatesManager embedded onBack={() => setIsCustomizing(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="acp-empty-templates-wrapper">
      <div className="acp-empty-templates-header">
        <div className="acp-empty-templates-brand">
          <div className="acp-empty-templates-logo">
            <AcpAvatar type="agent" agentId={agentId} agentTitle={agentTitle} size={28} />
          </div>
          <div className="acp-empty-templates-meta">
            <div className="acp-empty-templates-title-line">
              <span className="acp-empty-templates-name">{baseName}</span>
              {profileName && (
                <span className="acp-empty-templates-profile" title={`Profile: ${profileName}`}>
                  {profileName}
                </span>
              )}
            </div>
            {authorsLabel && (
              <div className="acp-empty-templates-authors">by {authorsLabel}</div>
            )}
          </div>
        </div>
      </div>

      <div className="acp-empty-templates-section-header">
        <span className="acp-empty-templates-section-title">QUICK ACTIONS</span>
        <button
          type="button"
          className="acp-empty-templates-customize-btn"
          onClick={() => setIsCustomizing(true)}
          title="Customize templates"
          aria-label="Customize templates"
        >
          <AcpIcons.Sliders size={14} />
        </button>
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
