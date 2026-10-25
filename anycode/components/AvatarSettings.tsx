import React, { useState, useEffect } from 'react';
import {
  useUserProfile,
  CHAT_AVATAR_SIZES,
  CHAT_AVATAR_SIZE_KEYS,
} from '../hooks/useUserProfile';
import {
  getDefaultAgentAvatar,
  getDefaultAgentAvatarOriginal,
  setDefaultAgentAvatar,
  subscribeAgents,
} from '../agents';
import { Icons } from './Icons';
import { AvatarCropModal } from './AvatarCropModal';
import './UserProfileSettings.css';

export const AvatarSettings: React.FC = () => {
  const {
    avatar: userAvatar,
    avatarOriginal: userAvatarOriginal,
    setAvatar: setUserAvatar,
    chatAvatarSize,
    setChatAvatarSize,
  } = useUserProfile();

  const [agentAvatar, setAgentAvatar] = useState<string | null>(getDefaultAgentAvatar);
  const [agentAvatarOriginal, setAgentAvatarOriginal] = useState<string | null>(getDefaultAgentAvatarOriginal);

  useEffect(() => {
    const handler = () => {
      setAgentAvatar(getDefaultAgentAvatar());
      setAgentAvatarOriginal(getDefaultAgentAvatarOriginal());
    };
    const unsubscribe = subscribeAgents(handler);
    window.addEventListener('storage', handler);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', handler);
    };
  }, []);

  const previewPx = CHAT_AVATAR_SIZES[chatAvatarSize]?.px ?? 28;
  const previewIconSize = CHAT_AVATAR_SIZES[chatAvatarSize]?.iconSize ?? 18;

  const [editingTarget, setEditingTarget] = useState<'agent' | 'user' | null>(null);

  const handleSaveAvatar = (
    croppedAvatar: string | null,
    originalDataUrl: string | null
  ) => {
    if (editingTarget === 'agent') {
      setDefaultAgentAvatar(croppedAvatar, originalDataUrl);
    } else if (editingTarget === 'user') {
      setUserAvatar(croppedAvatar, originalDataUrl);
    }
  };

  return (
    <div className="avatar-settings-container">
      {/* Top: User Avatar first (left), Agent Avatar beside it (right) */}
      <div className="avatar-settings-avatars-row">
        {/* User Avatar */}
        <div className="avatar-settings-card">
          <div className="avatar-settings-card-header">
            <span className="avatar-settings-card-title">User Avatar</span>
          </div>
          <div className="user-profile-avatar-row">
            <div className="avatar-settings-preview-slot">
              <div
                className="user-profile-avatar-preview"
                style={{
                  width: `${previewPx}px`,
                  height: `${previewPx}px`,
                }}
                onClick={() => setEditingTarget('user')}
                title={`Click to customize user avatar (${previewPx}px)`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditingTarget('user');
                  }
                }}
              >
                {userAvatar ? (
                  <img src={userAvatar} alt="User Avatar" className="user-profile-avatar-img" />
                ) : (
                  <div className="user-profile-avatar-placeholder">
                    <Icons.User size={previewIconSize} />
                  </div>
                )}
                <div className="user-profile-avatar-overlay">
                  <span className="user-profile-avatar-upload-icon">✏️</span>
                </div>
              </div>
            </div>

            <div className="user-profile-avatar-details">
              <button
                type="button"
                className="avatar-settings-customize-btn"
                onClick={() => setEditingTarget('user')}
              >
                <Icons.Edit size={12} />
                <span>{userAvatar ? 'Customize…' : 'Set avatar…'}</span>
              </button>
              <span className="user-profile-avatar-meta">
                Your profile avatar in chat
              </span>
            </div>
          </div>
        </div>

        {/* Agent Avatar */}
        <div className="avatar-settings-card">
          <div className="avatar-settings-card-header">
            <span className="avatar-settings-card-title">Agent Avatar</span>
          </div>
          <div className="user-profile-avatar-row">
            <div className="avatar-settings-preview-slot">
              <div
                className="user-profile-avatar-preview"
                style={{
                  width: `${previewPx}px`,
                  height: `${previewPx}px`,
                }}
                onClick={() => setEditingTarget('agent')}
                title={`Click to customize default agent avatar (${previewPx}px)`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditingTarget('agent');
                  }
                }}
              >
                {agentAvatar ? (
                  <img src={agentAvatar} alt="Agent Avatar" className="user-profile-avatar-img" />
                ) : (
                  <div className="user-profile-avatar-placeholder">
                    <Icons.Agent size={previewIconSize} />
                  </div>
                )}
                <div className="user-profile-avatar-overlay">
                  <span className="user-profile-avatar-upload-icon">✏️</span>
                </div>
              </div>
            </div>

            <div className="user-profile-avatar-details">
              <button
                type="button"
                className="avatar-settings-customize-btn"
                onClick={() => setEditingTarget('agent')}
              >
                <Icons.Edit size={12} />
                <span>{agentAvatar ? 'Customize…' : 'Set avatar…'}</span>
              </button>
              <span className="user-profile-avatar-meta">
                Default for all agents
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Below: Chat size */}
      <div className="avatar-settings-size-section">
        <div className="avatar-settings-size-header">
          <span className="avatar-settings-size-label">Chat size:</span>
          <span className="avatar-settings-size-val">
            {CHAT_AVATAR_SIZES[chatAvatarSize].label} ({CHAT_AVATAR_SIZES[chatAvatarSize].px}px)
          </span>
        </div>
        <div className="user-profile-size-segmented" role="radiogroup" aria-label="Chat avatar size">
          {CHAT_AVATAR_SIZE_KEYS.map((sizeKey) => {
            const cfg = CHAT_AVATAR_SIZES[sizeKey];
            const isSelected = chatAvatarSize === sizeKey;
            return (
              <button
                key={sizeKey}
                type="button"
                className={`user-profile-size-pill ${isSelected ? 'active' : ''}`}
                onClick={() => setChatAvatarSize(sizeKey)}
                title={`${cfg.label} (${cfg.px}px)`}
                role="radio"
                aria-checked={isSelected}
              >
                {cfg.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {editingTarget && (
        <AvatarCropModal
          isOpen={true}
          onClose={() => setEditingTarget(null)}
          title={editingTarget === 'agent' ? 'Default Agent Avatar' : 'User Avatar'}
          currentAvatar={editingTarget === 'agent' ? agentAvatar : userAvatar}
          currentOriginal={editingTarget === 'agent' ? agentAvatarOriginal : userAvatarOriginal}
          onSave={handleSaveAvatar}
        />
      )}
    </div>
  );
};
