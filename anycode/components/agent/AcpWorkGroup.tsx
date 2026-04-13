import React, { useEffect, useState } from 'react';
import { AcpIcons } from './AcpIcons';
import './AcpWorkGroup.css';

interface AcpWorkGroupProps {
  isLatest: boolean;
  messageCount: number;
  children: React.ReactNode;
}

export const AcpWorkGroup: React.FC<AcpWorkGroupProps> = ({ isLatest, messageCount, children }) => {
  const [isExpanded, setIsExpanded] = useState(isLatest);

  useEffect(() => {
    setIsExpanded(isLatest);
  }, [isLatest]);

  if (isLatest) {
    return (
      <>
        {children}
      </>
    );
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
      {isExpanded && (
        <div className="acp-work-group-content">
          {children}
        </div>
      )}
    </div>
  );
};
