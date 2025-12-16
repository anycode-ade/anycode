import React, { useState } from 'react';
import './AcpInput.css';
import { AcpIcons } from './AcpIcons';

interface AcpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  isConnected: boolean;
  isProcessing?: boolean;
  disabled?: boolean;
}

export const AcpInput: React.FC<AcpInputProps> = ({
  value,
  onChange,
  onSend,
  onCancel,
  isConnected,
  isProcessing = false,
  disabled = false,
}) => {
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && isConnected && !disabled) {
        onSend();
      }
    }
  };

  const handleSend = () => {
    if (value.trim() && isConnected && !disabled) {
      onSend();
    }
  };

  return (
    <div className="acp-dialog-input">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Ask anything..."
        rows={3}
        disabled={!isConnected || isProcessing || disabled}
      />
      {isProcessing ? (
        <button
          className="acp-stop-prompt-btn"
          onClick={onCancel}
          disabled={!isConnected || disabled}
        >
          <AcpIcons.Cancel />
        </button>
      ) : (
        <button
          className="acp-send-btn"
          onClick={handleSend}
          disabled={!value.trim() || !isConnected || disabled}
        >
          <AcpIcons.Send />
        </button>
      )}
    </div>
  );
};

