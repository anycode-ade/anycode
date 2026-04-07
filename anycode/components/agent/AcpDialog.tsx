import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Allotment } from 'allotment';
import {
  type AcpAgent,
  type AcpPermissionMode,
  type AcpSelectOption,
  type AcpSession,
  type AcpSessionSummary,
} from '../../types';
import './AcpDialog.css';
import { AcpSettings } from './AcpSettings';
import { AcpAgentsList } from './AcpAgentsList';
import { AcpIcons } from './AcpIcons';
import { AcpSessionView } from './AcpSessionView';

type AcpLayoutPaneNode = {
  id: string;
  type: 'pane';
  sessionId: string | null;
};

type AcpLayoutSplitNode = {
  id: string;
  type: 'split';
  direction: 'row' | 'column';
  children: [AcpLayoutNode, AcpLayoutNode];
};

type AcpLayoutNode = AcpLayoutPaneNode | AcpLayoutSplitNode;

const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const createPaneNode = (sessionId: string | null): AcpLayoutPaneNode => ({
  id: createId('pane'),
  type: 'pane',
  sessionId,
});

const createInitialLayoutState = (sessionId: string | null) => {
  const pane = createPaneNode(sessionId);
  return {
    layout: pane as AcpLayoutNode,
    activePaneId: pane.id,
  };
};

const getFirstPaneId = (node: AcpLayoutNode): string => (
  node.type === 'pane' ? node.id : getFirstPaneId(node.children[0])
);

const getPaneSessionId = (node: AcpLayoutNode, paneId: string): string | null | undefined => {
  if (node.type === 'pane') {
    return node.id === paneId ? node.sessionId : undefined;
  }

  return getPaneSessionId(node.children[0], paneId) ?? getPaneSessionId(node.children[1], paneId);
};

const hasAssignedSessionId = (node: AcpLayoutNode, sessionId: string): boolean => {
  if (node.type === 'pane') {
    return node.sessionId === sessionId;
  }

  return hasAssignedSessionId(node.children[0], sessionId) || hasAssignedSessionId(node.children[1], sessionId);
};

const collectAssignedSessionIds = (node: AcpLayoutNode, target = new Set<string>()): Set<string> => {
  if (node.type === 'pane') {
    if (node.sessionId) {
      target.add(node.sessionId);
    }
    return target;
  }

  collectAssignedSessionIds(node.children[0], target);
  collectAssignedSessionIds(node.children[1], target);
  return target;
};

const countPanes = (node: AcpLayoutNode): number => {
  if (node.type === 'pane') {
    return 1;
  }

  return countPanes(node.children[0]) + countPanes(node.children[1]);
};

const replacePaneSession = (node: AcpLayoutNode, paneId: string, sessionId: string | null): AcpLayoutNode => {
  if (node.type === 'pane') {
    return node.id === paneId ? { ...node, sessionId } : node;
  }

  return {
    ...node,
    children: [
      replacePaneSession(node.children[0], paneId, sessionId),
      replacePaneSession(node.children[1], paneId, sessionId),
    ],
  };
};

const splitPane = (
  node: AcpLayoutNode,
  paneId: string,
  direction: 'row' | 'column',
  nextPane: AcpLayoutPaneNode,
): AcpLayoutNode => {
  if (node.type === 'pane') {
    if (node.id !== paneId) {
      return node;
    }

    return {
      id: createId('split'),
      type: 'split',
      direction,
      children: [node, nextPane],
    };
  }

  return {
    ...node,
    children: [
      splitPane(node.children[0], paneId, direction, nextPane),
      splitPane(node.children[1], paneId, direction, nextPane),
    ],
  };
};

const removePane = (node: AcpLayoutNode, paneId: string): AcpLayoutNode | null => {
  if (node.type === 'pane') {
    return node.id === paneId ? null : node;
  }

  const left = removePane(node.children[0], paneId);
  const right = removePane(node.children[1], paneId);

  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;

  return {
    ...node,
    children: [left, right],
  };
};

