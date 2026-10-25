import React from 'react';
import { type Terminal } from '../../types';
import { Icons } from '../Icons';
import './TerminalEmptyPane.css';
import type { WorkspaceProject } from '../../workspace';
import { useEffect, useState } from 'react';

interface TerminalEmptyPaneProps {
  terminals: Terminal[];
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCreateTerminal: (projectId: string) => void;
  projects: WorkspaceProject[];
  activeProjectId: string | null;
}

export const TerminalEmptyPane: React.FC<TerminalEmptyPaneProps> = ({
  terminals,
  onSelectTerminal,
  onCloseTerminal,
  onCreateTerminal,
  projects,
  activeProjectId,
}) => {
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? '');
  useEffect(() => {
    if (!projects.some((project) => project.id === projectId)) {
      setProjectId(activeProjectId ?? projects[0]?.id ?? '');
    }
  }, [projects, activeProjectId, projectId]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const selectedProject = projectsById.get(projectId);

  return (
    <div className="terminal-pane-empty">
      {terminals.length > 0 && (
        <div className="terminal-pane-opened">
          <div className="terminal-pane-title">Opened terminals</div>
          <div className="terminal-pane-actions">
            {terminals.map((terminal) => {
              const project = terminal.project_id ? projectsById.get(terminal.project_id) : undefined;
              const projectName = project?.name ?? (terminal.project_id ? 'Project unavailable' : 'Unknown project');
              const projectTitle = project?.root ?? projectName;
              return (
                <div key={terminal.id} className="terminal-pane-opened-item">
                  <div className="terminal-pane-opened-action">
                    <div className="terminal-pane-opened-primary">
                      <div className="terminal-pane-opened-primary-group">
                        <button
                          className="terminal-pane-opened-primary-select"
                          onClick={() => onSelectTerminal(terminal.id)}
                          title={`${terminal.name} — ${projectTitle}`}
                          type="button"
                        >
                          <Icons.Terminal />
                          <span>term: {terminal.name}</span>
                        </button>
                        <button
                          className="tab-close-button terminal-pane-close-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCloseTerminal(terminal.id);
                          }}
                          title={`Close ${terminal.name}`}
                          type="button"
                        >
                          <Icons.Close size={12} />
                        </button>
                      </div>
                    </div>
                    <button
                      className="terminal-pane-opened-project"
                      onClick={() => onSelectTerminal(terminal.id)}
                      title={projectTitle}
                      type="button"
                    >
                      <Icons.Folder size={14} />
                      <span>{projectName}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="terminal-pane-create">
        <div className="terminal-pane-title">Create new terminal</div>
        <div className="terminal-pane-actions">
          <div className="terminal-pane-action">
            <button
              className="terminal-pane-action-create"
              onClick={(event) => {
                event.stopPropagation();
                if (projectId) onCreateTerminal(projectId);
              }}
              disabled={!projectId}
              type="button"
            >
              <Icons.Terminal />
              <span>New Terminal</span>
            </button>
            <div className={`terminal-project-picker ${projects.length < 2 ? 'is-disabled' : ''}`}>
              <Icons.Folder size={13} />
              <span className="terminal-project-picker-label">
                {selectedProject?.name ?? 'No project selected'}
              </span>
              {projects.length > 1 && <span className="terminal-project-picker-arrow" aria-hidden="true">▾</span>}
              <select
                value={projectId}
                onChange={(event) => {
                  event.stopPropagation();
                  setProjectId(event.target.value);
                }}
                disabled={projects.length < 2}
                title={selectedProject?.root ?? 'Select the project for this terminal'}
                aria-label="Project for new terminal"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
