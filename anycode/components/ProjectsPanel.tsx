import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AcpAgent, AcpSessionState, Terminal } from '../types';
import type { WorkspaceProject } from '../workspace';
import type { GitLastCommit } from '../hooks/useGit';
import { formatRelativeTime, normalizePath } from '../utils';
import { statusTextColors, type ChangedFile } from './ChangesPanel';
import { Icons } from './Icons';
import { FileIcon } from './FileIcon';
import { AcpOpenedAgentCard } from './agent/AcpOpenedAgentCard';
// Agent cards are AcpOpenedAgentCard; its styles are defined in AcpEmptyPane.css.
import './agent/AcpEmptyPane.css';
import './ProjectsPanel.css';

export interface ProjectGitSummary {
    branch: string;
    branches: { name: string; is_current: boolean }[];
    isSwitchingBranch: boolean;
    added: number;
    removed: number;
    changedFiles: ChangedFile[];
    /** HEAD commit: time and author. */
    lastCommit: GitLastCommit | null;
    /** Commits per day for the last 14 days, oldest first, today last. */
    commitActivity: number[];
}

type FileIconsStyle = 'colored' | 'monochrome' | 'disabled';

export interface ProjectsPanelProps {
    projects: WorkspaceProject[];
    gitByProjectId: Record<string, ProjectGitSummary | undefined>;
    terminals: Terminal[];
    terminalLastCommands: Record<string, string>;
    terminalTitles: Record<string, string>;
    agentSessions: AcpSessionState[];
    availableAgents: AcpAgent[];
    activeChangedFile: ChangedFile | null;
    activeTerminalId: string | null;
    activeAgentId: string | null;
    fileIconsStyle: FileIconsStyle;
    onOpenChangedFile: (path: string) => void;
    onOpenReview: (projectId: string) => void;
    onSelectTerminal: (terminalId: string) => void;
    onCloseTerminal: (terminalId: string) => void;
    onAddProject?: (anchor: HTMLElement, alignTo: HTMLElement | null) => void;
    isAddingProject?: boolean;
    onSelectAgent: (agentId: string) => void;
    onBranchChange: (projectId: string, branch: string) => void;
    onCloseAgent: (agentId: string) => void;
}

// Card strip geometry. Card sizes are passed to each strip and exposed to the CSS as `--strip-card-height`.
const STRIP_GAP = 8;
const OVERSCAN_PX = 240;
const FILE_CARD = { width: 200, height: 28 };
const AGENT_CARD = { width: 280, height: 76 };
const TERMINAL_CARD = { width: 150, height: 60 };

// Stable hue per author so each avatar keeps its colour across renders.
const avatarHue = (name: string): number => {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return Math.abs(hash) % 360;
};

// Re-renders periodically so "x minutes ago" keeps moving without new git data.
const RelativeCommitTime = ({ timestamp }: { timestamp: number }) => {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = window.setInterval(() => setTick((tick) => tick + 1), 30_000);
        return () => window.clearInterval(id);
    }, []);
    return <>{formatRelativeTime(timestamp)}</>;
};

// One bar per day; height scales to the busiest day in the window. Empty days stay as a flat stub.
const CommitActivity = ({ counts }: { counts: number[] }) => {
    const max = Math.max(1, ...counts);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const today = new Date();
    return (
        <div className="projects-commit-chart" aria-label={`${total} commits in the last ${counts.length} days`}>
            <div className="projects-commit-bars">
                {counts.map((count, index) => {
                    const daysAgo = counts.length - 1 - index;
                    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
                    const dayLabel = day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                        <span
                            key={index}
                            className={`projects-commit-bar ${count > 0 ? 'has-commits' : ''}`}
                            style={{ height: count > 0 ? 4 + Math.round((count / max) * 26) : 2 }}
                            data-tip={`${dayLabel} · ${count} commit${count === 1 ? '' : 's'}`}
                        />
                    );
                })}
            </div>
            <div className="projects-commit-scale" aria-hidden="true">
                <span>{total} in {counts.length}d</span>
                <span>today</span>
            </div>
        </div>
    );
};

const baseName = (path: string): string => {
    const normalized = normalizePath(path);
    return normalized.slice(normalized.lastIndexOf('/') + 1);
};

interface StripColumn<T> {
    key: string;
    left: number;
    items: T[];
}

interface CardStripProps<T> {
    items: T[];
    getKey: (item: T) => string;
    renderCard: (item: T) => React.ReactNode;
    card: { width: number; height: number };
    rows: number;
    compact?: boolean;
}