const sanitizeLayout = (node: AcpLayoutNode, validSessionIds: Set<string>): AcpLayoutNode => {
  if (node.type === 'pane') {
    return {
      ...node,
      sessionId: node.sessionId && validSessionIds.has(node.sessionId) ? node.sessionId : null,
    };
  }

  return {
    ...node,
    children: [
      sanitizeLayout(node.children[0], validSessionIds),
      sanitizeLayout(node.children[1], validSessionIds),
    ],
  };
};

interface AcpDialogProps {
  agents: AcpSession[];
  availableAgents: AcpAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
  onAddAgent: () => string | null | undefined;
  onStartAgent: (agent: AcpAgent) => string | null | undefined;
  onOpenSettings: () => void;
  isOpen: boolean;
  onSendPrompt: (agentId: string, prompt: string) => void;
  onCancelPrompt: (agentId: string) => void;
  onPermissionResponse: (agentId: string, permissionId: string, optionId: string) => void;
  onUndoPrompt: (agentId: string, checkpointId?: string, prompt?: string) => void;
  isConnected: boolean;
  onSelectModel?: (agentId: string, option: AcpSelectOption) => void;
  onSelectReasoning?: (agentId: string, option: AcpSelectOption) => void;
  showSettings?: boolean;
  settingsAgents?: AcpAgent[];
  settingsDefaultAgentId?: string | null;
  settingsPermissionMode?: AcpPermissionMode;
  onSaveSettings?: (agents: AcpAgent[], defaultAgentId: string | null, permissionMode: AcpPermissionMode) => void;
  onCloseSettings?: () => void;
  onLoadSettingsSessions?: (agent: AcpAgent) => Promise<AcpSessionSummary[]>;
  onResumeSettingsSession?: (agent: AcpAgent, sessionId: string) => void;
  diffEnabled?: boolean;
  onToggleDiff?: () => void;
  followEnabled?: boolean;
  onToggleFollow?: () => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}

