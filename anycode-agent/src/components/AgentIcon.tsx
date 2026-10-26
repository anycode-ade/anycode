import React from 'react';

export interface AgentIconProps {
  name?: string;
  id?: string;
  size?: number;
  className?: string;
}

export const hasBuiltinAgentIcon = (_id: string = '', _name: string = ''): boolean => {
  return false;
};

// Clean neutral Bot icon for generic AI agents
export const AgentIcon: React.FC<AgentIconProps> = ({
  size = 16,
  className = '',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
};
