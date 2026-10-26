import React from 'react';
import { AgentIcon } from './AgentIcon';
import './AcpAvatar.css';

export interface AcpAvatarProps {
  type: 'user' | 'agent';
  agentTitle?: string;
  agentId?: string;
  avatar?: string | null;
  size?: number;
  className?: string;
  userAvatar?: string | null;
  userName?: string;
}

const UserFallbackIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M20 21a8 8 0 1 0-16 0" />
  </svg>
);

export const AcpAvatar: React.FC<AcpAvatarProps> = ({
  type,
  agentTitle,
  agentId,
  avatar,
  size,
  className = '',
  userAvatar,
  userName = 'You',
}) => {
  const hasImage = Boolean(type === 'user' ? userAvatar : avatar);
  const sizeStyle = size ? { width: `${size}px`, height: `${size}px` } : undefined;
  const effectiveIconSize = size ? Math.round(size * 0.75) : 18;

  if (type === 'user') {
    return (
      <div
        className={`acp-avatar acp-avatar-user ${hasImage ? 'has-image' : 'has-icon'} ${className}`}
        style={sizeStyle}
        title={userName}
        aria-label={userName}
      >
        {userAvatar ? (
          <img src={userAvatar} alt={userName} className="acp-avatar-image" />
        ) : (
          <UserFallbackIcon size={effectiveIconSize} />
        )}
      </div>
    );
  }

  const agentLabel = agentTitle || 'Agent';

  return (
    <div
      className={`acp-avatar acp-avatar-agent ${hasImage ? 'has-image' : 'has-icon'} ${className}`}
      style={sizeStyle}
      title={agentLabel}
      aria-label={agentLabel}
    >
      {avatar ? (
        <img src={avatar} alt={agentLabel} className="acp-avatar-image" />
      ) : (
        <AgentIcon name={agentTitle} id={agentId} size={effectiveIconSize} />
      )}
    </div>
  );
};
