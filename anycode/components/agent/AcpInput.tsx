import React from 'react';
import './AcpInput.css';
import { AcpIcons } from './AcpIcons';
import { AgentIcon } from './AgentIcon';
import { FileIcon } from '../FileIcon';
import { getFileName, getParentPath, normalizePath } from '../../utils';
import type {
  AcpAvailableCommand,
  AcpContextUsageMessage,
  AcpModelSelectorMessage,
  AcpPromptAttachment,
  AcpReasoningSelectorMessage,
  AcpSelectOption,
  FileSearchResult,
  OpenFileInfo,
  WorkspaceFileInfo,
} from '../../types';

interface FileMentionItem {
  id: string;
  name: string;
  displayDir: string;
  relativePath: string;
  fullPath: string;
  category: 'recent' | 'file';
  isDirectory: boolean;
  isFirstInCategory: boolean;
  hasDividerAbove: boolean;
}

function renderHighlighted(text: string, query: string) {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const subIdx = lowerText.indexOf(lowerQuery);
  if (subIdx !== -1) {
    return (
      <>
        {text.slice(0, subIdx)}
        <span className="acp-at-highlight">{text.slice(subIdx, subIdx + query.length)}</span>
        {text.slice(subIdx + query.length)}
      </>
    );
  }

  const chars: React.ReactNode[] = [];
  let qIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (qIdx < lowerQuery.length && ch.toLowerCase() === lowerQuery[qIdx]) {
      chars.push(
        <span key={i} className="acp-at-highlight">
          {ch}
        </span>
      );
      qIdx++;
    } else {
      chars.push(ch);
    }
  }
  return chars;
}

function fuzzyMatch(str: string, query: string): boolean {
  let qIdx = 0;
  for (let i = 0; i < str.length && qIdx < query.length; i++) {
    if (str[i] === query[qIdx]) qIdx++;
  }
  return qIdx === query.length;
}

interface AcpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachments?: AcpPromptAttachment[]) => void;
  onCancel: () => void;
  agentLabel?: string;
  onCloseAgent?: () => void;
  isConnected: boolean;
  isStarting?: boolean;
  isProcessing?: boolean;
  showProcessingDots?: boolean;
  modelSelector?: Omit<AcpModelSelectorMessage, 'role'>;
  reasoningSelector?: Omit<AcpReasoningSelectorMessage, 'role'>;
  contextUsage?: Omit<AcpContextUsageMessage, 'role'>;
  availableCommands?: AcpAvailableCommand[];
  getOpenFiles?: () => OpenFileInfo[];
  getRootFiles?: () => WorkspaceFileInfo[];
  onSearchFiles?: (query: string) => Promise<FileSearchResult[]>;
  onSelectModel?: (option: AcpSelectOption) => void;
  onSelectReasoning?: (option: AcpSelectOption) => void;
}

