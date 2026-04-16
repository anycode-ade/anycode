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
  ChevronUpDown: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 4L7.5 6.5M10 4L12.5 6.5M10 4V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 16L7.5 13.5M10 16L12.5 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
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
};
