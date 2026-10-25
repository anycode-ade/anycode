import { useState, useEffect, useCallback } from 'react';

const USER_AVATAR_KEY = 'anycode:userAvatar';
const USER_AVATAR_ORIGINAL_KEY = 'anycode:userAvatarOriginal';
const USER_NAME_KEY = 'anycode:userName';
const CHAT_AVATAR_SIZE_KEY = 'anycode:chatAvatarSize';
const EVENT_NAME = 'anycode:user-profile-change';

export type ChatAvatarSize =
  | 'compact'
  | 'small'
  | 'medium'
  | 'large'
  | 'xlarge'
  | 'huge'
  | 'giant'
  | 'massive';

export const CHAT_AVATAR_SIZES: Record<
  ChatAvatarSize,
  { label: string; shortLabel: string; px: number; iconSize: number }
> = {
  compact: { label: 'Extra Small', shortLabel: 'XS', px: 18, iconSize: 13 },
  small: { label: 'Small', shortLabel: 'S', px: 22, iconSize: 16 },
  medium: { label: 'Medium', shortLabel: 'M', px: 28, iconSize: 20 },
  large: { label: 'Large', shortLabel: 'L', px: 36, iconSize: 26 },
  xlarge: { label: 'Extra Large', shortLabel: 'XL', px: 46, iconSize: 32 },
  huge: { label: 'Huge', shortLabel: '2XL', px: 58, iconSize: 40 },
  giant: { label: 'Giant', shortLabel: '3XL', px: 72, iconSize: 50 },
  massive: { label: 'Massive', shortLabel: '4XL', px: 88, iconSize: 60 },
};

export const CHAT_AVATAR_SIZE_KEYS: ChatAvatarSize[] = [
  'compact',
  'small',
  'medium',
  'large',
  'xlarge',
  'huge',
  'giant',
  'massive',
];

export const DEFAULT_CHAT_AVATAR_SIZE: ChatAvatarSize = 'medium';

export const getChatAvatarSize = (): ChatAvatarSize => {
  try {
    const val = localStorage.getItem(CHAT_AVATAR_SIZE_KEY);
    if (val && val in CHAT_AVATAR_SIZES) {
      return val as ChatAvatarSize;
    }
  } catch {}
  return DEFAULT_CHAT_AVATAR_SIZE;
};

export const applyChatAvatarSizeStyle = (size: ChatAvatarSize) => {
  const px = CHAT_AVATAR_SIZES[size]?.px || 28;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--acp-chat-avatar-size', `${px}px`);
  }
};

export const setChatAvatarSize = (size: ChatAvatarSize) => {
  try {
    localStorage.setItem(CHAT_AVATAR_SIZE_KEY, size);
  } catch (error) {
    console.error('Failed to save chat avatar size:', error);
  }
  applyChatAvatarSizeStyle(size);
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
};

// Initial apply
if (typeof window !== 'undefined') {
  applyChatAvatarSizeStyle(getChatAvatarSize());
}

export const getUserAvatar = (): string | null => {
  try {
    return localStorage.getItem(USER_AVATAR_KEY);
  } catch {
    return null;
  }
};

export const getUserAvatarOriginal = (): string | null => {
  try {
    return localStorage.getItem(USER_AVATAR_ORIGINAL_KEY);
  } catch {
    return null;
  }
};

export const setUserAvatarOriginal = (dataUrl: string | null) => {
  try {
    if (dataUrl) {
      localStorage.setItem(USER_AVATAR_ORIGINAL_KEY, dataUrl);
    } else {
      localStorage.removeItem(USER_AVATAR_ORIGINAL_KEY);
    }
  } catch (error) {
    console.warn('Failed to save original user avatar:', error);
  }
};

export const setUserAvatar = (dataUrl: string | null, originalDataUrl?: string | null) => {
  try {
    if (dataUrl) {
      localStorage.setItem(USER_AVATAR_KEY, dataUrl);
      if (originalDataUrl !== undefined) {
        setUserAvatarOriginal(originalDataUrl);
      }
    } else {
      localStorage.removeItem(USER_AVATAR_KEY);
      localStorage.removeItem(USER_AVATAR_ORIGINAL_KEY);
    }
  } catch (error) {
    console.error('Failed to save user avatar:', error);
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
};

export const getUserName = (): string => {
  try {
    return localStorage.getItem(USER_NAME_KEY) || '';
  } catch {
    return '';
  }
};

export const setUserName = (name: string) => {
  try {
    if (name.trim()) {
      localStorage.setItem(USER_NAME_KEY, name.trim());
    } else {
      localStorage.removeItem(USER_NAME_KEY);
    }
  } catch (error) {
    console.error('Failed to save user name:', error);
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
};

export const prepareSourceImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 1200;
        if (img.width <= MAX_DIM && img.height <= MAX_DIM) {
          resolve(src);
          return;
        }
        const scale = Math.min(MAX_DIM / img.width, MAX_DIM / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const isTransparentType = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/svg+xml';
        const exportType = isTransparentType ? 'image/png' : 'image/jpeg';
        const exportQuality = isTransparentType ? undefined : 0.92;
        resolve(canvas.toDataURL(exportType, exportQuality));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = src;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

export const processAvatarImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 256;
        const width = img.width;
        const height = img.height;

        // Crop to square from center
        const minDim = Math.min(width, height);
        const startX = (width - minDim) / 2;
        const startY = (height - minDim) / 2;

        const targetDim = Math.min(minDim, MAX_SIZE);
        canvas.width = targetDim;
        canvas.height = targetDim;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, targetDim, targetDim);
        resolve(canvas.toDataURL('image/png', 0.92));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

export const useUserProfile = () => {
  const [avatar, setAvatarState] = useState<string | null>(getUserAvatar);
  const [avatarOriginal, setAvatarOriginalState] = useState<string | null>(getUserAvatarOriginal);
  const [name, setNameState] = useState<string>(getUserName);
  const [chatAvatarSize, setChatAvatarSizeState] = useState<ChatAvatarSize>(getChatAvatarSize);

  useEffect(() => {
    applyChatAvatarSizeStyle(getChatAvatarSize());

    const handler = () => {
      setAvatarState(getUserAvatar());
      setAvatarOriginalState(getUserAvatarOriginal());
      setNameState(getUserName());
      const nextSize = getChatAvatarSize();
      setChatAvatarSizeState(nextSize);
      applyChatAvatarSizeStyle(nextSize);
    };

    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const updateAvatar = useCallback((newAvatar: string | null, originalDataUrl?: string | null) => {
    setUserAvatar(newAvatar, originalDataUrl);
  }, []);

  const updateName = useCallback((newName: string) => {
    setUserName(newName);
  }, []);

  const updateChatAvatarSize = useCallback((newSize: ChatAvatarSize) => {
    setChatAvatarSize(newSize);
  }, []);

  return {
    avatar,
    avatarOriginal,
    setAvatar: updateAvatar,
    name,
    setName: updateName,
    chatAvatarSize,
    setChatAvatarSize: updateChatAvatarSize,
  };
};
