import React from 'react';
import './AcpInput.css';
import { AcpIcons } from './AcpIcons';
import type {
  AcpContextUsageMessage,
  AcpModelSelectorMessage,
  AcpReasoningSelectorMessage,
  AcpSelectOption,
} from '../../types';

interface AcpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  agentLabel?: string;
  onCloseAgent?: () => void;
  isConnected: boolean;
  isProcessing?: boolean;
  modelSelector?: Omit<AcpModelSelectorMessage, 'role'>;
  reasoningSelector?: Omit<AcpReasoningSelectorMessage, 'role'>;
  contextUsage?: Omit<AcpContextUsageMessage, 'role'>;
  onSelectModel?: (option: AcpSelectOption) => void;
  onSelectReasoning?: (option: AcpSelectOption) => void;
}

export const AcpInput: React.FC<AcpInputProps> = ({
  value,
  onChange,
  onSend,
  onCancel,
  agentLabel,
  isConnected,
  isProcessing = false,
  modelSelector,
  reasoningSelector,
  contextUsage,
  onSelectModel,
  onSelectReasoning,
}) => {
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [isMinimized, setIsMinimized] = React.useState(false);
  const MIN_ROWS = 3;
  const MAX_ROWS = 10;

  const resizeInput = React.useCallback(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    const style = window.getComputedStyle(input);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
    const verticalBox = paddingTop + paddingBottom + borderTop + borderBottom;
    const minHeight = lineHeight * MIN_ROWS + verticalBox;
    const maxHeight = lineHeight * MAX_ROWS + verticalBox;

    input.style.height = 'auto';
    const nextHeight = Math.min(Math.max(input.scrollHeight, minHeight), maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  React.useLayoutEffect(() => {
    resizeInput();
  }, [value, resizeInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && isConnected && !isProcessing) {
        onSend();
      }
    }
  };

  const handleSend = () => {
    if (value.trim() && isConnected) {
      onSend();
    }
  };

  const formatContextPercent = (used: number, size: number): string => {
    if (size <= 0) {
      return '0%';
    }

    const percent = Math.min(100, Math.round((used / size) * 100));
    return `${percent}%`;
  };

  const formatContextTitle = (used: number, size: number): string => {
    const percent = formatContextPercent(used, size);
    return `${used} / ${size} (${percent})`;
  };

  const renderSelect = (
    id: string,
    name: string,
    selector: Omit<AcpModelSelectorMessage, 'role'> | Omit<AcpReasoningSelectorMessage, 'role'> | undefined,
    onSelect?: (option: AcpSelectOption) => void,
  ) => {
    if (!selector || selector.options.length === 0 || !onSelect) {
      return null;
    }

    return (
      <select
        className="acp-input-select"
        id={id}
        name={name}
        value={selector.current_value}
        disabled={!isConnected || isProcessing}
        onChange={(e) => {
          const next = selector.options.find((option) => option.value === e.target.value);
          if (next) {
            onSelect(next);
          }
        }}
      >
        {selector.options.map((option) => (
          <option key={`${option.config_id}:${option.value}`} value={option.value}>
            {option.name}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className={`acp-input ${isMinimized ? 'acp-input-minimized' : ''}`}>
      <div className="acp-input-full-container">
        <div className="acp-input-full-content">
          <div className="acp-input-main-row">
            <textarea
              ref={inputRef}
              id="acp-prompt-input"
              name="prompt"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={MIN_ROWS}
              disabled={!isConnected}
            />
            {isProcessing ? (
              <button
                className="acp-stop-prompt-btn"
                onClick={onCancel}
                disabled={!isConnected}
              >
                <AcpIcons.Cancel />
              </button>
            ) : (
              <button
                className="acp-send-btn"
                onClick={handleSend}
                disabled={!value.trim() || !isConnected}
              >
                <AcpIcons.Send />
              </button>
            )}
          </div>
          <div className="acp-input-controls-row">
            {agentLabel && (
              <div className="acp-input-agent-chip" title={agentLabel}>
                <span className="acp-input-agent-chip-label">{agentLabel}</span>
              </div>
            )}
            {renderSelect('acp-model-select', 'model', modelSelector, onSelectModel)}
            {renderSelect('acp-reasoning-select', 'thinking', reasoningSelector, onSelectReasoning)}
            {contextUsage && (
              <div
                className="acp-input-context"
                title={formatContextTitle(contextUsage.used, contextUsage.size)}
              >
                <div className="acp-input-context-value">
                  {formatContextPercent(contextUsage.used, contextUsage.size)}
                </div>
              </div>
            )}
            <button
              className="acp-input-toggle-btn acp-input-minimize-btn"
              onClick={() => setIsMinimized(true)}
              title="Minimize"
            >
              <AcpIcons.ChevronDown />
            </button>
          </div>
        </div>
      </div>

      {isMinimized && (
        <button
          className="acp-input-toggle-btn acp-input-floating-expand-btn"
          onClick={() => setIsMinimized(false)}
          title="Expand"
          aria-label="Expand prompt input"
        >
          <AcpIcons.ChevronUp />
        </button>
      )}
    </div>
  );
};
