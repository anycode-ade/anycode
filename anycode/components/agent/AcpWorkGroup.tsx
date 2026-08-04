import React, { useState, useEffect } from 'react';
import { AcpIcons } from './AcpIcons';
import './AcpWorkGroup.css';

interface AcpWorkGroupProps {
  isLatest: boolean;
  messageCount: number;
  searchActive?: boolean;
  isSearchMatch?: boolean;
  onExpansionChange?: () => void;
  children: React.ReactNode;
}

export const AcpWorkGroup: React.FC<AcpWorkGroupProps> = ({
  isLatest,
  messageCount,
  searchActive = false,
  isSearchMatch = false,
  onExpansionChange,
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(isLatest);

  useEffect(() => {
    // Search should reveal the matching group, but must not replace the
    // group's own state: the header remains interactive while searching.
    if (isLatest || isSearchMatch) {
      setIsExpanded(true);
      if (isSearchMatch) {
        onExpansionChange?.();
      }
    }
  }, [isLatest, isSearchMatch, onExpansionChange]);

  if (isLatest && !searchActive) {
    return (
      <>
        {children}
      </>
    )
  }

  return (
    <div className={`acp-work-group ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div 
        className="acp-work-group-header" 
        onClick={() => {
          setIsExpanded(!isExpanded);
          if (searchActive) {
            onExpansionChange?.();
          }
        }}
      >
        <span className="acp-work-group-icon">
          <AcpIcons.ChevronRight />
        </span>
        <span className="acp-work-group-title">
          worked ({messageCount} step{messageCount !== 1 ? 's' : ''})
        </span>
      </div>
      {isExpanded && (
        <div className="acp-work-group-content">
          {children}
        </div>
      )}
    </div>
  );
};
