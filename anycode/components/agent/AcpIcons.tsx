import React from 'react';

export const AcpIcons = {
  Search: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <circle cx="8.75" cy="8.75" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 12.5L16.5 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Add: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M10 5V15M5 10H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Duplicate: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  Mic: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M10 3a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor"/>
      <path d="M16 10a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5.006 5.917V18a1 1 0 1 0 2 0v-2.083A6 6 0 0 0 16 10Z" fill="currentColor"/>
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
  Sessions: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M5.5 5.5H14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.5 10H14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.5 14.5H11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Settings: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="5" r="1.5" fill="currentColor"/>
      <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
      <circle cx="10" cy="15" r="1.5" fill="currentColor"/>
    </svg>
  ),
  Send: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 15.5V5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M5.5 9.5L10 5L14.5 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Cancel: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor"/>
    </svg>
  ),
  Close: () => (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  CloseSmall: () => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  CloseMedium: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevronDown: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevronUp: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 10L8 6L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Diff: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.5 6.75a.75.75 0 00-1.5 0V9H8.75a.75.75 0 000 1.5H11v2.25a.75.75 0 001.5 0V10.5h2.25a.75.75 0 000-1.5H12.5V6.75zM8.75 16a.75.75 0 000 1.5h6a.75.75 0 000-1.5h-6z"/>
      <path fillRule="evenodd" d="M5 1a2 2 0 00-2 2v18a2 2 0 002 2h14a2 2 0 002-2V7.018a2 2 0 00-.586-1.414l-4.018-4.018A2 2 0 0014.982 1H5zm-.5 2a.5.5 0 01.5-.5h9.982a.5.5 0 01.354.146l4.018 4.018a.5.5 0 01.146.354V21a.5.5 0 01-.5.5H5a.5.5 0 01-.5-.5V3z"/>
    </svg>
  ),
  Follow: () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
      <path d="M12,10 C12,11.105 11.105,12 10,12 C8.895,12 8,11.105 8,10 C8,8.895 8.895,8 10,8 C11.105,8 12,8.895 12,10 M10,14 C7.794,14 6,12.206 6,10 C6,7.794 7.794,6 10,6 C12.206,6 14,7.794 14,10 C14,12.206 12.206,14 10,14 M10,4 C6.686,4 4,6.686 4,10 C4,13.314 6.686,16 10,16 C13.314,16 16,13.314 16,10 C16,6.686 13.314,4 10,4 M10,18 C5.589,18 2,14.411 2,10 C2,5.589 5.589,2 10,2 C14.411,2 18,5.589 18,10 C18,14.411 14.411,18 10,18 M10,0 C4.477,0 0,4.477 0,10 C0,15.523 4.477,20 10,20 C15.523,20 20,15.523 20,10 C20,4.477 15.523,0 10,0"/>
    </svg>
  ),
  ScrollDown: () => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M10 4.5V14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.5 10.5L10 15L14.5 10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Lock: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  Sparkles: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>
    </svg>
  ),
  Quote: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.5 8.5C9.5 13 7.5 16.8 4 19C6.8 16.5 7.2 13.5 7 11.8A3.8 3.8 0 1 1 9.5 8.5Zm10 0C19.5 13 17.5 16.8 14 19C16.8 16.5 17.2 13.5 17 11.8A3.8 3.8 0 1 1 19.5 8.5Z" />
    </svg>
  ),
  File: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
};
