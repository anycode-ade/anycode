import React, { useState } from 'react';
import {
  useUserProfile,
  type ChatAvatarSize,
} from '../hooks/useUserProfile';
import { Icons } from './Icons';
import { AvatarCropModal } from './AvatarCropModal';
import './UserProfileSettings.css';

const PREVIEW_SIZES: Record<ChatAvatarSize, number> = {
  compact: 40,
  small: 48,
  medium: 58,
  large: 68,
  xlarge: 78,
  huge: 88,
  giant: 98,
  massive: 108,
};

export const UserProfileSettings: React.FC = () => {
  const {
    avatar,
    avatarOriginal,
    setAvatar,
    chatAvatarSize,
    setChatAvatarSize,
  } = useUserProfile();

  const [isPopupOpen, setIsPopupOpen] = useState(false);

  const handleSaveAvatar = (
    croppedAvatar: string | null,
    originalDataUrl: string | null,
    newSize?: ChatAvatarSize
  ) => {
    setAvatar(croppedAvatar, originalDataUrl);
    if (newSize) {
      setChatAvatarSize(newSize);
    }
  };

  return (
    <div className="user-profile-settings">
      <div className="user-profile-card">
        <div className="user-profile-avatar-row">
          <div
            className="user-profile-avatar-preview"
            style={{
              width: `${PREVIEW_SIZES[chatAvatarSize]}px`,
              height: `${PREVIEW_SIZES[chatAvatarSize]}px`,
            }}
            onClick={() => setIsPopupOpen(true)}
            title="Click to customize avatar"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsPopupOpen(true);
              }
            }}
          >
            {avatar ? (
              <img src={avatar} alt="User Avatar" className="user-profile-avatar-img" />
            ) : (
              <div className="user-profile-avatar-placeholder">
                <Icons.User size={Math.round(PREVIEW_SIZES[chatAvatarSize] * 0.48)} />
              </div>
            )}
            <div className="user-profile-avatar-overlay">
              <span className="user-profile-avatar-upload-icon">✏️</span>
            </div>
          </div>

          <div className="user-profile-avatar-details">
            <button
              type="button"
              className="user-profile-btn secondary user-profile-customize-btn"
              onClick={() => setIsPopupOpen(true)}
            >
              {avatar ? 'Customize avatar…' : 'Set avatar…'}
            </button>
          </div>
        </div>
      </div>

      <AvatarCropModal
        isOpen={isPopupOpen}
        onClose={() => setIsPopupOpen(false)}
        currentAvatar={avatar}
        currentOriginal={avatarOriginal}
        chatAvatarSize={chatAvatarSize}
        onSave={handleSaveAvatar}
      />
    </div>
  );
};
