import { useState, useEffect, useCallback } from 'react';

const CHAT_FULL_WIDTH_KEY = 'anycode:chatFullWidth';
const EVENT_NAME = 'anycode:chat-full-width-change';

// Max width of the chat message column when full-width rows are turned off.
export const CHAT_CONSTRAINED_MAX_WIDTH = '800px';

// Full width is the default, so existing users see no change.
export const getChatFullWidth = (): boolean => {
  try {
    return localStorage.getItem(CHAT_FULL_WIDTH_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const applyChatFullWidthStyle = (fullWidth: boolean) => {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty(
      '--acp-chat-max-width',
      fullWidth ? 'none' : CHAT_CONSTRAINED_MAX_WIDTH,
    );
    // Lets CSS align non-message states (e.g. the starting screen) to the same column.
    document.documentElement.dataset.chatFullWidth = String(fullWidth);
  }
};

export const setChatFullWidth = (fullWidth: boolean) => {
  try {
    localStorage.setItem(CHAT_FULL_WIDTH_KEY, String(fullWidth));
  } catch (error) {
    console.error('Failed to save chat full width setting:', error);
  }
  applyChatFullWidthStyle(fullWidth);
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
};

// Initial apply, so the setting takes effect before the chat panel is opened.
if (typeof window !== 'undefined') {
  applyChatFullWidthStyle(getChatFullWidth());
}

export const useChatFullWidth = () => {
  const [fullWidth, setFullWidthState] = useState<boolean>(getChatFullWidth);

  useEffect(() => {
    const handler = () => {
      const next = getChatFullWidth();
      setFullWidthState(next);
      applyChatFullWidthStyle(next);
    };

    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const updateFullWidth = useCallback((next: boolean) => {
    setChatFullWidth(next);
  }, []);

  return { fullWidth, setFullWidth: updateFullWidth };
};
