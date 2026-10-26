import React, { useState, useRef, useEffect } from 'react';
import { AcpIcons } from './AcpIcons';
import { copyTextToClipboard } from '../utils/helpers';

export const CodeCopyButton: React.FC<{ content: string; className?: string }> = ({
  content,
  className = 'acp-code-copy-button',
}) => {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleCopy = async () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }

    try {
      await copyTextToClipboard(content);
      setCopyStatus('copied');
    } catch (error) {
      console.warn('Failed to copy code block:', error);
      setCopyStatus('error');
    }

    copyResetTimerRef.current = setTimeout(() => {
      setCopyStatus('idle');
    }, 1800);
  };

  const copyButtonLabel =
    copyStatus === 'copied'
      ? 'Code copied'
      : copyStatus === 'error'
        ? 'Copy failed'
        : 'Copy code';

  return (
    <button
      type="button"
      className={className}
      onClick={handleCopy}
      aria-label={copyButtonLabel}
      title={copyButtonLabel}
      data-copy-status={copyStatus}
    >
      {copyStatus === 'copied' ? <AcpIcons.Check size={13} /> : <AcpIcons.Copy size={13} />}
    </button>
  );
};
