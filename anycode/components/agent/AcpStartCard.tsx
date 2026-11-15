import React from 'react';
import type { AcpAgent } from '../../types';
import { getAgentAvatar, resolveAgentDisplay } from '../../agents';
import { AcpAvatar } from './AcpAvatar';
import './AcpEmptyPane.css';

export interface AgentStartGroup {
  baseName: string;
  defaultAgent: AcpAgent;
  profiles: { agent: AcpAgent; profileName: string }[];
}

export const groupAvailableAgents = (agents: AcpAgent[]): AgentStartGroup[] => {
  const groupsMap = new Map<string, AgentStartGroup>();

  agents.forEach((agent) => {
    const { baseName, accountName } = resolveAgentDisplay(agent, agents);
    let group = groupsMap.get(baseName);
    if (!group) {
      group = {
        baseName,
        defaultAgent: agent,
        profiles: [],
      };
      groupsMap.set(baseName, group);
    }
    const profileLabel = accountName || 'Default';
    group.profiles.push({ agent, profileName: profileLabel });
  });

  return Array.from(groupsMap.values());
};

const getAgentDescription = (baseName: string, agent: AcpAgent): string | null => {
  const baseLower = baseName.toLowerCase();
  const rawDescription =
    agent.description ||
    (baseLower.includes('antigravity')
      ? "Google's AI coding agent"
      : baseLower.includes('codex')
      ? "OpenAI's coding assistant"
      : baseLower.includes('claude')
      ? "Anthropic's coding assistant"
      : null);

  return rawDescription ? rawDescription.replace(/\s*\[Profile:[^\]]*\]/gi, '').trim() : null;
};

interface AcpStartCardProps {
  group: AgentStartGroup;
  selectedAgentId?: string;
  onSelectProfile: (baseName: string, agentId: string) => void;
  onStart: (agent: AcpAgent) => void;
  disabled?: boolean;
  title?: string;
  footerExtra?: React.ReactNode;
}

export const AcpStartCard: React.FC<AcpStartCardProps> = ({
  group,
  selectedAgentId,
  onSelectProfile,
  onStart,
  disabled = false,
  title,
  footerExtra,
}) => {
  const hasMultipleProfiles = group.profiles.length > 1;
  const hasSingleProfileWithAccount =
    group.profiles.length === 1 && group.profiles[0].profileName !== 'Default';
  const selectedAgent = selectedAgentId
    ? group.profiles.find((p) => p.agent.id === selectedAgentId)?.agent || group.defaultAgent
    : group.defaultAgent;

  const authorsLabel = selectedAgent.authors?.filter((author) => author.trim()).join(', ');
  const descriptionText = getAgentDescription(group.baseName, selectedAgent);
  const currentProfileName =
    group.profiles.find((p) => p.agent.id === selectedAgent.id)?.profileName ||
    selectedAgent.profile ||
    'Default';

  const handleActivate = () => {
    if (disabled) return;
    onStart(selectedAgent);
  };

  return (
    <div
      className="acp-start-card"
      onClick={(event) => {
        event.stopPropagation();
        handleActivate();
      }}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
      title={title}
    >
      <div
        className={`acp-start-card-icon-box ${
          selectedAgent.avatar || getAgentAvatar(selectedAgent.id, group.baseName) ? 'has-avatar' : ''
        }`}
      >
        <AcpAvatar
          type="agent"
          agentId={selectedAgent.id}
          agentTitle={group.baseName}
          avatar={selectedAgent.avatar}
          size={18}
        />
      </div>

      <div className="acp-start-card-content">
        <div className="acp-start-card-title-row">
          <span className="acp-start-card-title">{group.baseName}</span>
          {authorsLabel && (
            <span className="acp-start-card-authors" title={`Authors: ${authorsLabel}`}>
              by {authorsLabel}
            </span>
          )}
        </div>

        {descriptionText && (
          <div className="acp-start-card-desc" title={descriptionText}>
            {descriptionText}
          </div>
        )}

        <div className="acp-start-card-footer">
          {hasMultipleProfiles ? (
            <div
              className="acp-start-card-profile-wrap"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <svg
                className="acp-start-card-meta-icon"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M20 21a8 8 0 1 0-16 0" />
              </svg>
              <span className="acp-start-card-profile-label">{currentProfileName}</span>
              <span className="acp-start-card-profile-arrow">▾</span>
              <select
                className="acp-start-card-profile-select"
                value={selectedAgent.id}
                onChange={(e) => {
                  e.stopPropagation();
                  onSelectProfile(group.baseName, e.target.value);
                }}
                title="Select profile"
              >
                {group.profiles.map((p) => (
                  <option key={p.agent.id} value={p.agent.id}>
                    {p.profileName}
                  </option>
                ))}
              </select>
            </div>
          ) : hasSingleProfileWithAccount ? (
            <div className="acp-start-card-profile-static">
              <svg
                className="acp-start-card-meta-icon"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M20 21a8 8 0 1 0-16 0" />
              </svg>
              <span>{group.profiles[0].profileName}</span>
            </div>
          ) : null}

          {footerExtra}
        </div>
      </div>

      <div className="acp-start-card-arrow">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  );
};
