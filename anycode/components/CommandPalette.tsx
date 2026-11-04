import React, { useState, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import './CommandPalette.css';

export interface CommandItem {
  id: string;
  title: string;
  category?: string;
  keybinding?: string;
  handler?: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  wsRef: React.RefObject<Socket | null>;
  builtInCommands: CommandItem[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  wsRef,
  builtInCommands,
}) => {
  const [query, setQuery] = useState('');
  const [extensionCommands, setExtensionCommands] = useState<CommandItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      inputRef.current?.focus();

      // Fetch extension commands from backend
      if (wsRef.current) {
        wsRef.current.emit('ext:commands:list', (res: any[]) => {
          if (Array.isArray(res)) {
            setExtensionCommands(
              res.map((cmd) => ({
                id: cmd.command,
                title: cmd.title,
                category: cmd.category,
              }))
            );
          }
        });
      }
    }
  }, [isOpen, wsRef]);

  if (!isOpen) return null;

  const allCommands = [...builtInCommands, ...extensionCommands];
  const filtered = allCommands.filter((cmd) => {
    const full = `${cmd.category || ''} ${cmd.title} ${cmd.id}`.toLowerCase();
    return full.includes(query.toLowerCase());
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filtered[selectedIndex];
      if (chosen) {
        execute(chosen);
      }
    }
  };

  const execute = (cmd: CommandItem) => {
    onClose();
    if (cmd.handler) {
      cmd.handler();
    } else if (wsRef.current) {
      wsRef.current.emit('ext:command:execute', { command: cmd.id }, (res: any) => {
        if (!res?.success) {
          console.warn(`Command ${cmd.id} execution failed:`, res?.error);
        }
      });
    }
  };

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input-wrap">
          <span className="command-palette-prompt">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command or action..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#777', fontSize: 13 }}>
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <div
                key={cmd.id}
                className={`command-palette-item ${idx === selectedIndex ? 'active' : ''}`}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="command-palette-item-title">
                  {cmd.category && (
                    <span className="command-palette-category">{cmd.category}:</span>
                  )}
                  <span>{cmd.title || cmd.id}</span>
                </div>
                {cmd.keybinding && (
                  <span className="command-palette-keybinding">{cmd.keybinding}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
