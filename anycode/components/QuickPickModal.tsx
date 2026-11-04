import React, { useState, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import './CommandPalette.css';

interface QuickPickModalProps {
  wsRef: React.RefObject<Socket | null>;
}

interface QuickPickRequest {
  requestId: string;
  items: Array<{ label: string; description?: string; detail?: string }>;
  options?: { placeHolder?: string; canPickMany?: boolean };
}

interface InputBoxRequest {
  requestId: string;
  options?: { prompt?: string; value?: string; placeHolder?: string; password?: boolean };
}

interface WindowMessageItem {
  id: string;
  requestId?: string;
  severity: number;
  message: string;
  items?: string[];
}

export const QuickPickModal: React.FC<QuickPickModalProps> = ({ wsRef }) => {
  const [quickPick, setQuickPick] = useState<QuickPickRequest | null>(null);
  const [inputBox, setInputBox] = useState<InputBoxRequest | null>(null);
  const [messages, setMessages] = useState<WindowMessageItem[]>([]);
  const [filter, setFilter] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    const onQuickPick = (req: QuickPickRequest) => {
      setFilter('');
      setSelectedIndex(0);
      setQuickPick(req);
      setTimeout(() => inputRef.current?.focus(), 50);
    };

    const onInputBox = (req: InputBoxRequest) => {
      setInputValue(req.options?.value || '');
      setInputBox(req);
      setTimeout(() => inputRef.current?.focus(), 50);
    };

    const onWindowMessage = (data: { severity?: number; message: string; items?: string[]; requestId?: string }) => {
      const id = String(Date.now() + Math.random());
      setMessages((prev) => [
        ...prev,
        {
          id,
          severity: data.severity || 1,
          message: data.message,
          items: data.items,
          requestId: data.requestId,
        },
      ]);
    };

    ws.on('ext:window:quick_pick', onQuickPick);
    ws.on('ext:window:input_box', onInputBox);
    ws.on('ext:window:message', onWindowMessage);

    return () => {
      ws.off('ext:window:quick_pick', onQuickPick);
      ws.off('ext:window:input_box', onInputBox);
      ws.off('ext:window:message', onWindowMessage);
    };
  }, [wsRef]);

  const dismissMessage = (id: string, requestId?: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (requestId) {
      wsRef.current?.emit('ext:window:message:reply', { requestId, selected: null });
    }
  };

  const handleActionClick = (id: string, requestId: string | undefined, selected: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (requestId) {
      wsRef.current?.emit('ext:window:message:reply', { requestId, selected });
    }
  };

  const renderMessages = () => {
    if (messages.length === 0) return null;
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxWidth: 420,
          pointerEvents: 'auto',
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              background: '#252526',
              border: `1px solid ${m.severity === 3 ? '#f85149' : m.severity === 2 ? '#d29922' : '#388bfd'}`,
              borderRadius: 6,
              padding: '12px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 13,
              color: '#e6edf3',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span>{m.severity === 3 ? '❌' : m.severity === 2 ? '⚠️' : 'ℹ️'}</span>
                <span style={{ wordBreak: 'break-word', lineHeight: 1.4 }}>{m.message}</span>
              </div>
              <button
                onClick={() => dismissMessage(m.id, m.requestId)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
            {m.items && m.items.length > 0 && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                {m.items.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleActionClick(m.id, m.requestId, item)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      background: '#30363d',
                      border: '1px solid #484f58',
                      color: '#c9d1d9',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (!inputBox) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      wsRef.current?.emit('ext:window:input_box:reply', { requestId: inputBox.requestId, value: null });
      setInputBox(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      wsRef.current?.emit('ext:window:input_box:reply', { requestId: inputBox.requestId, value: inputValue });
      setInputBox(null);
    }
  };

  const quickPickItems = quickPick?.items || [];
  const filteredQuickPick = quickPickItems.filter((item) =>
    `${item.label} ${item.description || ''} ${item.detail || ''}`
      .toLowerCase()
      .includes(filter.toLowerCase())
  );

  const handleQuickPickKeyDown = (e: React.KeyboardEvent) => {
    if (!quickPick) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      wsRef.current?.emit('ext:window:quick_pick:reply', { requestId: quickPick.requestId, selected: null });
      setQuickPick(null);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredQuickPick.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredQuickPick.length) % Math.max(1, filteredQuickPick.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filteredQuickPick[selectedIndex];
      wsRef.current?.emit('ext:window:quick_pick:reply', { requestId: quickPick.requestId, selected: chosen });
      setQuickPick(null);
    }
  };

  return (
    <>
      {renderMessages()}

      {inputBox && (
        <div className="command-palette-backdrop" onClick={() => setInputBox(null)}>
          <div className="command-palette-modal" onClick={(e) => e.stopPropagation()}>
            <div className="command-palette-input-wrap">
              <input
                ref={inputRef}
                type={inputBox.options?.password ? 'password' : 'text'}
                className="command-palette-input"
                placeholder={inputBox.options?.prompt || inputBox.options?.placeHolder || 'Input value...'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleInputKeyDown}
              />
            </div>
          </div>
        </div>
      )}

      {quickPick && (
        <div className="command-palette-backdrop" onClick={() => setQuickPick(null)}>
          <div className="command-palette-modal" onClick={(e) => e.stopPropagation()}>
            <div className="command-palette-input-wrap">
              <input
                ref={inputRef}
                type="text"
                className="command-palette-input"
                placeholder={quickPick.options?.placeHolder || 'Select an option...'}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleQuickPickKeyDown}
              />
            </div>

            <div className="command-palette-list">
              {filteredQuickPick.map((item, idx) => (
                <div
                  key={idx}
                  className={`command-palette-item ${idx === selectedIndex ? 'active' : ''}`}
                  onClick={() => {
                    wsRef.current?.emit('ext:window:quick_pick:reply', { requestId: quickPick.requestId, selected: item });
                    setQuickPick(null);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{item.label}</div>
                    {item.detail && <div style={{ fontSize: 11, color: '#888' }}>{item.detail}</div>}
                  </div>
                  {item.description && (
                    <span style={{ fontSize: 11, color: '#777' }}>{item.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
