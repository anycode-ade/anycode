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
  onCloseAgent,
  isConnected,
  isProcessing = false,
  modelSelector,
  reasoningSelector,
  contextUsage,
  onSelectModel,
  onSelectReasoning,
}) => {
  const [isMinimized, setIsMinimized] = React.useState(false);

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
    <div className={`acp-dialog-input ${isMinimized ? 'acp-dialog-input-minimized' : ''}`}>
      <div className="acp-input-preview-container">
        <div className="acp-input-preview-content">
          <div className="acp-input-preview-row" onClick={() => setIsMinimized(false)}>
            <span className="acp-input-preview-text">{value ? value : "Ask anything..."}</span>
            <button
              className="acp-input-toggle-btn"
              onClick={(e) => { e.stopPropagation(); setIsMinimized(false); }}
              title="Expand"
            >
              <AcpIcons.ChevronUp />
            </button>
          </div>
        </div>
      </div>

      <div className="acp-input-full-container">
        <div className="acp-input-full-content">
          <div className="acp-input-main-row">
            <textarea
              id="acp-prompt-input"
              name="prompt"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={3}
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
                {onCloseAgent && (
                  <button
                    className="acp-agent-close-btn acp-input-agent-close-btn"
                    onClick={onCloseAgent}
                    title="Close agent"
                  >
                    <AcpIcons.Close />
                  </button>
                )}
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
    </div>
  );
};
