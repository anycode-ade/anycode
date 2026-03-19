import React from 'react';
import './AcpInput.css';
import { AcpIcons } from './AcpIcons';

interface AcpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  isConnected: boolean;
  isProcessing?: boolean;
}

export const AcpInput: React.FC<AcpInputProps> = ({
  value,
  onChange,
  onSend,
  onCancel,
  isConnected,
  isProcessing = false,
}) => {
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

  return (
    <div className="acp-dialog-input">
      <textarea
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
  );
};
