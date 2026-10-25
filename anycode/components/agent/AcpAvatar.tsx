import React, { useState, useEffect } from 'react';
import { AgentIcon } from './AgentIcon';
import { Icons } from '../Icons';
import { useUserProfile, CHAT_AVATAR_SIZES } from '../../hooks/useUserProfile';
import { getAgentAvatar, subscribeAgents } from '../../agents';
import './AcpAvatar.css';

export interface AcpAvatarProps {
  type: 'user' | 'agent';
  agentTitle?: string;
  agentId?: string;
  avatar?: string;
  size?: number;
  className?: string;
}

export const AcpAvatar: React.FC<AcpAvatarProps> = ({
  type,
  agentTitle,
  agentId,
  avatar,
  size,
  className = '',
}) => {
  const { avatar: userAvatar, name: userName, chatAvatarSize } = useUserProfile();
  const effectiveIconSize = size ?? CHAT_AVATAR_SIZES[chatAvatarSize]?.iconSize ?? 18;

  const [agentAvatar, setAgentAvatar] = useState<string | null>(() => {
    if (type !== 'agent') return null;
    return avatar || getAgentAvatar(agentId, agentTitle);
  });

  useEffect(() => {
    if (type !== 'agent') return;
    const sync = () => {
      setAgentAvatar(avatar || getAgentAvatar(agentId, agentTitle));
    };
    sync();
    return subscribeAgents(sync);
  }, [type, agentId, agentTitle, avatar]);

  const effectiveAvatar = avatar || agentAvatar;
  const agentLabel = agentTitle || 'Agent';
  const hasImage = Boolean(type === 'user' ? userAvatar : effectiveAvatar);

  if (type === 'user') {
    const titleText = userName ? `You (${userName})` : 'You';
    return (
      <div className={`acp-avatar acp-avatar-user ${hasImage ? 'has-image' : 'has-icon'} ${className}`} title={titleText} aria-label={titleText}>
        {userAvatar ? (
          <img src={userAvatar} alt={titleText} className="acp-avatar-image" />
        ) : (
          <Icons.User size={effectiveIconSize} />
        )}
      </div>
    );
  }

  return (
    <div
      className={`acp-avatar acp-avatar-agent ${hasImage ? 'has-image' : 'has-icon'} ${className}`}
      title={agentLabel}
      aria-label={agentLabel}
    >
      {effectiveAvatar ? (
        <img src={effectiveAvatar} alt={agentLabel} className="acp-avatar-image" />
      ) : (
        <AgentIcon name={agentTitle} id={agentId} size={effectiveIconSize} />
      )}
    </div>
  );
};
