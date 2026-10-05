import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { AcpAgent, AcpSessionSummary } from '../../types';
import { AgentIcon } from './AgentIcon';
import { AcpIcons } from './AcpIcons';
import './AcpSessionsView.css';

export interface AcpSessionsViewProps {
  agent: AcpAgent;
  baseName: string;
  onClose: () => void;
  onLoadSessions: (agent: AcpAgent) => Promise<AcpSessionSummary[]>;
  onResumeSession: (agent: AcpAgent, sessionId: string) => void;
}

const ITEM_HEIGHT = 60;
const ITEM_GAP = 8;
const ROW_HEIGHT = ITEM_HEIGHT + ITEM_GAP;
const OVERSCAN_PX = 200;

export function formatTimeAgo(dateInput?: string | number | null): string | null {
  if (!dateInput) return null;

  let timestamp: number;
  if (typeof dateInput === 'number') {
    timestamp = dateInput < 1e11 ? dateInput * 1000 : dateInput;
  } else {
    const raw = String(dateInput).trim();
    if (!raw) return null;
    const num = Number(raw);
    if (!isNaN(num) && num > 0) {
      timestamp = num < 1e11 ? num * 1000 : num;
    } else {
      const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
      timestamp = Date.parse(normalized);
      if (isNaN(timestamp)) {
        timestamp = Date.parse(raw);
      }
    }
  }

  if (isNaN(timestamp)) {
    return String(dateInput);
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

export const AcpSessionsView: React.FC<AcpSessionsViewProps> = ({
  agent,
  baseName,
  onClose,
  onLoadSessions,
  onResumeSession,
}) => {
  const [sessions, setSessions] = useState<AcpSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchVisible, setIsSearchVisible] = useState<boolean>(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await onLoadSessions(agent);
      setSessions(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, [agent, onLoadSessions]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [agent.id, searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
        } else if (isSearchVisible) {
          setIsSearchVisible(false);
        } else {
          onClose();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchVisible(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, searchQuery, isSearchVisible]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const titleMatch = s.title?.toLowerCase().includes(q) ?? false;
      const previewMatch = s.preview?.toLowerCase().includes(q) ?? false;
      const idMatch = s.sessionId.toLowerCase().includes(q);
      const dateMatch = s.updatedAt?.toLowerCase().includes(q) ?? false;
      const timeAgo = formatTimeAgo(s.updatedAt)?.toLowerCase();
      const timeAgoMatch = timeAgo ? timeAgo.includes(q) : false;
      return titleMatch || previewMatch || idMatch || dateMatch || timeAgoMatch;
    });
  }, [sessions, searchQuery]);

  const totalHeight = filteredSessions.length > 0 ? filteredSessions.length * ROW_HEIGHT - ITEM_GAP : 0;

  const visibleIndices = useMemo(() => {
    if (filteredSessions.length === 0) return [];
    const start = Math.max(0, Math.floor((scrollTop - OVERSCAN_PX) / ROW_HEIGHT));
    const end = Math.min(filteredSessions.length - 1, Math.ceil((scrollTop + viewportHeight + OVERSCAN_PX) / ROW_HEIGHT));
    const indices: number[] = [];
    for (let i = start; i <= end; i++) {
      indices.push(i);
    }
    return indices;
  }, [filteredSessions.length, scrollTop, viewportHeight]);

  return (
    <div className="acp-sessions-view-container">
      <div className="acp-sessions-view-header">
        <div className="acp-sessions-view-title-wrap">
          <AgentIcon name={baseName} id={agent.id} size={18} className="acp-sessions-view-icon" />
          <h3 className="acp-sessions-view-title">
            {baseName} Sessions
          </h3>
          {agent.profile && (
            <span className="acp-sessions-view-profile-badge">
              {agent.profile}
            </span>
          )}
        </div>
        <div className="acp-sessions-view-header-actions">
          <button
            className={`acp-sessions-view-action-btn ${isLoading ? 'is-loading' : ''}`}
            onClick={loadSessions}
            disabled={isLoading}
            title="Refresh sessions"
            type="button"
          >
            <AcpIcons.Refresh />
          </button>
          <button
            className={`acp-sessions-view-action-btn ${isSearchVisible ? 'active' : ''}`}
            onClick={() => {
              setIsSearchVisible((prev) => {
                const next = !prev;
                if (!next) {
                  setSearchQuery('');
                } else {
                  setTimeout(() => searchInputRef.current?.focus(), 0);
                }
                return next;
              });
            }}
            title={isSearchVisible ? 'Hide search' : 'Search sessions (⌘F)'}
            type="button"
          >
            <AcpIcons.Search />
          </button>
          <button
            className="acp-sessions-view-close-btn"
            onClick={onClose}
            title="Close (Esc)"
            type="button"
          >
            <AcpIcons.CloseMedium />
          </button>
        </div>
      </div>

      {isSearchVisible && (
        <div className="acp-sessions-view-search-bar">
          <svg className="acp-sessions-view-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            autoFocus
            placeholder="Search sessions by title, date, or ID... (Esc to close)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="acp-sessions-view-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
              type="button"
            >
              <AcpIcons.CloseSmall />
            </button>
          )}
        </div>
      )}

      <div
        ref={listRef}
        className="acp-sessions-view-content"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {isLoading ? (
          <div className="acp-sessions-view-state">
            <span className="acp-sessions-view-spinner" />
            <span>Loading saved sessions...</span>
          </div>
        ) : error ? (
          <div className="acp-sessions-view-state error">
            <span>{error}</span>
            <button className="acp-sessions-view-retry-btn" onClick={loadSessions} type="button">
              Retry
            </button>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="acp-sessions-view-state empty">
            <div className="acp-sessions-view-empty-icon">
              <AcpIcons.Search />
            </div>
            {searchQuery.trim() ? (
              <>
                <span>No sessions matching &quot;{searchQuery}&quot;</span>
                <button
                  className="acp-sessions-view-retry-btn"
                  onClick={() => setSearchQuery('')}
                  type="button"
                >
                  Clear search
                </button>
              </>
            ) : (
              <span>No saved sessions found for {baseName} in this project</span>
            )}
          </div>
        ) : (
          <div className="acp-sessions-view-list">
            <div className="acp-sessions-view-spacer" style={{ height: totalHeight }}>
              {visibleIndices.map((index) => {
                const session = filteredSessions[index];
                if (!session) return null;
                const top = index * ROW_HEIGHT;
                return (
                  <div
                    key={session.sessionId}
                    className="acp-sessions-view-item"
                    style={{
                      transform: `translateY(${top}px)`,
                      height: `${ITEM_HEIGHT}px`,
                    }}
                  >
                    <div className="acp-sessions-view-item-info">
                      <div className="acp-sessions-view-item-title" title={session.preview || session.title || session.sessionId}>
                        {session.preview || session.title || 'Untitled Session'}
                      </div>
                      <div className="acp-sessions-view-item-meta">
                        {session.updatedAt && (
                          <span className="acp-sessions-view-item-date" title={session.updatedAt}>
                            {formatTimeAgo(session.updatedAt)}
                          </span>
                        )}
                        <span className="acp-sessions-view-item-id" title={`Session ID: ${session.sessionId}`}>
                          {session.sessionId}
                        </span>
                      </div>
                    </div>
                    <button
                      className="acp-sessions-view-resume-btn"
                      onClick={() => {
                        onResumeSession(agent, session.sessionId);
                        onClose();
                      }}
                      type="button"
                    >
                      Resume
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
