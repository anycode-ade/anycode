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
  Diff: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.5 6.75a.75.75 0 00-1.5 0V9H8.75a.75.75 0 000 1.5H11v2.25a.75.75 0 001.5 0V10.5h2.25a.75.75 0 000-1.5H12.5V6.75zM8.75 16a.75.75 0 000 1.5h6a.75.75 0 000-1.5h-6z"/>
      <path fillRule="evenodd" d="M5 1a2 2 0 00-2 2v18a2 2 0 002 2h14a2 2 0 002-2V7.018a2 2 0 00-.586-1.414l-4.018-4.018A2 2 0 0014.982 1H5zm-.5 2a.5.5 0 01.5-.5h9.982a.5.5 0 01.354.146l4.018 4.018a.5.5 0 01.146.354V21a.5.5 0 01-.5.5H5a.5.5 0 01-.5-.5V3z"/>
    </svg>
  ),
  SplitHorizontal: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 4.75V15.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  SplitVertical: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.75 10H15.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Close: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  ClearPane: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7L13 13M13 7L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  ActivateParent: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 15.2V8.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.4 10.8L10 8.2L12.6 10.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  SwapPanes: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M4 6.5H14.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.8 4.2L14.8 6.5L11.8 8.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 13.5H5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.2 11.2L5.2 13.5L8.2 15.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ToggleSplitDirection: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5V13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6.5 10H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M12.5 4.5L7 10L12.5 15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevronRight: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M7.5 4.5L13 10L7.5 15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};