// Cards flow into `rows`-row columns left to right and scroll horizontally. Only the columns
// near the horizontal viewport are mounted.
const CardStrip = <T,>({ items, getKey, renderCard, card, rows, compact = false }: CardStripProps<T>) => {
    const boxRef = useRef<HTMLDivElement>(null);
    // Reserve only the rows that hold cards: one file in a 2-row strip should not leave an empty row behind.
    const usedRows = Math.max(1, Math.min(rows, items.length));
    const stripHeight = usedRows * card.height + (usedRows - 1) * STRIP_GAP;
    const [scrollLeft, setScrollLeft] = useState(0);
    const [viewportWidth, setViewportWidth] = useState(0);

    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const updateWidth = () => setViewportWidth(box.clientWidth);
        updateWidth();
        const observer = new ResizeObserver(updateWidth);
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    const { columns, totalWidth } = useMemo(() => {
        const nextColumns: StripColumn<T>[] = [];
        for (let start = 0; start < items.length; start += rows) {
            nextColumns.push({
                key: getKey(items[start]),
                left: (start / rows) * (card.width + STRIP_GAP),
                items: items.slice(start, start + rows),
            });
        }
        const width = nextColumns.length > 0
            ? nextColumns.length * card.width + (nextColumns.length - 1) * STRIP_GAP
            : 0;
        return { columns: nextColumns, totalWidth: width };
    }, [items, getKey, rows, card.width]);

    const visibleColumns = useMemo(() => {
        const start = scrollLeft - OVERSCAN_PX;
        const end = scrollLeft + viewportWidth + OVERSCAN_PX;
        return columns.filter((column) => column.left + card.width >= start && column.left <= end);
    }, [columns, scrollLeft, viewportWidth, card.width]);

    return (
        <div
            ref={boxRef}
            className={`projects-strip ${compact ? 'projects-compact' : ''}`}
            style={{ '--strip-card-height': `${card.height}px` } as React.CSSProperties}
            onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        >
            <div className="projects-strip-spacer" style={{ width: totalWidth, height: stripHeight }}>
                {visibleColumns.map((column) => (
                    <div
                        key={column.key}
                        className="projects-strip-column"
                        style={{ left: column.left, width: card.width }}
                    >
                        {column.items.map((item) => (
                            <React.Fragment key={getKey(item)}>{renderCard(item)}</React.Fragment>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

const PanelSection = ({ title, count, meta, children }: { title: string; count: number; meta?: React.ReactNode; children: React.ReactNode }) => (
    <div className="projects-section">
        <div className="projects-section-title">
            <span>{title}</span>
            <span className="projects-section-count">{count}</span>
            {meta}
        </div>
        {children}
    </div>
);

export const ProjectsPanel = ({
    projects,
    gitByProjectId,
    terminals,
    terminalLastCommands,
    terminalTitles,
    agentSessions,
    availableAgents,
    activeChangedFile,
    activeTerminalId,
    activeAgentId,
    fileIconsStyle,
    onOpenChangedFile,
    onOpenReview,
    onSelectTerminal,
    onCloseTerminal,
    onAddProject,
    isAddingProject = false,
    onSelectAgent,
    onBranchChange,
    onCloseAgent,
}: ProjectsPanelProps) => (
    <div className="projects-panel">
        <div className="projects-list">
            {projects.length === 0 && <div className="projects-empty">No projects open</div>}
            {projects.map((project) => {
                const git = gitByProjectId[project.id];
                const changedFiles = [...(git?.changedFiles ?? [])].sort((a, b) => a.path.localeCompare(b.path));
                const projectTerminals = terminals.filter((terminal) => terminal.project_id === project.id);
                const projectAgents = agentSessions.filter((session) => session.projectId === project.id);
                const isEmpty = changedFiles.length + projectTerminals.length + projectAgents.length === 0;
                const stats = git && (git.added > 0 || git.removed > 0) ? (
                    <button
                        type="button"
                        className="projects-plate projects-plate-stats"
                        title="Review project changes"
                        onClick={() => onOpenReview(project.id)}
                    >
                        {git.added > 0 && <span className="projects-stat-added">+{git.added}</span>}
                        {git.removed > 0 && <span className="projects-stat-removed">-{git.removed}</span>}
                    </button>
                ) : null;

                return (
                    <section key={project.id} className="projects-project">
                        <div className="projects-project-header">
                            <div
                                className="projects-plate projects-plate-card projects-plate-project"
                                data-dirty={changedFiles.length > 0}
                            >
                                <div className="projects-project-row" title={project.root}>
                                    <span className="projects-project-icon" aria-hidden="true">
                                        <Icons.Folder size={14} />
                                    </span>
                                    <span className="projects-project-name">{project.name}</span>
                                </div>
                                {git && (git.branch || git.branches.length > 0) && (
                                    <div className="projects-project-row">
                                        <span className="projects-project-icon" aria-hidden="true">
                                            <Icons.Git />
                                        </span>
                                        <select
                                            className="projects-branch-select"
                                            value={git.branch}
                                            onChange={(event) => onBranchChange(project.id, event.target.value)}
                                            disabled={git.isSwitchingBranch || git.branches.length === 0}
                                            title={git.isSwitchingBranch ? 'Switching branch...' : 'Select branch'}
                                            aria-label={`Branch of ${project.name}`}
                                        >
                                            {!git.branches.some((branch) => branch.name === git.branch) && (
                                                <option value={git.branch}>{git.branch || 'HEAD'}</option>
                                            )}
                                            {git.branches.map((branch) => (
                                                <option key={branch.name} value={branch.name}>{branch.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                {git?.lastCommit && (
                                    <div className="projects-project-row projects-project-commit">
                                        <div className="projects-commit-line">
                                            <span
                                                className="projects-commit-time"
                                                title={new Date(git.lastCommit.timestamp * 1000).toLocaleString()}
                                            >
                                                <RelativeCommitTime timestamp={git.lastCommit.timestamp} />
                                            </span>
                                            {git.lastCommit.authorName && (
                                                <>
                                                    <span
                                                        className="projects-commit-avatar"
                                                        aria-hidden="true"
                                                        style={{ background: `hsl(${avatarHue(git.lastCommit.authorName)} 60% 52%)` }}
                                                    >
                                                        {git.lastCommit.authorName.trim().charAt(0).toUpperCase()}
                                                    </span>
                                                    <span className="projects-commit-author">{git.lastCommit.authorName}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {git && git.commitActivity.length > 0 && <CommitActivity counts={git.commitActivity} />}
                            </div>
                        </div>

                        {isEmpty && <div className="projects-empty-project">Nothing open</div>}

                        {changedFiles.length > 0 && (
                            <PanelSection title="Changes" count={changedFiles.length} meta={stats}>
                                <CardStrip
                                    items={changedFiles}
                                    getKey={(file) => file.path}
                                    card={FILE_CARD}
                                    rows={2}
                                    compact
                                    renderCard={(file) => {
                                        const isActive = activeChangedFile?.project_id === project.id && activeChangedFile.path === file.path;
                                        return (
                                            <button
                                                type="button"
                                                className={`projects-tile projects-tile-file ${isActive ? 'active' : ''}`}
                                                title={file.path}
                                                onClick={() => onOpenChangedFile(file.path)}
                                            >
                                                <FileIcon path={file.path} styleType={fileIconsStyle} className="projects-tile-icon" />
                                                <span className="projects-tile-body">
                                                    <span className={`projects-tile-title ${statusTextColors[file.status]}`}>{baseName(file.path)}</span>
                                                    <span className="projects-tile-subtitle">
                                                        {(file.added ?? 0) > 0 && <span className="projects-stat-added">+{file.added}</span>}
                                                        {(file.removed ?? 0) > 0 && <span className="projects-stat-removed">-{file.removed}</span>}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    }}
                                />
                            </PanelSection>
                        )}

                        {projectTerminals.length > 0 && (
                            <PanelSection title="Terminals" count={projectTerminals.length}>
                                <CardStrip
                                    items={projectTerminals}
                                    getKey={(terminal) => terminal.id}
                                    card={TERMINAL_CARD}
                                    rows={1}
                                    renderCard={(terminal) => (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            className={`projects-terminal-card ${activeTerminalId === terminal.id ? 'active' : ''}`}
                                            onClick={() => onSelectTerminal(terminal.id)}
                                            onKeyDown={(event) => {
                                                if (event.target !== event.currentTarget) return;
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    onSelectTerminal(terminal.id);
                                                }
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className="projects-terminal-card-close"
                                                title={`Close term: ${terminal.name}`}
                                                aria-label={`Close term: ${terminal.name}`}
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onCloseTerminal(terminal.id);
                                                }}
                                            >
                                                <Icons.CloseSmall />
                                            </button>
                                            <span className="projects-terminal-card-name">
                                                <Icons.Terminal />
                                                <span>term: {terminal.name}</span>
                                            </span>
                                            {terminalTitles[terminal.id] && (
                                                <span className="projects-terminal-card-title" title={terminalTitles[terminal.id]}>
                                                    {terminalTitles[terminal.id]}
                                                </span>
                                            )}
                                            {terminalLastCommands[terminal.id] && (
                                                <span className="projects-terminal-card-command" title={terminalLastCommands[terminal.id]}>
                                                    {terminalLastCommands[terminal.id]}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                />
                            </PanelSection>
                        )}

                        {projectAgents.length > 0 && (
                            <PanelSection title="Agents" count={projectAgents.length}>
                                <CardStrip
                                    items={projectAgents}
                                    getKey={(session) => session.agentId}
                                    card={AGENT_CARD}
                                    rows={1}
                                    renderCard={(session) => (
                                        <div className={`projects-agent ${activeAgentId === session.agentId ? 'active' : ''}`}>
                                            <AcpOpenedAgentCard
                                                session={session}
                                                availableAgents={availableAgents}
                                                projects={projects}
                                                onSelectAgent={onSelectAgent}
                                                onCloseAgent={onCloseAgent}
                                            />
                                        </div>
                                    )}
                                />
                            </PanelSection>
                        )}
                    </section>
                );
            })}
            {onAddProject && (
                <button
                    type="button"
                    className="projects-add-project"
                    disabled={isAddingProject}
                    onClick={(event) => onAddProject(
                        event.currentTarget,
                        event.currentTarget.closest<HTMLElement>('.projects-panel'),
                    )}
                >
                    <Icons.Plus size={12} />
                    <span>Add project</span>
                </button>
            )}
        </div>
    </div>
);
