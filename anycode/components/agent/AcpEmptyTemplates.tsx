import React, { useState, useEffect } from 'react';
import type { AgentPromptTemplate } from '../../types';
import { useAgentTemplates, agentTemplatesStore } from '../../features/agents/agentTemplatesStore';
import { AgentIcon } from './AgentIcon';
import { AcpIcons } from './AcpIcons';
import { AgentTemplatesManager } from './AgentTemplatesManager';
import { parseAgentDisplayName } from '../../agents';
import './AcpEmptyTemplates.css';

interface AcpEmptyTemplatesProps {
  onSelectTemplate: (template: AgentPromptTemplate, sendImmediately?: boolean) => void;
  onOpenSettings?: () => void;
  agentTitle?: string;
  agentAuthors?: string[];
}

export const AcpEmptyTemplates: React.FC<AcpEmptyTemplatesProps> = ({
  onSelectTemplate,
  onOpenSettings,
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
        <div className="acp-empty-templates-customize-header">
          <button
            type="button"
            className="acp-empty-templates-back-btn"
            onClick={() => setIsCustomizing(false)}
            title="Back to Quick Actions (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Back to Quick Actions</span>
          </button>
        </div>
        <div className="acp-empty-templates-customize-body">
          <AgentTemplatesManager embedded onClose={() => setIsCustomizing(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="acp-empty-templates-wrapper">
      <div className="acp-empty-templates-header">
        <div className="acp-empty-templates-brand">
          <div className="acp-empty-templates-logo">
            <AgentIcon name={baseName} size={28} />
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
        >
          <AcpIcons.Sliders size={14} />
          <span>Customize</span>
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