const AcpInputComponent: React.FC<AcpInputProps> = ({
  value,
  onChange,
  onSend,
  onCancel,
  agentLabel,
  isConnected,
  isStarting = false,
  isProcessing = false,
  showProcessingDots = false,
  modelSelector,
  reasoningSelector,
  contextUsage,
  availableCommands,
  getOpenFiles,
  getRootFiles,
  onSearchFiles,
  onSelectModel,
  onSelectReasoning,
}) => {
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const inputContainerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isMinimized, setIsMinimized] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [attachments, setAttachments] = React.useState<AcpPromptAttachment[]>([]);
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [isSlashDismissed, setIsSlashDismissed] = React.useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = React.useState(0);
  const slashMenuRef = React.useRef<HTMLDivElement>(null);
  const MIN_ROWS = 1;
  const MAX_ROWS = 10;

  const [cursorPos, setCursorPos] = React.useState<number | null>(null);
  const [isAtDismissed, setIsAtDismissed] = React.useState(false);
  const [selectedAtIndex, setSelectedAtIndex] = React.useState(0);
  const [fileSearchResults, setFileSearchResults] = React.useState<FileSearchResult[]>([]);
  const [isSearchingFiles, setIsSearchingFiles] = React.useState(false);
  const atMenuRef = React.useRef<HTMLDivElement>(null);
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const atContext = React.useMemo(() => {
    if (isMinimized || isRecording || isAtDismissed) return null;
    const currentPos = cursorPos !== null ? cursorPos : value.length;
    const beforeCursor = value.slice(0, currentPos);
    const match = beforeCursor.match(/(?:^|\s)@([^\s]*)$/);
    if (!match) return null;
    const query = match[1];
    const atIndex = currentPos - query.length - 1;
    return {
      query,
      startIndex: atIndex,
      endIndex: currentPos,
    };
  }, [value, cursorPos, isMinimized, isRecording, isAtDismissed]);

  const isAtActive = Boolean(atContext);
  const atQuery = atContext?.query.trim().toLowerCase() || '';

  React.useEffect(() => {
    setSelectedAtIndex(0);
  }, [atQuery, isAtActive]);

  React.useEffect(() => {
    if (!value.includes('@')) {
      setIsAtDismissed(false);
    }
  }, [value]);

  React.useEffect(() => {
    if (!isAtActive || !onSearchFiles) {
      setFileSearchResults([]);
      setIsSearchingFiles(false);
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      return;
    }

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (!atQuery) {
      setFileSearchResults([]);
      setIsSearchingFiles(false);
      return;
    }

    setIsSearchingFiles(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await onSearchFiles(atQuery);
        setFileSearchResults(results || []);
      } catch {
        setFileSearchResults([]);
      } finally {
        setIsSearchingFiles(false);
      }
    }, 120);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [isAtActive, atQuery, onSearchFiles]);

  const openFilesList = React.useMemo(() => {
    if (!isAtActive || !getOpenFiles) return [];
    return getOpenFiles();
  }, [isAtActive, getOpenFiles]);

  const rootFilesList = React.useMemo(() => {
    if (!isAtActive || !getRootFiles) return [];
    return getRootFiles();
  }, [isAtActive, getRootFiles]);

  const recentItems = React.useMemo(() => {
    if (openFilesList.length === 0) return [];
    const list: {
      id: string;
      name: string;
      displayDir: string;
      relativePath: string;
      fullPath: string;
    }[] = [];
    const seen = new Set<string>();

    for (const file of openFilesList) {
      const rel = normalizePath(file.path);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);

      list.push({
        id: `recent:${rel}`,
        name: file.name || getFileName(rel),
        displayDir: getParentPath(rel),
        relativePath: rel,
        fullPath: rel,
      });
    }
    return list;
  }, [openFilesList]);

  const rootItems = React.useMemo(() => {
    if (rootFilesList.length === 0) return [];
    return rootFilesList.map((node) => {
      const rel = normalizePath(node.path);
      return {
        id: `tree:${rel}`,
        name: node.name || getFileName(rel),
        displayDir: getParentPath(rel),
        relativePath: rel,
        fullPath: rel,
        isDirectory: Boolean(node.isDirectory),
      };
    });
  }, [rootFilesList]);

  const filteredRecent = React.useMemo(() => {
    if (!isAtActive) return [];
    if (!atQuery) return recentItems.slice(0, 8);

    return recentItems.filter((item) => {
      const n = item.name.toLowerCase();
      const p = item.relativePath.toLowerCase();
      return n.includes(atQuery) || p.includes(atQuery) || fuzzyMatch(n, atQuery) || fuzzyMatch(p, atQuery);
    }).slice(0, 8);
  }, [isAtActive, atQuery, recentItems]);

  const filteredSearchResults = React.useMemo(() => {
    if (!isAtActive) return [];
    const recentPaths = new Set(filteredRecent.map((r) => r.relativePath.toLowerCase()));

    // When query is empty and open files exist, show open files only
    if (!atQuery && filteredRecent.length > 0) {
      return [];
    }

    // 1. If backend search returned results for active query
    if (fileSearchResults.length > 0) {
      return fileSearchResults
        .filter((res) => {
          const rel = normalizePath(res.display_path || res.path);
          return !recentPaths.has(rel.toLowerCase());
        })
        .slice(0, 25);
    }

    // 2. Fallback to root items from fileTree (children of workspace root)
    if (rootItems.length > 0) {
      const filtered = atQuery
        ? rootItems.filter((item) => {
            const n = item.name.toLowerCase();
            const p = item.relativePath.toLowerCase();
            return !recentPaths.has(p) && (n.includes(atQuery) || p.includes(atQuery) || fuzzyMatch(n, atQuery) || fuzzyMatch(p, atQuery));
          })
        : rootItems.filter((item) => !recentPaths.has(item.relativePath.toLowerCase()));
      return filtered.slice(0, 25).map((item) => ({
        name: item.name,
        path: item.fullPath,
        display_path: item.relativePath,
        type: item.isDirectory ? ('directory' as const) : ('file' as const),
      }));
    }

    return [];
  }, [isAtActive, atQuery, filteredRecent, fileSearchResults, rootItems]);

  const allMentionItems = React.useMemo<FileMentionItem[]>(() => {
    if (!isAtActive) return [];
    const items: FileMentionItem[] = [];

    filteredRecent.forEach((r, idx) => {
      items.push({
        id: r.id,
        name: r.name,
        displayDir: r.displayDir,
        relativePath: r.relativePath,
        fullPath: r.fullPath,
        category: 'recent',
        isDirectory: false,
        isFirstInCategory: idx === 0,
        hasDividerAbove: false,
      });
    });

    filteredSearchResults.forEach((res, idx) => {
      const rel = normalizePath(res.display_path || res.path);
      const name = res.name || getFileName(rel);
      const displayDir = getParentPath(rel);

      items.push({
        id: `file:${res.path}`,
        name,
        displayDir,
        relativePath: rel,
        fullPath: res.path,
        category: 'file',
        isDirectory: res.type === 'directory',
        isFirstInCategory: idx === 0,
        hasDividerAbove: idx === 0 && filteredRecent.length > 0,
      });
    });

    return items;
  }, [isAtActive, filteredRecent, filteredSearchResults]);

  const handleSelectFileMention = React.useCallback(
    (item: FileMentionItem) => {
      if (!atContext) return;
      const { startIndex, endIndex } = atContext;
      const replacement = `@${item.relativePath} `;
      const nextValue = value.slice(0, startIndex) + replacement + value.slice(endIndex);
      onChange(nextValue);
      setIsAtDismissed(true);

      const nextCursor = startIndex + replacement.length;
      setCursorPos(nextCursor);
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(nextCursor, nextCursor);
        }
      });
    },
    [atContext, onChange, value],
  );

  React.useEffect(() => {
    if (!isAtActive || !atMenuRef.current) return;
    const activeEl = atMenuRef.current.querySelector<HTMLElement>('.acp-at-item.selected');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedAtIndex, isAtActive]);

  const allCommands = React.useMemo<AcpAvailableCommand[]>(() => {
    if (!availableCommands || availableCommands.length === 0) return [];
    const list: AcpAvailableCommand[] = [];
    const seen = new Set<string>();

    for (const cmd of availableCommands) {
      if (!seen.has(cmd.name.toLowerCase())) {
        seen.add(cmd.name.toLowerCase());
        list.push(cmd);
      }
    }

    return list;
  }, [availableCommands]);

  const slashMatch = value.match(/^\/([a-zA-Z0-9_-]*)$/);
  const isSlashActive = Boolean(slashMatch) && !isMinimized && !isRecording && !isSlashDismissed;
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : '';

  const filteredCommands = React.useMemo(() => {
    if (!isSlashActive) return [];
    if (!slashQuery) return allCommands;
    return allCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(slashQuery) ||
        cmd.description.toLowerCase().includes(slashQuery),
    );
  }, [isSlashActive, slashQuery, allCommands]);

  React.useEffect(() => {
    setSelectedSlashIndex(0);
  }, [slashQuery, isSlashActive]);

  React.useEffect(() => {
    if (!value.startsWith('/')) {
      setIsSlashDismissed(false);
    }
  }, [value]);

  const handleSelectCommand = React.useCallback(
    (cmd: AcpAvailableCommand) => {
      const hasInput = Boolean(cmd.input?.hint);
      const text = `/${cmd.name}${hasInput ? ' ' : ''}`;
      onChange(text);
      setIsSlashDismissed(true);
      inputRef.current?.focus();
    },
    [onChange],
  );

  React.useEffect(() => {
    if (!isSlashActive || !slashMenuRef.current) return;
    const activeEl = slashMenuRef.current.querySelector<HTMLElement>('.acp-slash-item.selected');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedSlashIndex, isSlashActive]);

  React.useEffect(() => {
    if (isStarting) {
      inputRef.current?.focus();
    }
  }, [isStarting]);

  React.useLayoutEffect(() => {
    const inputContainer = inputContainerRef.current;
    const session = inputContainer?.closest<HTMLElement>('.acp-session');
    if (!inputContainer || !session) return;

    const updateInputSpace = () => {
      const height = isMinimized ? 0 : inputContainer.getBoundingClientRect().height;
      session.style.setProperty('--acp-input-height', `${height}px`);
    };

    updateInputSpace();
    const observer = new ResizeObserver(updateInputSpace);
    observer.observe(inputContainer);

    return () => {
      observer.disconnect();
      session.style.removeProperty('--acp-input-height');
    };
  }, [isMinimized]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      } catch {
        recorder = new MediaRecorder(stream);
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (audioBlob.size === 0) return;
        const extension = recorder.mimeType.includes('wav') ? 'wav' : recorder.mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([audioBlob], `voice-recording-${Date.now()}.${extension}`, {
          type: audioBlob.type,
        });
        const attachment = await toAttachment(file);
        if (attachment) {
          setAttachments((prev) => [...prev, attachment].slice(0, 10));
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording', err);
      alert('Failed to access microphone: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      };
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }
    audioChunksRef.current = [];
    setIsRecording(false);
  };

  const readFileAsDataUrl = React.useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error(`Failed to read file ${file.name}`));
      reader.readAsDataURL(file);
    });
  }, []);

  const toAttachment = React.useCallback(async (file: File): Promise<AcpPromptAttachment | null> => {
    const dataUrl = await readFileAsDataUrl(file);
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return null;
    const dataBase64 = dataUrl.slice(comma + 1);
    if (!dataBase64) return null;
    return {
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      data_base64: dataBase64,
      size: file.size,
    };
  }, [readFileAsDataUrl]);

  const addFiles = React.useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, 10);
    const parsed = (await Promise.all(files.map(toAttachment))).filter((a): a is AcpPromptAttachment => a !== null);
    if (parsed.length === 0) return;
    setAttachments((prev) => {
      const merged = [...prev, ...parsed];
      return merged.slice(0, 10);
    });
  }, [toAttachment]);

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

  const canSubmit = (value.trim().length > 0 || attachments.length > 0) && isConnected && !isProcessing && !isStarting;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isAtActive) {
      if (allMentionItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedAtIndex((prev) => (prev + 1) % allMentionItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedAtIndex((prev) => (prev - 1 + allMentionItems.length) % allMentionItems.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selected = allMentionItems[selectedAtIndex];
          if (selected) {
            handleSelectFileMention(selected);
          }
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsAtDismissed(true);
        return;
      }
    }

    if (isSlashActive && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredCommands[selectedSlashIndex];
        if (selected) {
          handleSelectCommand(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsSlashDismissed(true);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) {
        onSend(attachments);
        setAttachments([]);
      }
    }
  };

  const handleSend = () => {
    if (canSubmit) {
      onSend(attachments);
      setAttachments([]);
    }
  };

  const handleDrop: React.DragEventHandler<HTMLDivElement> = async (event) => {
    event.preventDefault();
    setIsDragOver(false);
    await addFiles(event.dataTransfer.files);
  };

  const handlePaste: React.ClipboardEventHandler<HTMLTextAreaElement> = async (event) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length === 0) return;
    event.preventDefault();
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    await addFiles(dt.files);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
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
    return `Context ${used} / ${size} (${percent})`;
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
    <>
      <div
      ref={inputContainerRef}
      className={`acp-input ${isMinimized ? 'acp-input-minimized' : ''} ${isDragOver ? 'acp-input-drag-over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="acp-input-full-container">
        {isSlashActive && filteredCommands.length > 0 && (
          <div ref={slashMenuRef} className="acp-slash-menu" role="listbox" aria-label="Available commands">
            <div className="acp-slash-menu-header">
              <span>Commands</span>
              <span className="acp-slash-menu-hint">↑↓ navigate • Enter/Tab select • Esc close</span>
            </div>
            {filteredCommands.map((cmd, idx) => (
              <div
                key={cmd.name}
                className={`acp-slash-item ${idx === selectedSlashIndex ? 'selected' : ''}`}
                onClick={() => handleSelectCommand(cmd)}
                onMouseEnter={() => setSelectedSlashIndex(idx)}
                role="option"
                aria-selected={idx === selectedSlashIndex}
              >
                <span className="acp-slash-item-name">/{cmd.name}</span>
                {cmd.input?.hint && (
                  <span className="acp-slash-item-hint">&lt;{cmd.input.hint}&gt;</span>
                )}
                {cmd.description && (
                  <span className="acp-slash-item-desc">{cmd.description}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {isAtActive && (
          <div ref={atMenuRef} className="acp-at-menu" role="listbox" aria-label="Mention files">
            {allMentionItems.map((item, idx) => (
              <div
                key={item.id}
                className={`acp-at-item ${idx === selectedAtIndex ? 'selected' : ''} ${item.hasDividerAbove ? 'acp-at-item-divider-above' : ''}`}
                onClick={() => handleSelectFileMention(item)}
                onMouseEnter={() => setSelectedAtIndex(idx)}
                role="option"
                aria-selected={idx === selectedAtIndex}
              >
                <div className="acp-at-icon">
                  <FileIcon path={item.fullPath} isDirectory={item.isDirectory} styleType="colored" />
                </div>
                <span className="acp-at-name">
                  {renderHighlighted(item.name, atQuery)}
                </span>
                <span className="acp-at-path" title={item.displayDir}>
                  {renderHighlighted(item.displayDir, atQuery)}
                </span>
                {item.isFirstInCategory && (
                  <span className="acp-at-badge">
                    {item.category === 'recent' ? 'RECENTLY OPENED' : 'FILE RESULTS'}
                  </span>
                )}
              </div>
            ))}
            {allMentionItems.length === 0 && (
              <div className="acp-at-empty">
                {isSearchingFiles ? (
                  <>
                    <span className="acp-input-spinner" />
                    <span>Searching files…</span>
                  </>
                ) : (
                  <span>No files found</span>
                )}
              </div>
            )}
          </div>
        )}
        <div className="acp-input-full-content">
          {attachments.length > 0 && (
            <div className="acp-input-attachments">
              {attachments.map((item, index) => (
                <div className="acp-input-attachment-chip" key={`${item.name}-${index}`}>
                  <span className="acp-input-attachment-name">{item.name}</span>
                  <button
                    type="button"
                    className="acp-input-attachment-remove"
                    onClick={() => removeAttachment(index)}
                    title="Remove attachment"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="acp-input-main-row">
            {isRecording ? (
              <div className="acp-input-recording-panel">
                <div className="acp-input-recording-indicator">
                  <span className="acp-recording-dot"></span>
                  <span className="acp-recording-text">Recording {formatTime(recordingSeconds)}</span>
                </div>
                <div className="acp-input-recording-actions">
                  <button
                    type="button"
                    className="acp-input-record-cancel-btn"
                    onClick={cancelRecording}
                    title="Discard recording"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="acp-input-record-stop-btn"
                    onClick={stopRecording}
                    title="Stop and attach"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={async (event) => {
                    await addFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
                <textarea
                  ref={inputRef}
                  id="acp-prompt-input"
                  name="prompt"
                  value={value}
                  onChange={(e) => {
                    setCursorPos(e.target.selectionStart);
                    setIsAtDismissed(false);
                    onChange(e.target.value);
                  }}
                  onSelect={(e) => {
                    setCursorPos(e.currentTarget.selectionStart);
                  }}
                  onClick={(e) => {
                    setCursorPos(e.currentTarget.selectionStart);
                  }}
                  onKeyUp={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                      setCursorPos(e.currentTarget.selectionStart);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Ask anything..."
                  rows={MIN_ROWS}
                  disabled={!isConnected && !isStarting}
                />
                <div className="acp-prompt-action-switch">
                  <button
                    type="button"
                    className={`acp-stop-prompt-btn ${isProcessing ? 'acp-prompt-action-active' : 'acp-prompt-action-inactive'}`}
                    onClick={onCancel}
                    disabled={!isConnected || !isProcessing}
                    aria-hidden={!isProcessing}
                    aria-label="Cancel prompt"
                    title="Cancel prompt"
                  >
                    {showProcessingDots && (
                      <span className="acp-stop-prompt-dots" aria-hidden="true">
                        <span>.</span>
                        <span>.</span>
                        <span>.</span>
                      </span>
                    )}
                    <span
                      className={`acp-stop-prompt-icon${showProcessingDots ? ' acp-stop-prompt-icon-hover' : ' acp-stop-prompt-icon-visible'}`}
                      aria-hidden="true"
                    >
                      <AcpIcons.Cancel />
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`acp-send-btn ${isProcessing ? 'acp-prompt-action-inactive' : 'acp-prompt-action-active'}`}
                    onClick={handleSend}
                    disabled={!canSubmit}
                    aria-hidden={isProcessing}
                    title={isStarting ? `Starting ${agentLabel || 'agent'}…` : undefined}
                  >
                    {isStarting ? (
                      <span className="acp-input-spinner" />
                    ) : (
                      <AcpIcons.Send />
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="acp-input-controls-row">
            {agentLabel && (
              <div className="acp-input-agent-chip" title={agentLabel}>
                <AgentIcon name={agentLabel} size={12} className="acp-input-agent-chip-icon" />
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
              className="acp-input-toggle-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={(!isConnected && !isStarting) || isProcessing || isRecording}
              title="Attach files"
            >
              <AcpIcons.Add />
            </button>
            <button
              className="acp-input-toggle-btn"
              onClick={startRecording}
              disabled={!isConnected || isProcessing || isRecording}
              title="Record audio"
            >
              <AcpIcons.Mic />
            </button>
            <button
              className="acp-input-toggle-btn acp-input-minimize-btn"
              onClick={() => setIsMinimized(true)}
              disabled={isRecording}
              title="Minimize"
            >
              <AcpIcons.ChevronDown />
            </button>
          </div>
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
    </>
  );
};

export const AcpInput = React.memo(AcpInputComponent);
