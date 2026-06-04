import React from 'react';
import './AcpInput.css';
import { AcpIcons } from './AcpIcons';
import type {
  AcpContextUsageMessage,
  AcpModelSelectorMessage,
  AcpPromptAttachment,
  AcpReasoningSelectorMessage,
  AcpSelectOption,
} from '../../types';

interface AcpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachments?: AcpPromptAttachment[]) => void;
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isMinimized, setIsMinimized] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [attachments, setAttachments] = React.useState<AcpPromptAttachment[]>([]);
  const MIN_ROWS = 3;
  const MAX_ROWS = 10;

  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((value.trim() || attachments.length > 0) && isConnected && !isProcessing) {
        onSend(attachments);
        setAttachments([]);
      }
    }
  };

  const handleSend = () => {
    if ((value.trim() || attachments.length > 0) && isConnected) {
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
      className={`acp-input ${isMinimized ? 'acp-input-minimized' : ''} ${isDragOver ? 'acp-input-drag-over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="acp-input-full-container">
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
                  onChange={(e) => onChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
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
                    disabled={(!value.trim() && attachments.length === 0) || !isConnected}
                  >
                    <AcpIcons.Send />
                  </button>
                )}
              </>
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
              className="acp-input-toggle-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isConnected || isProcessing || isRecording}
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
