import React, { useState, useEffect, useRef } from 'react';
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
  const previousIsLatestRef = useRef(isLatest);

  useEffect(() => {
    // Search should reveal the matching group, but must not replace the
    // group's own state: the header remains interactive while searching.
    if (searchActive && (isLatest || isSearchMatch)) {
      setIsExpanded(true);
      if (isSearchMatch) {
        onExpansionChange?.();
      }
    } else if (previousIsLatestRef.current && !isLatest) {
      // A formerly active group becomes historical after the next user turn.
      // Collapse it instead of carrying over the active group's open state.
      setIsExpanded(false);
    }
    previousIsLatestRef.current = isLatest;
  }, [isLatest, isSearchMatch, onExpansionChange, searchActive]);

  if (isLatest && !searchActive) {
    return <>{children}</>;
  }

  const collapsedAfterLatestTransition = previousIsLatestRef.current && !isLatest && !isSearchMatch;
  const renderedExpanded = collapsedAfterLatestTransition ? false : isExpanded;

  return (
    <div className={`acp-work-group ${renderedExpanded ? 'expanded' : 'collapsed'}`}>
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
      {renderedExpanded && (
        <div className="acp-work-group-content">
          {children}
        </div>
      )}
    </div>
  );
};
