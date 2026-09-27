import React, { useState } from 'react';
import type { AcpQueuedMessage } from '../../types';
import { AcpIcons } from './AcpIcons';
import './AcpQueue.css';

export interface AcpQueueProps {
  queue: AcpQueuedMessage[];
  onUpdateItem: (itemId: string, prompt: string) => void;
  onRemoveItem: (itemId: string) => void;
  onMoveItem: (itemId: string, direction: 'up' | 'down') => void;
}

const QueueIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const EditIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

export const AcpQueue: React.FC<AcpQueueProps> = ({
  queue,
  onUpdateItem,
  onRemoveItem,
  onMoveItem,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  if (!queue || queue.length === 0) {
    return null;
  }

  const handleStartEdit = (item: AcpQueuedMessage) => {
    setEditingId(item.id);
    setEditText(item.prompt);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleSaveEdit = (itemId: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    onUpdateItem(itemId, trimmed);
    setEditingId(null);
    setEditText('');
  };

  return (
    <div className="acp-queue-container" aria-label="Agent Prompt Queue">
      <div className="acp-queue-header">
        <div className="acp-queue-header-left">
          <span className="acp-queue-icon">
            <QueueIcon />
          </span>
          <h4 className="acp-queue-title">
            Queue
            <span className="acp-queue-badge">{queue.length}</span>
          </h4>
        </div>
        <span className="acp-queue-hint">Auto-executes next</span>
      </div>

      <div className="acp-queue-list">
        {queue.map((item, index) => {
          const isEditing = editingId === item.id;

          if (isEditing) {
            return (
              <div key={item.id} className="acp-queue-card editing">
                <textarea
                  className="acp-queue-edit-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                  placeholder="Enter message..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSaveEdit(item.id);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelEdit();
                    }
                  }}
                />
                <div className="acp-queue-edit-actions">
                  <button
                    type="button"
                    className="acp-queue-edit-btn secondary"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="acp-queue-edit-btn primary"
                    onClick={() => handleSaveEdit(item.id)}
                    disabled={!editText.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={item.id} className="acp-queue-card">
              <div className="acp-queue-card-content">
                <span className="acp-queue-card-index">#{index + 1}</span>
                <div className="acp-queue-card-main">
                  <div className="acp-queue-card-text" title={item.prompt}>
                    {item.prompt}
                  </div>
                  {item.attachments && item.attachments.length > 0 && (
                    <div className="acp-queue-card-attachments">
                      {item.attachments.map((att, attIdx) => (
                        <span key={attIdx} className="acp-queue-attachment-chip" title={att.name}>
                          📎 {att.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="acp-queue-card-actions">
                <button
                  type="button"
                  className="acp-queue-icon-btn"
                  onClick={() => onMoveItem(item.id, 'up')}
                  disabled={index === 0}
                  title="Move up"
                  aria-label="Move queued prompt up"
                >
                  <AcpIcons.ChevronUp />
                </button>
                <button
                  type="button"
                  className="acp-queue-icon-btn"
                  onClick={() => onMoveItem(item.id, 'down')}
                  disabled={index === queue.length - 1}
                  title="Move down"
                  aria-label="Move queued prompt down"
                >
                  <AcpIcons.ChevronDown />
                </button>
                <button
                  type="button"
                  className="acp-queue-icon-btn"
                  onClick={() => handleStartEdit(item)}
                  title="Edit prompt"
                  aria-label="Edit queued prompt"
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="acp-queue-icon-btn danger"
                  onClick={() => onRemoveItem(item.id)}
                  title="Remove from queue"
                  aria-label="Remove queued prompt"
                >
                  <AcpIcons.CloseSmall />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
