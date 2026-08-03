import React, { useState, useEffect } from 'react';
import { AcpIcons } from './AcpIcons';
import './AcpWorkGroup.css';

interface AcpWorkGroupProps {
  isLatest: boolean;
  messageCount: number;
  searchActive?: boolean;
  isSearchMatch?: boolean;
  children: React.ReactNode;
}

export const AcpWorkGroup: React.FC<AcpWorkGroupProps> = ({
  isLatest,
  messageCount,
  searchActive = false,
  isSearchMatch = false,
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(isLatest);

  useEffect(() => {
    setIsExpanded(isLatest);
  }, [isLatest]);

  if (isSearchMatch) {
    return (
      <div className="acp-work-group expanded acp-work-group-search-match" data-search-expanded="true">
        <div className="acp-work-group-content">
          {children}
        </div>
      </div>
    );
  }

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
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="acp-work-group-icon">
          <AcpIcons.ChevronRight />
        </span>
        <span className="acp-work-group-title">
          worked ({messageCount} step{messageCount !== 1 ? 's' : ''})
        </span>
      </div>
      {isExpanded && !searchActive && (
        <div className="acp-work-group-content">
          {children}
        </div>
      )}
    </div>
  );
};
