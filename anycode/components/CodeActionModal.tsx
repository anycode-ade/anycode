import React, { useState, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import './CommandPalette.css';

export interface CodeActionItem {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  command?: any;
  edit?: {
    changes: Array<{
      uri: string;
      edits: Array<{
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        newText: string;
      }>;
    }>;
  };
}

interface CodeActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  actions: CodeActionItem[];
  onApplyAction: (action: CodeActionItem) => void;
}

export const CodeActionModal: React.FC<CodeActionModalProps> = ({
  isOpen,
  onClose,
  actions,
  onApplyAction,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, actions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + actions.length) % Math.max(1, actions.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = actions[selectedIndex];
      if (chosen) {
        onApplyAction(chosen);
        onClose();
      }
    }
  };

  return (
    <div className="command-palette-backdrop" onClick={onClose} onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="command-palette-modal" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', fontSize: 12, fontWeight: 600, color: '#aaa' }}>
          💡 Code Actions &amp; Quick Fixes
        </div>

        <div className="command-palette-list">
          {actions.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#777', fontSize: 12 }}>
              No code actions available at cursor
            </div>
          ) : (
            actions.map((act, idx) => (
              <div
                key={idx}
                className={`command-palette-item ${idx === selectedIndex ? 'active' : ''}`}
                onClick={() => {
                  onApplyAction(act);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="command-palette-item-title">
                  {act.isPreferred && <span style={{ color: '#ee9d28' }}>★</span>}
                  <span>{act.title}</span>
                </div>
                {act.kind && <span className="command-palette-category">{act.kind}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
