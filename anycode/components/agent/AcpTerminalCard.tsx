import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Icons } from '../Icons';
import { AcpIcons } from './AcpIcons';
import { AcpTerminalView } from './AcpTerminalView';
import { copyTextToClipboard, formatBytes } from '../../utils';
import { toolOutputCache } from '../../features/agents/toolOutputCache';
import './AcpTerminalCard.css';

export interface AcpTerminalCardProps {
  command: string;
  cwd?: string;
  exitCode?: number;
  isRunning?: boolean;
  isCancelled?: boolean;
  output?: string;
  errorOutput?: string;
  toolId?: string;
  sessionId?: string;
  hasFullOutput?: boolean;
  fullOutputBytes?: number;
  isTruncated?: boolean;
  onGetToolOutput?: (toolId: string, sessionId?: string) => Promise<string | null>;
}

export const formatCwd = (path?: string): string | undefined => {
  if (!path) return undefined;
  return path
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
};

export const AcpTerminalCard: React.FC<AcpTerminalCardProps> = ({
  command,
  cwd,
  exitCode,
  isRunning = false,
  isCancelled = false,
  output,
  errorOutput,
  toolId,
  sessionId,
  hasFullOutput,
  fullOutputBytes,
  isTruncated,
  onGetToolOutput,
}) => {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [isCommandExpanded, setIsCommandExpanded] = useState(false);
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [fullOutput, setFullOutput] = useState<string | null>(() => {
    return toolId ? (toolOutputCache.get(toolId) ?? null) : null;
  });
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!toolId) {
      setFullOutput(null);
      return;
    }
    const cached = toolOutputCache.get(toolId);
    setFullOutput(cached ?? null);
    return toolOutputCache.subscribe((expiredToolId) => {
      if (expiredToolId === toolId) {
        setFullOutput(null);
      }
    });
  }, [toolId]);

  const handleLoadFull = useCallback(async () => {
    if (!toolId || !onGetToolOutput) return;
    setIsLoadingFull(true);
    setLoadError(null);
    try {
      const content = await onGetToolOutput(toolId, sessionId);
      if (content) {
        toolOutputCache.set(toolId, content);
        setFullOutput(content);
      } else {
        setLoadError('Failed to load full output');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error loading output');
    } finally {
      setIsLoadingFull(false);
    }
  }, [toolId, sessionId, onGetToolOutput]);

  const handleCopyCommand = () => {
    void copyTextToClipboard(command);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  };

  const activeOutput = fullOutput ?? output;
  const isTruncatedOrHasFull = Boolean(hasFullOutput || isTruncated);
  const displayOutput = activeOutput ?? (isTruncatedOrHasFull ? output : undefined);
  const formattedCwd = formatCwd(cwd);

  const isLongCommand = useMemo(() => {
    return command.includes('\n') && command.trim().split('\n').length > 3;
  }, [command]);

  const isLongOutput = useMemo(() => {
    if (!displayOutput) return false;
    return displayOutput.trim().split('\n').length > 12;
  }, [displayOutput]);

  const isLongError = useMemo(() => {
    if (!errorOutput) return false;
    return errorOutput.trim().split('\n').length > 12;
  }, [errorOutput]);

  const handleCopyOutput = () => {
    const textToCopy = activeOutput ?? displayOutput ?? '';
    if (textToCopy) {
      void copyTextToClipboard(textToCopy);
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 1800);
    }
  };

  return (
    <div className="acp-terminal-card">
      {/* Titlebar / Command prompt line */}
      <div className="acp-terminal-card-header">
        <div className={`acp-terminal-prompt-line ${isCommandExpanded ? 'is-expanded' : ''}`}>
          {formattedCwd && (
            <>
              <span className="acp-terminal-cwd" title={cwd}>
                {formattedCwd}
              </span>{' '}
            </>
          )}
          <span className="acp-terminal-prompt-symbol">$</span>{' '}
          <span className="acp-terminal-command-text">{command}</span>
        </div>
        <div className="acp-terminal-card-actions">
          {isRunning && (
            <span className="acp-terminal-badge is-running">
              <span className="acp-terminal-pulse-dot" />
              running
            </span>
          )}
          {isCancelled && !isRunning && (
            <span className="acp-terminal-badge is-error">
              canceled
            </span>
          )}
          {exitCode !== undefined && exitCode !== 0 && !isCancelled && (
            <span className="acp-terminal-badge is-error">
              {`✗ ${exitCode}`}
            </span>
          )}
          {isLongCommand && (
            <button
              type="button"
              className="acp-terminal-icon-btn"
              onClick={() => setIsCommandExpanded(!isCommandExpanded)}
              title={isCommandExpanded ? 'Collapse command' : 'Expand command'}
              aria-label={isCommandExpanded ? 'Collapse command' : 'Expand command'}
            >
              {isCommandExpanded ? <AcpIcons.ChevronUp /> : <AcpIcons.ChevronDown />}
            </button>
          )}
          <button
            type="button"
            className="acp-terminal-icon-btn"
            onClick={handleCopyCommand}
            title={copiedCmd ? 'Copied!' : 'Copy command'}
          >
            {copiedCmd ? <Icons.Check /> : <Icons.Copy />}
          </button>
        </div>
      </div>

      {/* Seamless Terminal Output */}
      {displayOutput ? (
        <div className={`acp-terminal-card-output ${isOutputExpanded ? 'is-expanded' : ''}`}>
          <div className="acp-terminal-output-actions">
            {isLongOutput && (
              <button
                type="button"
                className="acp-terminal-icon-btn"
                onClick={() => setIsOutputExpanded(!isOutputExpanded)}
                title={isOutputExpanded ? 'Collapse output' : 'Expand output'}
                aria-label={isOutputExpanded ? 'Collapse output' : 'Expand output'}
              >
                {isOutputExpanded ? <AcpIcons.ChevronUp /> : <AcpIcons.ChevronDown />}
              </button>
            )}
            <button
              type="button"
              className="acp-terminal-icon-btn"
              onClick={handleCopyOutput}
              title={copiedOutput ? 'Copied!' : 'Copy output'}
              aria-label="Copy output"
            >
              {copiedOutput ? <Icons.Check /> : <Icons.Copy />}
            </button>
          </div>
          <AcpTerminalView
            content={displayOutput}
            variant="embedded"
            maxHeight={isOutputExpanded ? 460 : 220}
            showCopyButton={false}
          />
          {isTruncatedOrHasFull && !fullOutput && (
            <div className="acp-tool-output-truncated-notice" style={{ padding: '4px 10px 8px 10px' }}>
              <span>Output truncated ({fullOutputBytes ? formatBytes(fullOutputBytes) : 'large log'}).</span>
              <button
                type="button"
                className="acp-tool-output-load-btn"
                onClick={handleLoadFull}
                disabled={isLoadingFull || !onGetToolOutput}
              >
                {isLoadingFull ? 'Loading full log...' : 'Load full log'}
              </button>
              {loadError && <span className="acp-tool-output-error">{loadError}</span>}
            </div>
          )}
        </div>
      ) : isCancelled ? (
        <div className="acp-terminal-card-output is-empty">
          <span className="acp-terminal-empty-output">
            ✗ Cancelled by user
          </span>
        </div>
      ) : !isRunning && exitCode !== undefined ? (
        <div className="acp-terminal-card-output is-empty">
          <span className="acp-terminal-empty-output">
            {exitCode === 0 ? '(no output)' : `✗ Exited with code ${exitCode}`}
          </span>
        </div>
      ) : null}

      {/* Error Output if separate */}
      {errorOutput && errorOutput !== displayOutput && (
        <div className={`acp-terminal-card-output is-error ${isErrorExpanded ? 'is-expanded' : ''}`}>
          <div className="acp-terminal-output-actions">
            {isLongError && (
              <button
                type="button"
                className="acp-terminal-icon-btn"
                onClick={() => setIsErrorExpanded(!isErrorExpanded)}
                title={isErrorExpanded ? 'Collapse error' : 'Expand error'}
                aria-label={isErrorExpanded ? 'Collapse error' : 'Expand error'}
              >
                {isErrorExpanded ? <AcpIcons.ChevronUp /> : <AcpIcons.ChevronDown />}
              </button>
            )}
            <button
              type="button"
              className="acp-terminal-icon-btn"
              onClick={() => {
                void copyTextToClipboard(errorOutput);
                setCopiedOutput(true);
                setTimeout(() => setCopiedOutput(false), 1800);
              }}
              title={copiedOutput ? 'Copied!' : 'Copy error'}
              aria-label="Copy error"
            >
              {copiedOutput ? <Icons.Check /> : <Icons.Copy />}
            </button>
          </div>
          <AcpTerminalView
            content={errorOutput}
            isError
            variant="embedded"
            maxHeight={isErrorExpanded ? 460 : 220}
            showCopyButton={false}
          />
        </div>
      )}
    </div>
  );
};
