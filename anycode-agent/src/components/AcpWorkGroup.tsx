import React, { useState, useEffect, useRef } from 'react';
import { AcpIcons } from './AcpIcons';
import './AcpWorkGroup.css';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

interface AcpWorkGroupProps {
  isLatest: boolean;
  messageCount: number;
  editCount: number;
  searchActive?: boolean;
  isSearchMatch?: boolean;
  onExpansionChange?: () => void;
  // The user's own choice from an earlier mount, applied when the group mounts again.
  storedExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: React.ReactNode;
}

export const AcpWorkGroup: React.FC<AcpWorkGroupProps> = ({
  isLatest,
  messageCount,
  editCount,
  searchActive = false,
  isSearchMatch = false,
  onExpansionChange,
  storedExpanded,
  onExpandedChange,
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(storedExpanded ?? isLatest);
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

  // The active group shows its header already expanded; it collapses once it becomes historical.
  if (messageCount <= 1) {
    return <>{children}</>;
  }

  const edits = editCount > 0 && <span className="acp-work-group-edits">{plural(editCount, 'edit')}</span>;

  const collapsedAfterLatestTransition = previousIsLatestRef.current && !isLatest && !isSearchMatch;
  const renderedExpanded = collapsedAfterLatestTransition ? false : isExpanded;

  return (
    <div className={`acp-work-group ${renderedExpanded ? 'expanded' : 'collapsed'}`}>
      <div 
        className="acp-work-group-header" 
        onClick={() => {
          setIsExpanded(!isExpanded);
          onExpandedChange?.(!isExpanded);
          onExpansionChange?.();
        }}
      >
        <span className="acp-work-group-icon">
          <AcpIcons.ChevronRight />
        </span>
        <span className="acp-work-group-title">
          Worked ({plural(messageCount, 'step')}{editCount > 0 && ', '}{edits})
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
