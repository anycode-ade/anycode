import React, { useEffect, useRef, useState, useMemo } from 'react';
import { WTerm } from '@wterm/dom';
import { GhosttyCore } from '@wterm/ghostty';
import '@wterm/dom/css';
import './AcpTerminalView.css';
import { copyTextToClipboard } from '../../utils';
import { Icons } from '../Icons';

interface AcpTerminalViewProps {
  content: string;
  isError?: boolean;
  maxHeight?: number;
  variant?: 'standalone' | 'embedded';
  showCopyButton?: boolean;
}

const applyTerminalTheme = (element: HTMLElement) => {
  const rootStyles = getComputedStyle(document.documentElement);
  const background =
    rootStyles.getPropertyValue('--background-color').trim() ||
    rootStyles.getPropertyValue('--theme-background').trim() ||
    '#0a0a0a';
  const foreground =
    rootStyles.getPropertyValue('--foreground-color').trim() ||
    rootStyles.getPropertyValue('--theme-foreground').trim() ||
    '#f0f0f0';
  const selectionBackground =
    rootStyles.getPropertyValue('--theme-accent-background').trim() ||
    'rgba(86, 156, 214, 0.3)';

  element.style.setProperty('--term-bg', background);
  element.style.setProperty('--term-app-bg', background);
  element.style.setProperty('--term-fg', foreground);
  element.style.setProperty('--term-cursor', foreground);
  element.style.setProperty('--term-selection-bg', selectionBackground);
  element.style.setProperty('--term-font-family', 'var(--editor-font-family, "JetBrains Mono", monospace)');
  element.style.setProperty('--term-font-size', '12px');
  element.style.setProperty('--term-line-height', '1.4');
  element.style.setProperty('--term-row-height', '17px');
};

export const AcpTerminalView: React.FC<AcpTerminalViewProps> = ({
  content,
  isError = false,
  maxHeight = 220,
  variant = 'standalone',
  showCopyButton = variant !== 'embedded',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wtermRef = useRef<WTerm | null>(null);
  const coreRef = useRef<GhosttyCore | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastWrittenLenRef = useRef<number>(0);

  // Approximate height based on line count, bounded between min 20px and maxHeight
  const estimatedHeight = useMemo(() => {
    const trimmed = content.trimEnd();
    const lineCount = Math.max(1, trimmed ? trimmed.split('\n').length : 1);
    const computed = lineCount * 18 + (variant === 'embedded' ? 4 : 12);
    return Math.min(maxHeight, Math.max(20, computed));
  }, [content, maxHeight, variant]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    applyTerminalTheme(container);

    GhosttyCore.load({ scrollbackLimit: 2 * 1024 * 1024 })
      .then(async (core) => {
        if (cancelled) {
          core.dispose();
          return;
        }
        coreRef.current = core;

        const terminal = new WTerm(container, {
          core,
          cursorBlink: false,
          autoResize: true,
        });

        await terminal.init();
        if (cancelled) {
          terminal.destroy();
          core.dispose();
          return;
        }

        wtermRef.current = terminal;
        setIsReady(true);

        const normalized = content.replace(/\r?\n/g, '\r\n');
        terminal.write(normalized);
        lastWrittenLenRef.current = content.length;
      })
      .catch((err) => {
        console.error('Failed to initialize AcpTerminalView:', err);
      });

    return () => {
      cancelled = true;
      if (wtermRef.current) {
        wtermRef.current.destroy();
        wtermRef.current = null;
      }
      if (coreRef.current) {
        coreRef.current.dispose();
        coreRef.current = null;
      }
      setIsReady(false);
      lastWrittenLenRef.current = 0;
    };
  }, []);

  // Update content on streaming or updates
  useEffect(() => {
    const terminal = wtermRef.current;
    if (!isReady || !terminal) return;

    if (
      content.length > lastWrittenLenRef.current &&
      content.startsWith(content.slice(0, lastWrittenLenRef.current))
    ) {
      const newChunk = content.slice(lastWrittenLenRef.current);
      terminal.write(newChunk.replace(/\r?\n/g, '\r\n'));
      lastWrittenLenRef.current = content.length;
    } else if (content.length !== lastWrittenLenRef.current) {
      terminal.write('\x1bc'); // reset VT state
      terminal.write(content.replace(/\r?\n/g, '\r\n'));
      lastWrittenLenRef.current = content.length;
    }
  }, [content, isReady]);

  const handleCopy = () => {
    void copyTextToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={`acp-terminal-wrapper ${isError ? 'is-error' : ''} ${variant === 'embedded' ? 'is-embedded' : ''}`}>
      {showCopyButton && (
        <button
          type="button"
          className="acp-terminal-copy-btn"
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy terminal output"}
          aria-label="Copy terminal output"
        >
          {copied ? <Icons.Check /> : <Icons.Copy />}
        </button>
      )}
      <div
        ref={containerRef}
        className="acp-terminal-body"
        style={{ height: `${estimatedHeight}px` }}
      >
        {!isReady && (
          <pre className="acp-terminal-fallback">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};
