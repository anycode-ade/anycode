import React, { useState, useEffect, useMemo } from 'react';
import { AcpAgent, type AcpPermissionMode, type AcpSessionSummary } from '../../types';
import './AcpSettings.css';
import { AcpIcons } from './AcpIcons';

interface AcpSettingsProps {
  agents: AcpAgent[];
  defaultAgentId: string | null;
  permissionMode: AcpPermissionMode;
  onSave: (agents: AcpAgent[], defaultAgentId: string | null, permissionMode: AcpPermissionMode) => void;
  onClose: () => void;
  onLoadSessions: (agent: AcpAgent) => Promise<AcpSessionSummary[]>;
  onResumeSession: (agent: AcpAgent, sessionId: string) => void;
}

export const AcpSettings: React.FC<AcpSettingsProps> = ({
  agents: initialAgents,
  defaultAgentId: initialDefaultAgentId,
  permissionMode: initialPermissionMode,
  onSave,
  onClose,
  onLoadSessions,
  onResumeSession,
}) => {
  const [agents, setAgents] = useState<AcpAgent[]>(initialAgents);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(initialDefaultAgentId);
  const [permissionMode, setPermissionMode] = useState<AcpPermissionMode>(initialPermissionMode);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [sessionsByAgent, setSessionsByAgent] = useState<Record<string, AcpSessionSummary[]>>({});
  const [loadingSessions, setLoadingSessions] = useState<Record<string, boolean>>({});

  // Check if there are any changes
  const hasChanges = useMemo(() => {
    if (defaultAgentId !== initialDefaultAgentId) {
      return true;
    }
    if (permissionMode !== initialPermissionMode) {
      return true;
    }
    if (agents.length !== initialAgents.length) {
      return true;
    }
    return agents.some((agent, index) => {
      const initialAgent = initialAgents[index];
      if (!initialAgent) return true;
      return (
        agent.id !== initialAgent.id ||
        agent.name !== initialAgent.name ||
        agent.command !== initialAgent.command ||
        JSON.stringify(agent.args) !== JSON.stringify(initialAgent.args)
      );
    });
  }, [agents, defaultAgentId, permissionMode, initialAgents, initialDefaultAgentId, initialPermissionMode]);

  // Update state when props change (e.g., when ensureDefaultAgents is called)
  useEffect(() => {
    setAgents(initialAgents);
    setDefaultAgentId(initialDefaultAgentId);
    setPermissionMode(initialPermissionMode);
    setExpandedSessions({});
    setSessionsByAgent({});
    setLoadingSessions({});
  }, [initialAgents, initialDefaultAgentId, initialPermissionMode]);

  // Generate ID from name: lowercase, replace spaces with hyphens, remove special chars
  const generateIdFromName = (name: string, existingIds: string[] = []): string => {
    let baseId = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Ensure ID is not empty
    if (!baseId) {
      baseId = 'agent';
    }
    
    // Ensure uniqueness
    let id = baseId;
    let counter = 1;
    while (existingIds.includes(id)) {
      id = `${baseId}-${counter}`;
      counter++;
    }
    
    return id;
  };

  const handleAgentChange = (index: number, field: keyof AcpAgent, value: string | string[]) => {
    const newAgents = [...agents];
    newAgents[index] = { ...newAgents[index], [field]: value };
    setAgents(newAgents);
  };

  const handleArgsChange = (index: number, value: string) => {
    const newAgents = [...agents];
    // Split by space, trim each arg, filter empty
    const args = value
      .split(/\s+/)
      .map(arg => arg.trim())
      .filter(arg => arg.length > 0);
    newAgents[index] = { ...newAgents[index], args };
    setAgents(newAgents);
  };

  const handleAddAgent = () => {
    const existingIds = agents.map(a => a.id);
    const name = 'New Agent';
    const newAgent: AcpAgent = {
      id: generateIdFromName(name, existingIds),
      name: name,
      command: '',
      args: [],
    };
    setAgents([...agents, newAgent]);
  };

  const handleRemoveAgent = (index: number) => {
    const agentToRemove = agents[index];
    const newAgents = agents.filter((_, i) => i !== index);
    setAgents(newAgents);
    
    // If removed agent was default, clear default or set to first agent
    if (agentToRemove.id === defaultAgentId) {
      setDefaultAgentId(newAgents.length > 0 ? newAgents[0].id : null);
    }
  };

  const handleSave = () => {
    // Validate agents
    const validAgents = agents.filter(agent => 
      agent.id.trim() !== '' && 
      agent.name.trim() !== '' && 
      agent.command.trim() !== ''
    );
    
    if (validAgents.length === 0) {
      alert('At least one valid agent is required');
      return;
    }

    // Validate default agent
    let finalDefaultId = defaultAgentId;
    if (finalDefaultId && !validAgents.find(a => a.id === finalDefaultId)) {
      finalDefaultId = validAgents[0].id;
    } else if (!finalDefaultId && validAgents.length > 0) {
      finalDefaultId = validAgents[0].id;
    }

    onSave(validAgents, finalDefaultId, permissionMode);
    onClose();
  };

  const handleToggleSessions = async (agent: AcpAgent) => {
    const isExpanded = expandedSessions[agent.id] ?? false;
    const nextExpanded = !isExpanded;

    setExpandedSessions((prev) => ({ ...prev, [agent.id]: nextExpanded }));

    if (!nextExpanded || sessionsByAgent[agent.id] || loadingSessions[agent.id]) {
      return;
    }

    setLoadingSessions((prev) => ({ ...prev, [agent.id]: true }));
    try {
      const sessions = await onLoadSessions(agent);
      setSessionsByAgent((prev) => ({ ...prev, [agent.id]: sessions }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to load ACP sessions');
      setSessionsByAgent((prev) => ({ ...prev, [agent.id]: [] }));
    } finally {
      setLoadingSessions((prev) => ({ ...prev, [agent.id]: false }));
    }
  };

  const handleRefreshSessions = async (agent: AcpAgent) => {
    setLoadingSessions((prev) => ({ ...prev, [agent.id]: true }));
    try {
      const sessions = await onLoadSessions(agent);
      setSessionsByAgent((prev) => ({ ...prev, [agent.id]: sessions }));
      setExpandedSessions((prev) => ({ ...prev, [agent.id]: true }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to load ACP sessions');
    } finally {
      setLoadingSessions((prev) => ({ ...prev, [agent.id]: false }));
    }
  };

  return (
    <div className="agent-settings-container">
      <div className="agent-settings-header">
        <h3>Agent Settings</h3>
        <div className="agent-settings-header-actions">
          {hasChanges && (
            <>
              <button className="agent-settings-cancel-btn" onClick={onClose}>
                Cancel
              </button>
              <button className="agent-settings-save-btn" onClick={handleSave}>
                Save
              </button>
            </>
          )}
          <button className="agent-settings-close-btn" onClick={onClose}>
            <AcpIcons.CloseMedium />
          </button>
        </div>
      </div>

      <div className="agent-settings-content">
        <div className="agent-settings-item">
          <div className="agent-settings-item-header">
            <h4>ACP permission mode</h4>
          </div>

          <div className="agent-settings-fields">
            <label className="agent-settings-mode-option">
              <input
                type="radio"
                name="permissionMode"
                checked={permissionMode === 'full_access'}
                onChange={() => setPermissionMode('full_access')}
              />
              <div>
                <div className="agent-settings-mode-title">Full access</div>
                <div className="agent-settings-mode-description">
                  Auto-approve permission prompts on the backend. This is the default.
                </div>
              </div>
            </label>

            <label className="agent-settings-mode-option">
              <input
                type="radio"
                name="permissionMode"
                checked={permissionMode === 'ask'}
                onChange={() => setPermissionMode('ask')}
              />
              <div>
                <div className="agent-settings-mode-title">Ask</div>
                <div className="agent-settings-mode-description">
                  Send permission requests to the frontend and wait for confirmation.
                </div>
              </div>
            </label>
          </div>
        </div>

        {agents.map((agent, index) => (
          <div key={index} className="agent-settings-item">
            <div className="agent-settings-item-header">
              <h4>Agent {index + 1}</h4>
              <div className="agent-settings-item-actions">
                <button
                  className="agent-settings-sessions-btn"
                  onClick={() => handleToggleSessions(agent)}
                  title="Show ACP sessions"
                >
                  <AcpIcons.Sessions />
                  Sessions
                </button>
                <label className="agent-settings-default-checkbox">
                  <input
                    type="radio"
                    name="defaultAgent"
                    checked={agent.id === defaultAgentId}
                    onChange={() => setDefaultAgentId(agent.id)}
                  />
                  <span>Default</span>
                </label>
                {agents.length > 1 && (
                  <button
                    className="agent-settings-remove-btn"
                    onClick={() => handleRemoveAgent(index)}
                    title="Remove agent"
                  >
                    <AcpIcons.CloseSmall />
                  </button>
                )}
              </div>
            </div>

            <div className="agent-settings-fields">
              <div className="agent-settings-field">
                <label>Name:</label>
                <input
                  type="text"
                  value={agent.name}
                  onChange={(e) => handleAgentChange(index, 'name', e.target.value)}
                  placeholder="Agent Name"
                />
              </div>

              <div className="agent-settings-field">
                <label>Command:</label>
                <input
                  type="text"
                  value={agent.command}
                  onChange={(e) => handleAgentChange(index, 'command', e.target.value)}
                  placeholder="command"
                />
              </div>

              <div className="agent-settings-field">
                <label>Arguments:</label>
                <input
                  type="text"
                  value={agent.args.join(' ')}
                  onChange={(e) => handleArgsChange(index, e.target.value)}
                  placeholder="--arg1 --arg2"
                />
              </div>

              {expandedSessions[agent.id] && (
                <div className="agent-settings-sessions-panel">
                  <div className="agent-settings-sessions-panel-header">
                    <div className="agent-settings-sessions-title">ACP sessions</div>
                    <button
                      className="agent-settings-sessions-refresh-btn"
                      onClick={() => handleRefreshSessions(agent)}
                      title="Refresh sessions"
                    >
                      <AcpIcons.Sessions />
                    </button>
                  </div>

                  {loadingSessions[agent.id] ? (
                    <div className="agent-settings-sessions-empty">Loading sessions...</div>
                  ) : (sessionsByAgent[agent.id]?.length ?? 0) === 0 ? (
                    <div className="agent-settings-sessions-empty">No ACP sessions in this folder</div>
                  ) : (
                    <div className="agent-settings-sessions-list">
                      {sessionsByAgent[agent.id].map((session) => (
                        <div key={session.sessionId} className="agent-settings-session-item">
                          <div className="agent-settings-session-content">
                            <div className="agent-settings-session-title">
                              {session.preview || session.title || session.sessionId}
                            </div>
                            <div className="agent-settings-session-meta">
                              {session.updatedAt || 'Unknown time'}
                            </div>
                            <div className="agent-settings-session-id">{session.sessionId}</div>
                          </div>
                          <button
                            className="agent-settings-session-resume-btn"
                            onClick={() => onResumeSession(agent, session.sessionId)}
                          >
                            Resume
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <button className="agent-settings-add-btn" onClick={handleAddAgent}>
          <AcpIcons.Add />
          Add agent
        </button>
      </div>
    </div>
  );
};