const AcpDialogComponent: React.FC<AcpDialogProps> = ({
  agents,
  availableAgents,
  selectedAgentId,
  onSelectAgent,
  onCloseAgent,
  onAddAgent,
  onStartAgent,
  onOpenSettings,
  isOpen,
  onSendPrompt,
  onCancelPrompt,
  onPermissionResponse,
  onUndoPrompt,
  isConnected,
  onSelectModel,
  onSelectReasoning,
  showSettings = false,
  settingsAgents = [],
  settingsDefaultAgentId = null,
  settingsPermissionMode = 'full_access',
  onSaveSettings,
  onCloseSettings,
  onLoadSettingsSessions,
  onResumeSettingsSession,
  diffEnabled = false,
  onToggleDiff,
  followEnabled = false,
  onToggleFollow,
  onOpenFile,
  onOpenFileDiff,
}) => {
  const sessionMap = useMemo(
    () => new Map(agents.map((session) => [session.agentId, session])),
    [agents],
  );
  const [layoutState] = useState(() => createInitialLayoutState(selectedAgentId ?? null));
  const [layout, setLayout] = useState<AcpLayoutNode>(layoutState.layout);
  const [activePaneId, setActivePaneId] = useState<string>(layoutState.activePaneId);
  const prevSelectedAgentIdRef = useRef<string | null>(selectedAgentId);
  const pendingPaneByAgentIdRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const validSessionIds = new Set(agents.map((session) => session.agentId));
    const selectedAgentChanged = prevSelectedAgentIdRef.current !== selectedAgentId;

    setLayout((prev) => {
      let nextLayout = sanitizeLayout(prev, validSessionIds);
      const sanitizedChanged = nextLayout !== prev;

      for (const [pendingAgentId, targetPaneId] of pendingPaneByAgentIdRef.current.entries()) {
        if (!validSessionIds.has(pendingAgentId)) {
          continue;
        }

        if (!hasAssignedSessionId(nextLayout, pendingAgentId)) {
          nextLayout = replacePaneSession(nextLayout, targetPaneId, pendingAgentId);
        }

        pendingPaneByAgentIdRef.current.delete(pendingAgentId);
      }

      if (
        selectedAgentChanged
        && selectedAgentId
        && validSessionIds.has(selectedAgentId)
        && !hasAssignedSessionId(nextLayout, selectedAgentId)
      ) {
        nextLayout = replacePaneSession(nextLayout, activePaneId, selectedAgentId);
      }

      return nextLayout !== prev || sanitizedChanged ? nextLayout : prev;
    });

    prevSelectedAgentIdRef.current = selectedAgentId;
  }, [agents, selectedAgentId, activePaneId]);

  const assignSessionToActivePane = useCallback((agentId: string) => {
    setLayout((prev) => replacePaneSession(prev, activePaneId, agentId));
    onSelectAgent(agentId);
  }, [activePaneId, onSelectAgent]);

  const handleAddAgentToActivePane = useCallback(() => {
    const startedAgentId = onAddAgent();
    if (startedAgentId) {
      pendingPaneByAgentIdRef.current.set(startedAgentId, activePaneId);
    }
  }, [onAddAgent, activePaneId]);

  const handleSplitPane = useCallback((direction: 'row' | 'column') => {
    const assignedSessionIds = collectAssignedSessionIds(layout);
    const nextAvailableSession = agents.find((session) => !assignedSessionIds.has(session.agentId));
    const nextPane = createPaneNode(nextAvailableSession?.agentId ?? null);

    setLayout((prev) => splitPane(prev, activePaneId, direction, nextPane));
    setActivePaneId(nextPane.id);
    if (nextAvailableSession) {
      onSelectAgent(nextAvailableSession.agentId);
    }
  }, [layout, agents, activePaneId, onSelectAgent]);

  const handleClosePane = useCallback(() => {
    setLayout((prev) => {
      const nextLayout = removePane(prev, activePaneId);
      if (!nextLayout) {
        const fallback = createPaneNode(null);
        setActivePaneId(fallback.id);
        return fallback;
      }

      const nextPaneId = getFirstPaneId(nextLayout);
      setActivePaneId(nextPaneId);
      const nextSessionId = getPaneSessionId(nextLayout, nextPaneId);
      if (nextSessionId) {
        onSelectAgent(nextSessionId);
      }
      return nextLayout;
    });
  }, [activePaneId, onSelectAgent]);

  const renderPane = useCallback((node: AcpLayoutNode): React.ReactNode => {
    if (node.type === 'split') {
      return (
        <Allotment key={node.id} vertical={node.direction === 'column'} separator={false}>
          <Allotment.Pane key={`${node.id}-0`} minSize={180}>
            {renderPane(node.children[0])}
          </Allotment.Pane>
          <Allotment.Pane key={`${node.id}-1`} minSize={180}>
            {renderPane(node.children[1])}
          </Allotment.Pane>
        </Allotment>
      );
    }

    const session = node.sessionId ? sessionMap.get(node.sessionId) ?? null : null;

    if (!session) {
      return (
        <div
          key={node.id}
          className={`acp-pane-empty ${node.id === activePaneId ? 'active' : ''}`}
          onMouseDown={() => setActivePaneId(node.id)}
        >
          <div className="acp-pane-empty-title">Empty pane</div>
          <div className="acp-pane-empty-subtitle">Start an agent here or select one below.</div>
          {availableAgents.length > 0 && (
            <div className="acp-pane-empty-actions">
              {availableAgents.map((agent) => (
                <button
                  key={agent.id}
                  className="acp-pane-empty-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActivePaneId(node.id);
                    const startedAgentId = onStartAgent(agent);
                    if (startedAgentId) {
                      pendingPaneByAgentIdRef.current.set(startedAgentId, node.id);
                    }
                  }}
                  title={agent.description || agent.name}
                >
                  {agent.name}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <AcpSessionView
        key={node.id}
        agentId={session.agentId}
        title={session.agentName || session.agentId}
        isActivePane={node.id === activePaneId}
        isConnected={session.isActive && isConnected}
        isProcessing={session.isProcessing || false}
        messages={session.messages}
        modelSelector={session.modelSelector}
        reasoningSelector={session.reasoningSelector}
        contextUsage={session.contextUsage}
        onFocusPane={() => {
          setActivePaneId(node.id);
          onSelectAgent(session.agentId);
        }}
        onSendPrompt={onSendPrompt}
        onCancelPrompt={onCancelPrompt}
        onPermissionResponse={onPermissionResponse}
        onUndoPrompt={onUndoPrompt}
        onCloseAgent={onCloseAgent}
        onSelectModel={onSelectModel}
        onSelectReasoning={onSelectReasoning}
        onOpenFile={onOpenFile}
        onOpenFileDiff={onOpenFileDiff}
      />
    );
  }, [
    sessionMap,
    activePaneId,
    isConnected,
    onSendPrompt,
    onCancelPrompt,
    onPermissionResponse,
    onUndoPrompt,
    onSelectAgent,
    onStartAgent,
    onSelectModel,
    onSelectReasoning,
    onOpenFile,
    onOpenFileDiff,
    availableAgents,
  ]);

  if (!isOpen) return null;

  if (showSettings && onSaveSettings && onCloseSettings) {
    return (
      <div className="acp-dialog" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <AcpSettings
          agents={settingsAgents}
          defaultAgentId={settingsDefaultAgentId}
          permissionMode={settingsPermissionMode}
          onSave={onSaveSettings}
          onClose={onCloseSettings}
          onLoadSessions={onLoadSettingsSessions ?? (async () => [])}
          onResumeSession={(agent, sessionId) => onResumeSettingsSession?.(agent, sessionId)}
        />
      </div>
    );
  }

  const activeSessionId = getPaneSessionId(layout, activePaneId) ?? null;
  const hasMultiplePanes = countPanes(layout) > 1;

  return (
    <div
      className={`acp-dialog ${hasMultiplePanes ? 'acp-dialog-multi-pane' : 'acp-dialog-single-pane'}`}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div className="acp-dialog-content acp-workspace-content">
        {renderPane(layout)}
      </div>

      <div className="acp-dialog-header">
        <div className="acp-agents-container">
          <AcpAgentsList
            agents={agents}
            selectedAgentId={activeSessionId}
            onSelectAgent={assignSessionToActivePane}
            onCloseAgent={onCloseAgent}
          />
          <button
            className="acp-add-agent-btn"
            onClick={handleAddAgentToActivePane}
            title="Add agent"
          >
            <AcpIcons.Add />
          </button>
          <button
            className="acp-split-btn"
            onClick={() => handleSplitPane('row')}
            title="Split horizontally"
          >
            <AcpIcons.SplitHorizontal />
          </button>
          <button
            className="acp-split-btn"
            onClick={() => handleSplitPane('column')}
            title="Split vertically"
          >
            <AcpIcons.SplitVertical />
          </button>
          <button
            className="acp-split-btn"
            onClick={handleClosePane}
            title="Close active pane"
          >
            <AcpIcons.CloseMedium />
          </button>
          {onToggleFollow && (
            <button
              className={`acp-follow-btn ${followEnabled ? 'active' : ''}`}
              onClick={onToggleFollow}
              title={followEnabled ? 'Disable Follow Mode' : 'Enable Follow Mode'}
            >
              <AcpIcons.Follow />
            </button>
          )}
          {onToggleDiff && (
            <button
              className={`acp-diff-btn ${diffEnabled ? 'active' : ''}`}
              onClick={onToggleDiff}
              title={diffEnabled ? 'Disable Diff Mode' : 'Enable Diff Mode'}
            >
              <AcpIcons.Diff />
            </button>
          )}
          <button
            className="acp-settings-btn"
            onClick={onOpenSettings}
            title="Agent settings"
          >
            <AcpIcons.Settings />
          </button>
        </div>
      </div>
    </div>
  );
};

export const AcpDialog = React.memo(AcpDialogComponent);
