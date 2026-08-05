export const Icons = {
  LeftPanelClosed: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="5" y="5" width="5" height="10" rx="0.5" fill="currentColor"/>
    </svg>
  ),
  LeftPanelOpened: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="5" y="5" width="5" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" opacity="0.2"/>
    </svg>
  ),
  Search: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M16.6725 16.6412L21 21M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Crosshair: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="2.8" />
      <path d="M12 1.5V4.5M12 19.5V22.5M1.5 12H4.5M19.5 12H22.5" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  Tree: () => (
    <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
      <path d="M26,30H42a2,2,0,0,0,2-2V20a2,2,0,0,0-2-2H26a2,2,0,0,0-2,2v2H16V14h6a2,2,0,0,0,2-2V4a2,2,0,0,0-2-2H6A2,2,0,0,0,4,4v8a2,2,0,0,0,2,2h6V40a2,2,0,0,0,2,2H24v2a2,2,0,0,0,2,2H42a2,2,0,0,0,2-2V36a2,2,0,0,0-2-2H26a2,2,0,0,0-2,2v2H16V26h8v2A2,2,0,0,0,26,30Z" fill="currentColor"/>
    </svg>
  ),
  BottomPanelClosed: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="5" y="10" width="10" height="5" rx="0.5" fill="currentColor"/>
    </svg>
  ),
  BottomPanelOpened: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="5" y="10" width="10" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" opacity="0.2"/>
    </svg>
  ),
  RightPanelClosed: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="11" y="5" width="4" height="10" rx="0.5" fill="currentColor"/>
    </svg>
  ),
  RightPanelOpened: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="11" y="5" width="4" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" opacity="0.2"/>
    </svg>
  ),
  EditorClosed: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="7" y="5" width="6" height="10" rx="0.5" fill="currentColor"/>
    </svg>
  ),
  EditorOpened: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <rect x="7" y="5" width="6" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" opacity="0.2"/>
    </svg>
  ),
  Git: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <circle cx="16" cy="6" r="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <path d="M6 8V16" stroke="currentColor" strokeWidth="2"/>
      <path d="M16 8V12C16 14 14 16 12 16H8" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  GitCommit: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 7L10 17L5 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  GitPull: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 15L12 19L16 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  GitPush: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 10L12 6L16 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Refresh: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 5V10H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 19V14H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 10C18.7 6.9 15.7 5 12.4 5C8.8 5 5.6 7.2 4.3 10.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 14C5.3 17.1 8.3 19 11.6 19C15.2 19 18.4 16.8 19.7 13.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  ChevronUpDown: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 4L7.5 6.5M10 4L12.5 6.5M10 4V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 16L7.5 13.5M10 16L12.5 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M6.5 8L10 11.5L13.5 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevronUp: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M6.5 12L10 8.5L13.5 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  LayoutSplitRight: () => (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="layout-header-action-icon">
      <rect x="2" y="3" width="4" height="10" rx="1" />
      <rect x="10" y="3" width="4" height="10" rx="1" />
      <rect x="7" y="2" width="2" height="12" rx="1" />
    </svg>
  ),
  LayoutSplitDown: () => (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="layout-header-action-icon">
      <rect x="3" y="2" width="10" height="4" rx="1" />
      <rect x="3" y="10" width="10" height="4" rx="1" />
      <rect x="2" y="7" width="12" height="2" rx="1" />
    </svg>
  ),
  LayoutClose: () => (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="layout-header-action-icon">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  LayoutDiff: () => (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="layout-header-action-icon">
      <g className="layout-diff-plus" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round">
        <path d="M8 1.4V7.6" />
        <path d="M4.4 4.5H11.6" />
      </g>
      <g className="layout-diff-minus" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round">
        <path d="M4.4 11.5H11.6" />
      </g>
    </svg>
  ),
  Pin: () => (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: 'rotate(45deg)', display: 'block' }}
    >
      <path d="M12 17v5" strokeWidth="3" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.89a1 1 0 0 0-.53.76c-.08.56.32 1.08.89 1.08h11.06a1 1 0 0 0 .89-1.08c-.08-.56-.37-.67-.53-.76l-1.78-.89A2 2 0 0 1 15 10.76V6a2 2 0 0 1 2-2v0a2 2 0 0 1-2-2H9a2 2 0 0 1-2 2v0a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Files: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  Editor: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  Terminal: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  Agent: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" />
      <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5z" opacity="0.75" fill="currentColor" stroke="none" />
      <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" opacity="0.75" fill="currentColor" stroke="none" />
    </svg>
  ),
  Browser: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="6" y1="7" x2="6" y2="7.01" />
      <line x1="10" y1="7" x2="10" y2="7.01" />
      <line x1="14" y1="7" x2="14" y2="7.01" />
    </svg>
  ),
  Settings: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  ArrowLeft: () => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="layout-header-action-icon">
      <path d="M11 3L5 8L11 13" />
    </svg>
  ),
  Close: ({ size = 8 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M4 4L12 12M12 4L4 12" />
    </svg>
  ),
  Trash: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
};
