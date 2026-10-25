import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { diffLines } from 'diff';
import { AnycodeEditorReact, AnycodeEditor } from 'anycode-react';
import { Icons } from '../Icons';
import { FileIcon } from '../FileIcon';
import { AcpIcons } from './AcpIcons';
import {
  AcpMessage as AcpMessageType,
  AcpDiffContent,
  AcpToolCallMessage,
  AcpToolResultMessage,
  AcpToolUpdateMessage,
  AcpUserMessage,
  AcpAssistantMessage,
  AcpMediaMessage,
  AcpThoughtMessage,
  AcpErrorMessage,
} from '../../types';
import { LANGUAGE_EXTENSIONS, EDITOR_SUPPORTED_LANGUAGES, getFileName, copyTextToClipboard, uriToFilePath, formatBytes } from '../../utils';
import { toolOutputCache } from '../../features/agents/toolOutputCache';
import { MermaidBlock } from '../../features/markdown/MermaidBlock';
import { BACKEND_URL } from '../../constants';
import { getToken } from '../../hooks/useSocket';
import { getToolResultImages } from './acpToolUtils';
import { AcpTerminalView } from './AcpTerminalView';
import { AcpTerminalCard } from './AcpTerminalCard';
import './AcpMessage.css';

let codeBlockIdCounter = 0;

interface AcpMessageProps {
  message: AcpMessageType;
  toolResult?: AcpToolResultMessage;
  toolUpdates?: AcpToolUpdateMessage[];
  isExpanded?: boolean;
  onToggle?: () => void;
  onUserMessageToggle?: () => void;
  onUndo?: () => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
  onGetToolOutput?: (toolId: string, sessionId?: string) => Promise<string | null>;
  // Read on mount only: the assistant text fades in all its words when it mounts as a live message.
  animateEnter?: boolean;
  isProcessing?: boolean;
}

const formatToolCallLabel = (diffPaths: string[], fallbackLabel: string): string => {
  if (diffPaths.length === 0) {
    return fallbackLabel;
  }

  if (diffPaths.length === 1) {
    return getFileName(diffPaths[0]);
  }

  const visibleNames = diffPaths.slice(0, 2).map(getFileName);
  const hiddenCount = diffPaths.length - visibleNames.length;
  return hiddenCount > 0
    ? `${visibleNames.join(", ")} +${hiddenCount}`
    : visibleNames.join(", ");
};

const getToolCallLabel = (
  message: AcpToolCallMessage,
  diffPaths: string[],
  kind?: string,
): string => {
  if (diffPaths.length > 0) {
    return formatToolCallLabel(diffPaths, "");
  }

  const rawInput = (message.raw_input ?? message.arguments) as Record<string, unknown> | undefined;

  // 1. Human-readable action or summary provided by agent (standard across MCP / ACP tools)
  const summaryCandidates = [
    rawInput?.toolSummary,
    rawInput?.toolAction,
    rawInput?.summary,
    rawInput?.description,
  ];
  for (const candidate of summaryCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  // 2. Real terminal / shell command (cmd, command, CommandLine)
  const commandCandidates = [
    rawInput?.cmd,
    rawInput?.command,
    rawInput?.CommandLine,
    message.command,
  ];
  for (const cmd of commandCandidates) {
    if (typeof cmd === "string" && cmd.trim()) {
      const trimmed = cmd.trim();
      if (!/^running\s+/i.test(trimmed) && trimmed !== message.name) {
        return trimmed;
      }
    }
  }

  // 3. File path referenced in locations or input arguments
  const pathCandidates = [
    message.locations?.[0]?.path,
    rawInput?.absolute_path,
    rawInput?.AbsolutePath,
    rawInput?.target_file,
    rawInput?.path,
    rawInput?.filePath,
    rawInput?.file_path,
    rawInput?.DirectoryPath,
    rawInput?.directory_path,
    rawInput?.SearchPath,
    rawInput?.search_path,
  ];
  for (const p of pathCandidates) {
    if (typeof p === "string" && p.trim()) {
      const fileName = getFileName(p.trim());
      if (fileName) {
        const verb = kind === "read" ? "Read" : kind === "search" ? "Search" : null;
        return verb ? `${verb} ${fileName}` : fileName;
      }
    }
  }

  // 4. URL
  const urlCandidate = rawInput?.url ?? rawInput?.Url;
  if (typeof urlCandidate === "string" && urlCandidate.trim()) {
    try {
      const parsed = new URL(urlCandidate.trim());
      return parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
    } catch {
      return urlCandidate.trim();
    }
  }

  // 5. Query / search pattern
  const queryCandidate = rawInput?.Query ?? rawInput?.query ?? rawInput?.Pattern ?? rawInput?.pattern;
  if (typeof queryCandidate === "string" && queryCandidate.trim()) {
    return `Search "${queryCandidate.trim()}"`;
  }

  // 6. Fallback to title / name, cleaning up generic "Running <tool>" prefix
  const rawTitle = message.title?.trim() || message.name?.trim() || "tool";
  if (/^running\s+/i.test(rawTitle)) {
    return rawTitle.replace(/^running\s+/i, "");
  }

  return rawTitle;
};

const getToolInputDetails = (message: AcpToolCallMessage) => {
  const rawInput = (message.raw_input ?? message.arguments) as Record<string, unknown> | undefined;
  if (!rawInput || typeof rawInput !== "object") return null;

  const rawCommand = (
    rawInput.cmd ??
    rawInput.command ??
    rawInput.CommandLine ??
    rawInput.command_line ??
    rawInput.Command ??
    message.command
  ) as string | undefined;

  const command =
    typeof rawCommand === "string" &&
    !rawCommand.endsWith("?") &&
    !/^run\s+[a-z0-9_]+$/i.test(rawCommand.trim())
      ? rawCommand
      : undefined;

  const cwd = (
    rawInput.cwd ??
    rawInput.Cwd ??
    rawInput.working_dir ??
    rawInput.workingDir ??
    rawInput.WorkingDir ??
    rawInput.current_dir ??
    rawInput.CurrentDir
  ) as string | undefined;

  const filePath = (
    message.locations?.[0]?.path ??
    rawInput.absolute_path ??
    rawInput.AbsolutePath ??
    rawInput.target_file ??
    rawInput.path ??
    rawInput.filePath ??
    rawInput.file_path ??
    rawInput.DirectoryPath ??
    rawInput.directory_path ??
    rawInput.SearchPath ??
    rawInput.search_path
  ) as string | undefined;

  const startLine = (rawInput.start_line ?? rawInput.StartLine) as number | undefined;
  const endLine = (rawInput.end_line ?? rawInput.EndLine) as number | undefined;

  const cleanInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawInput)) {
    const lowerKey = key.toLowerCase();
    if ([
      "toolsummary", "toolaction", "summary", "description", "prompt",
      "command", "cmd", "commandline", "command_line",
      "cwd", "working_dir", "workingdir", "current_dir", "currentdir",
      "waitmsbeforeasync", "wait_ms_before_async", "isdaemon", "is_daemon",
      "code_content", "codecontent", "content", "new_content", "old_content",
      "text", "new_text", "old_text", "new_str", "old_str", "file_text",
      "target_file", "targetfile", "path", "filepath", "file_path", "absolutepath", "absolute_path"
    ].includes(lowerKey)) continue;
    cleanInput[key] = value;
  }

  return { filePath, startLine, endLine, command, cwd, cleanInput };
};

const isProtocolMetadataOnly = (val: unknown): boolean => {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const obj = val as Record<string, unknown>;
  const protocolKeys = new Set([
    'sessionupdate',
    'session_update',
    'toolcallid',
    'tool_call_id',
    'sessionid',
    'session_id',
    'agentid',
    'agent_id',
    'status',
    'id',
    'kind',
    'type',
    'ts',
    'timestamp',
  ]);
  const keys = Object.keys(obj);
  if (keys.length === 0) return true;
  return keys.every((k) => {
    const lower = k.toLowerCase();
    if (lower === 'fields' && obj[k] && typeof obj[k] === 'object') {
      return isProtocolMetadataOnly(obj[k]);
    }
    return protocolKeys.has(lower);
  });
};

const ToolCallMessage: React.FC<{
  message: AcpToolCallMessage;
  toolResult?: AcpToolResultMessage;
  toolUpdates?: AcpToolUpdateMessage[];
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
  onGetToolOutput?: (toolId: string, sessionId?: string) => Promise<string | null>;
  isProcessing?: boolean;
}> = ({ message, toolResult, toolUpdates, isExpanded, onToggle, onOpenFile, onOpenFileDiff, onGetToolOutput, isProcessing }) => {
  const toolCallView = React.useMemo(
    () => getToolCallView(message, toolUpdates, toolResult),
    [message, toolResult, toolUpdates],
  );
  const diffFileNames = getToolCallFileNames(toolCallView.diffs);
  const toggleLabel = getToolCallLabel(message, diffFileNames, toolCallView.kind);
  const toggleStats = getToolCallStats(toolCallView.diffs);

  const inputDetails = getToolInputDetails(message);
  const resultDetails = React.useMemo(() => {
    if (toolResult?.result) {
      return extractToolResultDetails(toolResult.result);
    }
    if (message.raw_output) {
      return extractToolResultDetails(message.raw_output);
    }
    if (toolUpdates && toolUpdates.length > 0) {
      for (let i = toolUpdates.length - 1; i >= 0; i--) {
        const details = extractToolResultDetails(toolUpdates[i].update);
        if (details) return details;
      }
    }
    if (message.content) {
      return extractToolResultDetails({ content: message.content, status: message.status });
    }
    return null;
  }, [toolResult?.result, message.raw_output, message.content, message.status, toolUpdates]);

  const cmd = inputDetails?.command || resultDetails?.command || (
    message.command &&
    !message.command.endsWith('?') &&
    !/^run\s+[a-z0-9_]+$/i.test(message.command.trim())
      ? message.command
      : undefined
  );
  const cwd = inputDetails?.cwd || resultDetails?.cwd;
  const filePath = inputDetails?.filePath;
  const startLine = inputDetails?.startLine;
  const endLine = inputDetails?.endLine;
  const cleanInput = inputDetails?.cleanInput ?? {};
  const hasCleanKeys = Object.keys(cleanInput).length > 0;
  const isEditCall = toolCallView.kind === 'edit' || toolCallView.diffs.length > 0;
  const isTerminalCommand = !isEditCall && toolCallView.diffs.length === 0 && !filePath && Boolean(cmd);
  const exitCode = resultDetails?.exitCode;
  const effectiveStatus = message.status || resultDetails?.status;
  const isFinishedResult = Boolean(
    toolResult?.result ||
    message.raw_output ||
    exitCode !== undefined ||
    effectiveStatus === 'completed' ||
    effectiveStatus === 'failed' ||
    effectiveStatus === 'error'
  );

  const isCanceled =
    effectiveStatus === 'canceled' ||
    effectiveStatus === 'cancelled' ||
    effectiveStatus === 'stopped' ||
    (isProcessing === false && !isFinishedResult && (!effectiveStatus || effectiveStatus === 'in_progress' || effectiveStatus === 'pending'));

  const isRunning =
    !isCanceled &&
    !isFinishedResult &&
    (!effectiveStatus || effectiveStatus === 'in_progress' || effectiveStatus === 'pending');

  const displayOutput = resultDetails?.output || (resultDetails?.errorOutput ? undefined : resultDetails?.contentText);
  const errorOutput = resultDetails?.errorOutput;

  return (
    <div className="acp-message acp-message-tool_call">
      <div className={`acp-message-content ${isExpanded ? 'acp-tool-call-content-expanded' : 'acp-tool-call-content-collapsed'}`}>
        <div className="acp-tool-call-toggle" onClick={onToggle} style={{ cursor: 'pointer' }}>
          <span className="acp-toggle-icon acp-tool-call-icon">
            <Icons.TerminalBox size={14} />
          </span>
          <div className="acp-tool-call-toggle-main">
            <div className="acp-tool-call-toggle-title">
              {toggleStats && (
                <span className="acp-tool-call-kind-badge">Edit</span>
              )}
              <div className="acp-tool-call-name">{toggleLabel}</div>
            </div>
            {toggleStats && (
              <div className="acp-tool-call-toggle-stats">
                <span className="acp-tool-call-diff-added">+{toggleStats.added}</span>
                <span className="acp-tool-call-diff-deleted">-{toggleStats.deleted}</span>
              </div>
            )}
            {isTerminalCommand && (
              <div className="acp-tool-call-toggle-stats">
                {isRunning ? (
                  <span className="acp-terminal-badge is-running" style={{ fontSize: '10px', padding: '0 4px' }}>
                    <span className="acp-terminal-pulse-dot" />
                    running
                  </span>
                ) : isCanceled ? (
                  <span className="acp-tool-call-exit-badge is-error">
                    canceled
                  </span>
                ) : exitCode !== undefined && exitCode !== 0 ? (
                  <span className="acp-tool-call-exit-badge is-error">
                    {`✗ ${exitCode}`}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className={`acp-tool-call-expanded ${isTerminalCommand ? 'is-terminal' : ''}`}>
            {isTerminalCommand ? (
              <AcpTerminalCard
                command={cmd!}
                cwd={cwd}
                exitCode={exitCode}
                isRunning={isRunning}
                isCancelled={isCanceled}
                output={displayOutput}
                errorOutput={errorOutput}
                toolId={message.id || toolResult?.id}
                sessionId={message.session_id}
                hasFullOutput={message.has_full_output}
                fullOutputBytes={message.full_output_bytes}
                isTruncated={message.is_truncated}
                onGetToolOutput={onGetToolOutput}
              />
            ) : toolCallView.diffs.length > 0 ? (
              <>
                <div className="acp-tool-call-diffs">
                  {toolCallView.diffs.map((diffEntry, index) => (
                    <div key={`${diffEntry.path}-${index}`} className="acp-tool-call-diff">
                      <button
                        type="button"
                        className="acp-tool-call-diff-link"
                        onClick={() => onOpenFileDiff?.(diffEntry.path)}
                        title={`Open ${diffEntry.path} in diff mode`}
                      >
                        {getFileName(diffEntry.path)}
                      </button>
                      <DiffCodeBlock diff={diffEntry} />
                    </div>
                  ))}
                </div>
                {errorOutput && (
                  <div className="acp-tool-call-section">
                    <div className="acp-tool-call-label">Error:</div>
                    <AcpTerminalView content={errorOutput} isError />
                  </div>
                )}
                {toolResult && !isProtocolMetadataOnly(toolResult.result) && (
                  <ToolResultDetails
                    result={toolResult.result}
                    toolId={message.id || toolResult.id}
                    sessionId={message.session_id}
                    hasFullOutput={message.has_full_output}
                    fullOutputBytes={message.full_output_bytes}
                    isTruncated={message.is_truncated}
                    suppressCommand
                    suppressStatus
                    onGetToolOutput={onGetToolOutput}
                  />
                )}
                <button
                  type="button"
                  className="acp-tool-call-bottom-toggle"
                  onClick={onToggle}
                  aria-label="Collapse tool call"
                  title="Collapse tool call"
                >
                  <span className="acp-toggle-icon">▲</span>
                </button>
              </>
            ) : (
              <>
                {(filePath || hasCleanKeys) && (
                  <div className="acp-tool-call-section">
                    <div className="acp-tool-call-label">Input:</div>
                    {filePath && (
                      <div style={{ marginBottom: hasCleanKeys ? "6px" : undefined }}>
                        <button
                          type="button"
                          className="acp-tool-call-diff-link"
                          onClick={() => onOpenFile?.(filePath, startLine)}
                          title={`Open ${filePath}`}
                        >
                          {getFileName(filePath)}{startLine ? `:${startLine}${endLine ? `-${endLine}` : ""}` : ""}
                        </button>
                      </div>
                    )}
                    {hasCleanKeys && (
                      <pre className="acp-tool-result-content">
                        {JSON.stringify(cleanInput, null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                {toolUpdates && toolUpdates.length > 0 && (
                  <div className="acp-tool-call-section">
                    <div className="acp-tool-call-label">Updates:</div>
                    {toolUpdates.map((toolUpdate, index) => (
                      <pre key={`${toolUpdate.id}-${index}`} className="acp-tool-result-content">
                        {JSON.stringify(sanitizeToolUpdate(toolUpdate.update), null, 2)}
                      </pre>
                    ))}
                  </div>
                )}

                {toolResult && !isProtocolMetadataOnly(toolResult.result) ? (
                  <ToolResultDetails
                    result={toolResult.result}
                    toolId={message.id || toolResult.id}
                    sessionId={message.session_id}
                    hasFullOutput={message.has_full_output}
                    fullOutputBytes={message.full_output_bytes}
                    isTruncated={message.is_truncated}
                    onGetToolOutput={onGetToolOutput}
                  />
                ) : message.raw_output && !isProtocolMetadataOnly(message.raw_output) ? (
                  <ToolResultDetails
                    result={message.raw_output}
                    toolId={message.id}
                    sessionId={message.session_id}
                    hasFullOutput={message.has_full_output}
                    fullOutputBytes={message.full_output_bytes}
                    isTruncated={message.is_truncated}
                    onGetToolOutput={onGetToolOutput}
                  />
                ) : !toolResult && !message.raw_output ? (
                  <div className="acp-tool-call-section">
                    <div className="acp-tool-call-label">Status:</div>
                    <div className="acp-tool-result-status">{message.status || "running"}</div>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="acp-tool-call-bottom-toggle"
                  onClick={onToggle}
                  aria-label="Collapse tool call"
                  title="Collapse tool call"
                >
                  <span className="acp-toggle-icon">▲</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ToolResultMessage: React.FC<{
  message: AcpToolResultMessage;
  isExpanded: boolean;
  onToggle: () => void;
  onGetToolOutput?: (toolId: string, sessionId?: string) => Promise<string | null>;
}> = ({ message, isExpanded, onToggle, onGetToolOutput }) => (
  <div className="acp-message acp-message-tool_result">
    <div className="acp-message-content">
      <div className="acp-tool-result-indicator" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
        Tool result:
      </div>
      {isExpanded && (
        <ToolResultDetails
          result={message.result}
          toolId={message.id}
          onGetToolOutput={onGetToolOutput}
        />
      )}
    </div>
  </div>
);


type ToolResultDetailsView = {
  title?: string;
  status?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  description?: string;
  contentText?: string;
  output?: string;
  errorOutput?: string;
  toolId?: string;
  sessionId?: string;
  hasFullOutput?: boolean;
  fullOutputBytes?: number;
  isTruncated?: boolean;
};

const extractToolResultDetails = (result: unknown): ToolResultDetailsView | null => {
  if (typeof result === 'string') {
    return { output: result };
  }
  const resultRecord = asRecord(result);
  if (!resultRecord) {
    return null;
  }

  const fields = asRecord(resultRecord.fields);
  const title = getMaybeString(resultRecord.title) ?? getMaybeString(fields?.title);
  const status = getMaybeString(resultRecord.status) ?? getMaybeString(fields?.status);
  const rawInput = asRecord(
    getField(resultRecord, 'rawInput')
      ?? getField(resultRecord, 'raw_input')
      ?? getField(fields, 'rawInput')
      ?? getField(fields, 'raw_input'),
  );
  const rawOutput = getField(resultRecord, 'rawOutput')
    ?? getField(resultRecord, 'raw_output')
    ?? getField(fields, 'rawOutput')
    ?? getField(fields, 'raw_output');
  const rawOutputRecord = asRecord(rawOutput);
  const metadata = asRecord(rawOutputRecord?.metadata);
  const command =
    getMaybeString(rawInput?.cmd) ??
    getMaybeString(rawInput?.command) ??
    (Array.isArray(rawOutputRecord?.command)
      ? rawOutputRecord.command.join(' ')
      : getMaybeString(rawOutputRecord?.command));
  const description =
    getMaybeString(rawInput?.description) ??
    getMaybeString(metadata?.description);
  const cwd =
    getMaybeString(rawInput?.cwd) ??
    getMaybeString(rawInput?.working_dir) ??
    getMaybeString(rawInput?.workingDir) ??
    getMaybeString(rawInput?.current_dir) ??
    getMaybeString(rawOutputRecord?.cwd);
  const exitCode =
    typeof rawOutputRecord?.exit_code === 'number' ? rawOutputRecord.exit_code :
    typeof rawOutputRecord?.exitCode === 'number' ? rawOutputRecord.exitCode :
    typeof resultRecord.exit_code === 'number' ? resultRecord.exit_code :
    typeof resultRecord.exitCode === 'number' ? resultRecord.exitCode :
    typeof fields?.exit_code === 'number' ? fields.exit_code :
    typeof fields?.exitCode === 'number' ? fields.exitCode :
    undefined;
  const output =
    getMaybeString(rawOutputRecord?.formatted_output) ??
    getMaybeString(resultRecord.formatted_output) ??
    getMaybeString(fields?.formatted_output) ??
    getMaybeString(rawOutput) ??
    getMaybeString(rawOutputRecord?.stdout) ??
    getMaybeString(rawOutputRecord?.aggregated_output) ??
    getMaybeString(rawOutputRecord?.output) ??
    getMaybeString(rawOutputRecord?.result) ??
    getMaybeString(rawOutputRecord?.text) ??
    getMaybeString(resultRecord.output) ??
    getMaybeString(resultRecord.result) ??
    getMaybeString(metadata?.output) ??
    getMaybeString(metadata?.stderr) ??
    (rawOutput && typeof rawOutput === 'object' ? JSON.stringify(rawOutput, null, 2) : undefined);
  const errorOutput = getMaybeString(rawOutputRecord?.stderr) ?? getMaybeString(metadata?.stderr);

  const toolId =
    getMaybeString(resultRecord.tool_id) ??
    getMaybeString(resultRecord.tool_call_id) ??
    getMaybeString(resultRecord.toolCallId) ??
    getMaybeString(resultRecord.id) ??
    getMaybeString(fields?.tool_id) ??
    getMaybeString(fields?.tool_call_id) ??
    getMaybeString(fields?.toolCallId) ??
    getMaybeString(rawOutputRecord?.tool_id);

  const sessionId =
    getMaybeString(resultRecord.session_id) ??
    getMaybeString(resultRecord.sessionId) ??
    getMaybeString(fields?.session_id) ??
    getMaybeString(fields?.sessionId) ??
    getMaybeString(rawOutputRecord?.session_id);

  const hasFullOutput =
    Boolean(resultRecord.has_full_output || resultRecord.hasFullOutput ||
            fields?.has_full_output || fields?.hasFullOutput ||
            rawOutputRecord?.has_full_output || rawOutputRecord?.hasFullOutput);

  const fullOutputBytes =
    typeof resultRecord.full_output_bytes === 'number' ? resultRecord.full_output_bytes :
    typeof resultRecord.fullOutputBytes === 'number' ? resultRecord.fullOutputBytes :
    typeof fields?.full_output_bytes === 'number' ? fields.full_output_bytes :
    typeof fields?.fullOutputBytes === 'number' ? fields.fullOutputBytes :
    typeof rawOutputRecord?.full_output_bytes === 'number' ? rawOutputRecord.full_output_bytes :
    typeof rawOutputRecord?.fullOutputBytes === 'number' ? rawOutputRecord.fullOutputBytes :
    undefined;

  const isTruncated =
    Boolean(resultRecord.is_truncated || resultRecord.isTruncated ||
            fields?.is_truncated || fields?.isTruncated ||
            rawOutputRecord?.is_truncated || rawOutputRecord?.isTruncated);

  const content = resultRecord.content ?? fields?.content ?? rawOutputRecord?.content;
  const contentText = Array.isArray(content)
    ? content
      .map((item: unknown) => {
        if (typeof item === 'string') return item;
        const itemRecord = asRecord(item);
        return getMaybeString(itemRecord?.text)
          ?? getMaybeString(asRecord(itemRecord?.content)?.text)
          ?? (itemRecord?.text !== undefined ? String(itemRecord.text) : undefined);
      })
      .filter((text): text is string => typeof text === 'string' && text.length > 0)
      .join('\n')
    : undefined;
  const hasParsed = Boolean(
    title ||
    status ||
    command ||
    cwd ||
    exitCode !== undefined ||
    description ||
    output ||
    errorOutput ||
    contentText,
  );

  if (!hasParsed) {
    return null;
  }

  return {
    title,
    status,
    command,
    cwd,
    exitCode,
    description,
    contentText,
    output,
    errorOutput,
    toolId,
    sessionId,
    hasFullOutput,
    fullOutputBytes,
    isTruncated,
  };
};

interface ToolResultDetailsProps {
  result: any;
  toolId?: string;
  sessionId?: string;
  hasFullOutput?: boolean;
  fullOutputBytes?: number;
  isTruncated?: boolean;
  suppressCommand?: boolean;
  suppressStatus?: boolean;
  onGetToolOutput?: (toolId: string, sessionId?: string) => Promise<string | null>;
}

const ToolResultDetails: React.FC<ToolResultDetailsProps> = ({
  result,
  toolId: propToolId,
  sessionId: propSessionId,
  hasFullOutput: propHasFullOutput,
  fullOutputBytes: propFullOutputBytes,
  isTruncated: propIsTruncated,
  suppressCommand = false,
  suppressStatus = false,
  onGetToolOutput,
}) => {
  const details = extractToolResultDetails(result);

  const effectiveToolId = propToolId ?? details?.toolId;
  const effectiveSessionId = propSessionId ?? details?.sessionId;
  const effectiveHasFull = Boolean(propHasFullOutput || details?.hasFullOutput);
  const effectiveBytes = propFullOutputBytes ?? details?.fullOutputBytes;
  const effectiveTruncated = Boolean(propIsTruncated || details?.isTruncated);

  const [fullOutput, setFullOutput] = React.useState<string | null>(() => {
    if (effectiveToolId) {
      return toolOutputCache.get(effectiveToolId) ?? null;
    }
    return null;
  });
  const [isLoadingFull, setIsLoadingFull] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const handleLoadFull = React.useCallback(async () => {
    if (!effectiveToolId || !onGetToolOutput) return;
    setIsLoadingFull(true);
    setLoadError(null);
    try {
      const content = await onGetToolOutput(effectiveToolId, effectiveSessionId);
      if (content) {
        toolOutputCache.set(effectiveToolId, content);
        setFullOutput(content);
      } else {
        setLoadError('Failed to load full output');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error loading output');
    } finally {
      setIsLoadingFull(false);
    }
  }, [effectiveToolId, effectiveSessionId, onGetToolOutput]);

  React.useEffect(() => {
    if (!effectiveToolId) {
      setFullOutput(null);
      return;
    }
    const cached = toolOutputCache.get(effectiveToolId);
    setFullOutput(cached ?? null);
    const unsubscribe = toolOutputCache.subscribe((expiredToolId) => {
      if (expiredToolId === effectiveToolId) {
        setFullOutput(null);
      }
    });
    return unsubscribe;
  }, [effectiveToolId]);

  if (!details) {
    // Image-only results would otherwise dump base64 as JSON; the feed renders the image.
    if (getToolResultImages(result).length > 0) {
      return null;
    }
    return (
      <pre className="acp-tool-result-content">
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  const { title, status, command, description, contentText, errorOutput } = details;
  const rawOutput = details.output;
  const activeOutput = fullOutput ?? rawOutput;
  const normalizedContent = typeof contentText === 'string' ? contentText.trim() : undefined;
  const normalizedOutput = typeof activeOutput === 'string' ? activeOutput.trim() : undefined;
  const isTruncatedOrHasFull = Boolean(effectiveHasFull || effectiveTruncated);
  const displayOutput = activeOutput ?? (isTruncatedOrHasFull ? contentText : undefined);
  const shouldShowOutput =
    (typeof displayOutput === 'string' &&
      displayOutput.length > 0 &&
      (fullOutput ? true : normalizedOutput !== normalizedContent)) ||
    isTruncatedOrHasFull;
  const shouldShowContent =
    Boolean(contentText) &&
    (!shouldShowOutput || (normalizedContent !== normalizedOutput && !fullOutput));
  const shouldShowError =
    typeof errorOutput === 'string' &&
    errorOutput.length > 0 &&
    errorOutput.trim() !== normalizedOutput;

  const hasExitCodeError = details.exitCode !== undefined && details.exitCode !== 0;

  const showStatusSection =
    !suppressStatus &&
    Boolean(
      title ||
      (status && status.toLowerCase() !== 'completed') ||
      hasExitCodeError,
    );

  const showCommandSection = !suppressCommand && Boolean(command || description);

  const hasAnySection = Boolean(
    showStatusSection ||
    showCommandSection ||
    shouldShowContent ||
    shouldShowOutput ||
    shouldShowError,
  );

  if (!hasAnySection) {
    if (getToolResultImages(result).length > 0 || isProtocolMetadataOnly(result)) {
      return null;
    }
    const fallbackText = typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);
    return (
      <pre className="acp-tool-result-content">
        {fallbackText}
      </pre>
    );
  }

  return (
    <div className="acp-tool-result-details">
      {showStatusSection && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Status:</div>
          <div className="acp-tool-result-meta">
            {title && <div className="acp-tool-result-title">{title}</div>}
            {status && status.toLowerCase() !== 'completed' && <div className="acp-tool-result-status">{status}</div>}
            {hasExitCodeError && (
              <div className="acp-tool-exit-badge exit-failure">
                {`✗ Exited with code ${details.exitCode}`}
              </div>
            )}
          </div>
        </div>
      )}
      {showCommandSection && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Input:</div>
          {description && <div className="acp-tool-result-text">{description}</div>}
          {command && (
            <div className="acp-tool-command-container">
              {details.cwd && (
                <div className="acp-tool-command-cwd" title={details.cwd}>
                  <span className="acp-tool-command-cwd-label">cwd:</span> {details.cwd}
                </div>
              )}
              <div className="acp-tool-command-bar">
                <pre className="acp-tool-result-content">{command}</pre>
              </div>
            </div>
          )}
        </div>
      )}
      {shouldShowContent && (
        <div className="acp-tool-call-section">
          {command || (contentText && /[\u001b\u009b]/.test(contentText)) ? (
            <AcpTerminalView content={contentText} />
          ) : (
            <pre className="acp-tool-result-content">{contentText}</pre>
          )}
        </div>
      )}
      {shouldShowOutput && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Output:</div>
          <AcpTerminalView content={displayOutput} />
          {isTruncatedOrHasFull && !fullOutput && (
            <div className="acp-tool-output-truncated-notice">
              <span>Output truncated ({effectiveBytes ? formatBytes(effectiveBytes) : 'large log'}).</span>
              <button
                type="button"
                className="acp-tool-output-load-btn"
                onClick={handleLoadFull}
                disabled={isLoadingFull || !onGetToolOutput}
              >
                {isLoadingFull ? 'Loading full log...' : 'Load full log'}
              </button>
              {loadError && <span className="acp-tool-output-error">{loadError}</span>}
            </div>
          )}
          {fullOutput && (
            <div className="acp-tool-output-loaded-notice">
              <span>Full output loaded ({formatBytes(fullOutput.length)}).</span>
              <button
                type="button"
                className="acp-tool-output-copy-btn"
                onClick={() => {
                  copyTextToClipboard(fullOutput);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied!' : 'Copy full log'}
              </button>
            </div>
          )}
        </div>
      )}
      {shouldShowError && (
        <div className="acp-tool-call-section">
          <div className="acp-tool-call-label">Error:</div>
          <AcpTerminalView content={errorOutput} isError />
        </div>
      )}
    </div>
  );
};


const ToolUpdateMessage: React.FC<{
  message: AcpToolUpdateMessage;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, isExpanded, onToggle }) => (
  <div className="acp-message acp-message-tool_update">
    <div className="acp-message-content">
      <div className="acp-tool-update-indicator" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <span className="acp-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
        Tool update:
      </div>
      {isExpanded && (
        <pre className="acp-tool-update-content">
          {JSON.stringify(sanitizeToolUpdate(message.update), null, 2)}
        </pre>
      )}
    </div>
  </div>
);


const getLanguageFromPath = (path?: string): string => {
  if (!path) return 'text';
  const fileName = getFileName(path);
  const parts = fileName.toLowerCase().split('.');
  const extension = parts.length > 1 ? parts.pop() : undefined;
  return normalizeFenceLanguage(extension ?? 'text');
};



const getToolCallStats = (diffs: AcpDiffContent[]) => {
  if (diffs.length === 0) {
    return undefined;
  }

  return diffs.reduce(
    (acc, diff) => {
      const diffStats = countDiffLines(diff.oldText, diff.newText);
      acc.added += diffStats.added;
      acc.deleted += diffStats.deleted;
      return acc;
    },
    { added: 0, deleted: 0 },
  );
};

const getToolCallFileNames = (diffs: AcpDiffContent[]): string[] => {
  return Array.from(new Set(diffs.map((diff) => getFileName(diff.path))));
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
};

const getField = (value: unknown, key: string) => {
  return asRecord(value)?.[key];
};

const getStringField = (value: unknown, key: string): string | undefined => {
  const field = getField(value, key);
  return typeof field === 'string' ? field : undefined;
};

const getMaybeString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const countDiffLines = (oldText?: string | null, newText?: string | null) => {
  const changes = diffLines(oldText ?? '', newText ?? '');
  return changes.reduce(
    (acc, change) => {
      if (change.added) {
        acc.added += change.count;
      }
      if (change.removed) {
        acc.deleted += change.count;
      }
      return acc;
    },
    { added: 0, deleted: 0 },
  );
};

const isAcpDiffContent = (value: unknown): value is AcpDiffContent => {
  const record = asRecord(value);
  if (!record || record.type !== 'diff') {
    return false;
  }

  const oldText = record.oldText;
  return typeof record.path === 'string'
    && typeof record.newText === 'string'
    && (oldText === undefined || oldText === null || typeof oldText === 'string');
};

const sanitizeToolUpdate = (update: unknown): unknown => {
  if (typeof update !== 'object' || update === null) return update;
  const record = { ...(update as Record<string, unknown>) };
  if (Array.isArray(record.content)) {
    record.content = record.content.map((item) => {
      if (isAcpDiffContent(item)) {
        return {
          type: 'diff',
          path: item.path,
        };
      }
      return item;
    });
  }
  return record;
};


const getDiffEntries = (content: unknown): AcpDiffContent[] => {
  return Array.isArray(content) ? content.filter(isAcpDiffContent) : [];
};

const getToolCallPayload = (message: AcpToolCallMessage): Record<string, unknown> | undefined => {
  if (message.content || message.kind || message.status || message.raw_input || message.raw_output) {
    return {
      kind: message.kind,
      status: message.status,
      content: message.content,
      locations: message.locations,
      raw_input: message.raw_input,
      raw_output: message.raw_output,
    };
  }

  return asRecord(message.arguments);
};

const getToolProgressPayload = (
  message?: AcpToolUpdateMessage | AcpToolResultMessage,
): Record<string, unknown> | undefined => {
  if (!message) return undefined;
  return asRecord(message.role === 'tool_update' ? message.update : message.result);
};

const dedupeDiffs = (diffs: AcpDiffContent[]): AcpDiffContent[] => {
  const seen = new Set<string>();
  return diffs.filter((diff) => {
    const key = `${diff.path}\u0000${diff.oldText ?? ''}\u0000${diff.newText}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const getToolCallView = (
  message: AcpToolCallMessage,
  toolUpdates?: AcpToolUpdateMessage[],
  toolResult?: AcpToolResultMessage,
) => {
  const toolCallPayload = getToolCallPayload(message);
  const progressPayloads = [
    ...(toolUpdates ?? []).map((toolUpdate) => getToolProgressPayload(toolUpdate)),
    getToolProgressPayload(toolResult),
  ].filter((payload): payload is Record<string, unknown> => payload !== undefined);

  const kind = message.kind ?? getStringField(toolCallPayload, 'kind') ?? getStringField(progressPayloads[0], 'kind');
  const diffs = dedupeDiffs([
    ...getDiffEntries(message.content),
    ...getDiffEntries(getField(toolCallPayload, 'content')),
    ...progressPayloads.flatMap((payload) => getDiffEntries(getField(payload, 'content'))),
  ]);

  return {
    kind,
    diffs,
  };
};

type ParsedFileLink = {
  path: string;
  line?: number;
  column?: number;
};

const parseLineNumber = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const toZeroBasedPosition = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  return value > 0 ? value - 1 : 0;
};

const parseMarkdownFileHref = (href: string): ParsedFileLink | null => {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('#')) {
    return null;
  }

  if (/^(https?:|mailto:|tel:)/i.test(trimmedHref)) {
    return null;
  }

  let workingHref = trimmedHref;
  let line: number | undefined;
  let column: number | undefined;

  const hashIndex = workingHref.indexOf('#');
  if (hashIndex >= 0) {
    const fragment = workingHref.slice(hashIndex + 1);
    workingHref = workingHref.slice(0, hashIndex);
    const lineMatch = fragment.match(/^L(\d+)(?:-L?(\d+))?(?:C(\d+))?$/i);
    if (lineMatch) {
      line = parseLineNumber(lineMatch[1]);
      column = parseLineNumber(lineMatch[3] ?? null);
    }
  }

  const queryIndex = workingHref.indexOf('?');
  if (queryIndex >= 0) {
    const queryString = workingHref.slice(queryIndex + 1);
    workingHref = workingHref.slice(0, queryIndex);
    const params = new URLSearchParams(queryString);
    line ??= parseLineNumber(params.get('line'));
    column ??= parseLineNumber(params.get('column'));
  }

  if (workingHref.startsWith('file://')) {
    workingHref = uriToFilePath(workingHref);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(workingHref) || (/^[a-z][a-z0-9+.-]*:/i.test(workingHref) && !/^[a-z]:[\\/]/i.test(workingHref))) {
    return null;
  }

  const suffixMatch = workingHref.match(/^(.*):(\d+)(?::(\d+))?$/);
  if (suffixMatch) {
    workingHref = suffixMatch[1];
    line ??= parseLineNumber(suffixMatch[2]);
    column ??= parseLineNumber(suffixMatch[3] ?? null);
  }

  let path = workingHref.trim();
  try {
    path = decodeURIComponent(workingHref).trim();
  } catch {
    path = workingHref.trim();
  }
  if (!path) {
    return null;
  }

  return {
    path,
    line: toZeroBasedPosition(line),
    column: toZeroBasedPosition(column ?? 0),
  };
};

const MarkdownLink: React.FC<React.ComponentProps<'a'> & {
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({
  children,
  href,
  onClick,
  onOpenFile,
  onOpenFileDiff,
  className,
  ...props
}) => {
  const parsedFileLink = href ? parseMarkdownFileHref(href) : null;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }

    const openFileLink = onOpenFileDiff ?? onOpenFile;

    if (parsedFileLink && openFileLink) {
      event.preventDefault();
      openFileLink(parsedFileLink.path, parsedFileLink.line, parsedFileLink.column);
      return;
    }

    if (!href || /^javascript:/i.test(href.trim())) {
      event.preventDefault();
    }
  };

  const isFile = Boolean(parsedFileLink);
  const linkClassName = [
    className,
    isFile ? 'acp-file-link' : undefined,
  ].filter(Boolean).join(' ');

  const tooltip = parsedFileLink
    ? `${parsedFileLink.path}${parsedFileLink.line !== undefined ? `:${parsedFileLink.line + 1}` : ''}`
    : props.title;

  return (
    <a
      {...props}
      href={href}
      className={linkClassName || undefined}
      onClick={handleClick}
      target={parsedFileLink ? undefined : '_blank'}
      rel={parsedFileLink ? undefined : 'noreferrer noopener'}
      title={tooltip}
    >
      {isFile ? (
        <>
          <span className="acp-file-link-icon" aria-hidden="true">
            <FileIcon path={parsedFileLink?.path} styleType="colored" className="acp-file-link-icon-svg" />
          </span>
          <span className="acp-file-link-text">{children}</span>
        </>
      ) : (
        children
      )}
    </a>
  );
};

const MarkdownInlineCode: React.FC<{
  children?: React.ReactNode;
}> = ({ children }) => {
  return (
    <code className="acp-inline-code">
      {children}
    </code>
  );
};

const mapLocalImageSrc = (src?: string): string | undefined => {
  if (!src) return src;
  const trimmed = src.trim();
  if (!trimmed) return trimmed;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    let normalizedPath = trimmed;
    try {
      normalizedPath = decodeURIComponent(trimmed);
    } catch {
      normalizedPath = trimmed;
    }
    const token = getToken();
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    return `${BACKEND_URL}/api/local-image?path=${encodeURIComponent(normalizedPath)}${tokenParam}`;
  }

  return trimmed;
};

const MarkdownImage: React.FC<React.ComponentProps<'img'>> = ({ src, alt, ...props }) => {
  const mappedSrc = mapLocalImageSrc(typeof src === 'string' ? src : undefined);
  if (!mappedSrc) {
    return null;
  }

  return (
    <img
      {...props}
      src={mappedSrc}
      alt={alt}
      loading="lazy"
      style={{ width: '100%', maxWidth: 720, height: 'auto', borderRadius: 8 }}
    />
  );
};

type MarkdownPart =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language: string; isOpen: boolean };

const normalizeFenceLanguage = (rawLanguage: string): string => {
  const language = rawLanguage.trim().toLowerCase();
  if (!language) return 'text';
  return LANGUAGE_EXTENSIONS[language] ?? language;
};

const parseMarkdownParts = (content: string): MarkdownPart[] => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const parts: MarkdownPart[] = [];
  let textBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCodeFence = false;
  let currentLanguage = 'text';

  const flushText = () => {
    if (textBuffer.length === 0) return;
    parts.push({ kind: 'text', content: textBuffer.join('\n') });
    textBuffer = [];
  };

  const flushCode = (isOpen: boolean) => {
    parts.push({
      kind: 'code',
      content: codeBuffer.join('\n'),
      language: currentLanguage,
      isOpen,
    });
    codeBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_+-]*)$/);

    if (!inCodeFence && fenceMatch) {
      flushText();
      inCodeFence = true;
      currentLanguage = normalizeFenceLanguage(fenceMatch[1] || '');
      codeBuffer = [];
      continue;
    }

    if (inCodeFence && trimmed === '```') {
      flushCode(false);
      inCodeFence = false;
      currentLanguage = 'text';
      continue;
    }

    if (inCodeFence) {
      codeBuffer.push(line);
    } else {
      textBuffer.push(line);
    }
  }

  if (inCodeFence) {
    flushCode(true);
  }

  flushText();
  return parts;
};

const MarkdownPreBlock: React.FC<React.ComponentProps<'pre'>> = ({ children, ...props }) => {
  const extractText = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (!node) return '';
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (React.isValidElement(node) && node.props) {
      return extractText((node.props as { children?: React.ReactNode }).children);
    }
    return '';
  };

  const textContent = extractText(children);

  if (textContent) {
    return (
      <div className="acp-code">
        <div className="acp-code-toolbar">
          <CodeCopyButton content={textContent} />
        </div>
        <div className="acp-code-content">
          <pre className="acp-code-block-fallback" {...props}>
            {children}
          </pre>
        </div>
      </div>
    );
  }

  return <pre {...props}>{children}</pre>;
};

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const countWords = (node: HastNode): number => {
  if (node.type === 'text') {
    return (node.value ?? '').split(/\s+/).filter(Boolean).length;
  }
  return (node.children ?? []).reduce((sum, child) => sum + countWords(child), 0);
};

type FadeState = { wordIndex: number; firstFadingWord: number };

// Splits text into words; words from `firstFadingWord` on are wrapped in spans that fade in.
const fadeWordsIn = (node: HastNode, state: FadeState): HastNode[] => {
  if (node.type !== 'text') {
    if (node.children) {
      node.children = node.children.flatMap((child) => fadeWordsIn(child, state));
    }
    return [node];
  }

  const result: HastNode[] = [];
  let plain = '';
  for (const piece of (node.value ?? '').split(/(\s+)/)) {
    if (piece.trim() === '') {
      plain += piece;
      continue;
    }
    const wordIndex = state.wordIndex;
    state.wordIndex += 1;
    if (wordIndex < state.firstFadingWord) {
      plain += piece;
      continue;
    }
    if (plain) result.push({ type: 'text', value: plain });
    plain = '';
    result.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['acp-word-enter'] },
      children: [{ type: 'text', value: piece }],
    });
  }
  if (plain) result.push({ type: 'text', value: plain });
  return result;
};

type FadeInWordsOptions = {
  // Filled on the block's first render: words already rendered then stay still.
  mountedWordCount: { current: number | null };
  fadeAllWords: boolean;
};

const rehypeFadeInWords = (options: FadeInWordsOptions) => (tree: HastNode) => {
  const totalWords = countWords(tree);
  let mountedWords = options.mountedWordCount.current;
  if (mountedWords === null) {
    mountedWords = options.fadeAllWords ? 0 : totalWords;
    options.mountedWordCount.current = mountedWords;
  }
  // Wrapping only grows as text streams in. A sliding window would unwrap the oldest words on
  // every update, shifting sibling indexes so React re-creates the DOM and replays the fade.
  if (mountedWords >= totalWords) return;
  fadeWordsIn(tree, { wordIndex: 0, firstFadingWord: mountedWords });
};

const MarkdownTextBlock: React.FC<{
  content: string;
  // Streaming text: words that arrive after this block mounted fade in.
  fadeInWords?: boolean;
  // The whole block is new since the message mounted, so all of its words fade in.
  fadeAllWords?: boolean;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({ content, fadeInWords = false, fadeAllWords = false, onOpenFile, onOpenFileDiff }) => {
  const mountedWordCount = React.useRef<number | null>(null);
  // Read by the link component below. `components` must keep its identity: a new component
  // type on every render remounts links and their word spans, replaying the fade-in animation
  // on each parent update (e.g. typing in the input).
  const openHandlers = React.useRef({ onOpenFile, onOpenFileDiff });
  openHandlers.current = { onOpenFile, onOpenFileDiff };
  const components = React.useMemo<Components>(() => ({
    a: ({ node: _node, ...props }) => (
      <MarkdownLink
        {...props}
        onOpenFile={openHandlers.current.onOpenFile}
        onOpenFileDiff={openHandlers.current.onOpenFileDiff}
      />
    ),
    code: MarkdownInlineCode,
    pre: MarkdownPreBlock,
    img: ({ node: _node, ...props }) => <MarkdownImage {...props} />,
  }), []);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={fadeInWords ? [[rehypeFadeInWords, { mountedWordCount, fadeAllWords }]] : []}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
};

const CodeCopyButton: React.FC<{ content: string }> = ({ content }) => {
  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'copied' | 'error'>('idle');
  const copyResetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleCopy = async () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }

    try {
      await copyTextToClipboard(content);
      setCopyStatus('copied');
    } catch (error) {
      console.warn('Failed to copy code block:', error);
      setCopyStatus('error');
    }

    copyResetTimerRef.current = setTimeout(() => {
      setCopyStatus('idle');
    }, 1800);
  };

  const copyButtonLabel = copyStatus === 'copied'
    ? 'Code copied'
    : copyStatus === 'error'
      ? 'Copy failed'
      : 'Copy code';

  return (
    <button
      type="button"
      className="acp-code-copy-button"
      onClick={handleCopy}
      aria-label={copyButtonLabel}
      title={copyButtonLabel}
      data-copy-status={copyStatus}
    >
      {copyStatus === 'copied' ? <Icons.Check /> : <Icons.Copy />}
    </button>
  );
};

const MarkdownCodeBlock: React.FC<{
  code: string;
  language: string;
  isOpen?: boolean;
}> = ({ code, language, isOpen = false }) => {
  if (language === 'mermaid' || language === 'mmd') {
    return <MermaidBlock code={code} isStreaming={isOpen} />;
  }

  const [editor, setEditor] = React.useState<AnycodeEditor | null>(null);
  const blockIdRef = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const useEditor = EDITOR_SUPPORTED_LANGUAGES.has(language);

  if (!blockIdRef.current) {
    codeBlockIdCounter += 1;
    blockIdRef.current = `acp-code-block-${codeBlockIdCounter}`;
  }

  const codeToolbar = (
    <div className="acp-code-toolbar">
      <CodeCopyButton content={code} />
    </div>
  );

  React.useEffect(() => {
    if (editor) {
      editor.updateTextIncremental(code);
      // scroll to the bottom 
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [code, editor]);

  React.useEffect(() => {
    if (!useEditor) {
      setEditor(null);
      return;
    }

    let cancelled = false;
    let editor: AnycodeEditor | null = null;

    const init = async () => {
      try {
        editor = new AnycodeEditor(code, blockIdRef.current!, language, {
          readOnly: true,
          codeFoldingEnabled: false,
          wordHighlightEnabled: false,
          scrollbarMarkersEnabled: false,
          buffer: 1000,
        });
        await editor.init();
        editor.setLineHeight(18);

        if (cancelled) {
          editor.clean();
          return;
        }

        setEditor(editor);
      } catch (error) {
        console.warn(`Failed to render code block with AnycodeEditor for language "${language}"`, error);
        if (editor) {
          editor.clean();
        }
        setEditor(null);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (editor) {
        editor.clean();
      }
      setEditor(null);
    };
  }, [language, useEditor]);

  if (!useEditor) {
    return (
      <div className="acp-code">
        {codeToolbar}
        <div ref={containerRef} className="acp-code-content">
          <pre className="acp-code-block-fallback">{code}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`acp-code ${isOpen ? 'acp-code-streaming' : ''}`}>
      {codeToolbar}
      <div ref={containerRef} className="acp-code-content">
        {editor ? (
          <AnycodeEditorReact id={blockIdRef.current!} editorState={editor} />
        ) : (
          <pre className="acp-code-block-fallback">{code}</pre>
        )}
      </div>
    </div>
  );
};

const DiffCodeBlock: React.FC<{
  diff: AcpDiffContent;
}> = ({ diff }) => {
  const [editor, setEditor] = React.useState<AnycodeEditor | null>(null);
  const blockIdRef = React.useRef<string | null>(null);
  const language = getLanguageFromPath(diff.path);
  const useEditor = EDITOR_SUPPORTED_LANGUAGES.has(language);

  if (!blockIdRef.current) {
    codeBlockIdCounter += 1;
    blockIdRef.current = `acp-diff-block-${codeBlockIdCounter}`;
  }

  React.useEffect(() => {
    if (!useEditor) {
      setEditor(null);
      return;
    }

    let cancelled = false;
    let nextEditor: AnycodeEditor | null = null;

    const init = async () => {
      try {
        nextEditor = new AnycodeEditor(diff.newText, blockIdRef.current!, language, {
          readOnly: true,
          focusedDiffEnabled: true,
          focusedDiffContextLines: 3,
          codeFoldingEnabled: false,
          wordHighlightEnabled: false,
          scrollbarMarkersEnabled: false,
          buffer: 1000,
        });
        await nextEditor.init();
        nextEditor.setLineHeight(18);
        nextEditor.setOriginalCode(diff.oldText ?? '');
        nextEditor.setDiffEnabled(true);

        if (cancelled) {
          nextEditor.clean();
          return;
        }

        setEditor(nextEditor);
      } catch (error) {
        console.warn(`Failed to render diff block with AnycodeEditor for language "${language}"`, error);
        if (nextEditor) {
          nextEditor.clean();
        }
        setEditor(null);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (nextEditor) {
        nextEditor.clean();
      }
      setEditor(null);
    };
  }, [diff.newText, diff.oldText, language, useEditor]);

  React.useEffect(() => {
    if (!editor) return;
    editor.updateTextIncremental(diff.newText);
    editor.setOriginalCode(diff.oldText ?? '');
    editor.setDiffEnabled(true);
    editor.setLineHeight(18);
  }, [diff.newText, diff.oldText, editor]);

  const codeToolbar = (
    <div className="acp-code-toolbar">
      <CodeCopyButton content={diff.newText} />
    </div>
  );

  if (!useEditor) {
    return (
      <div className="acp-code acp-diff-code">
        {codeToolbar}
        <div className="acp-code-content">
          <pre className="acp-tool-result-content">
            {`--- before\n${diff.oldText ?? ''}\n+++ after\n${diff.newText}`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="acp-code acp-diff-code">
      {codeToolbar}
      <div className="acp-code-content">
        {editor ? (
          <AnycodeEditorReact id={blockIdRef.current!} editorState={editor} />
        ) : (
          <pre className="acp-code-block-fallback">{diff.newText}</pre>
        )}
      </div>
    </div>
  );
};

const StreamingMarkdownContent: React.FC<{
  content: string;
  fadeAllOnMount?: boolean;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({ content, fadeAllOnMount = false, onOpenFile, onOpenFileDiff }) => {
  const parts = parseMarkdownParts(content);
  // Parts present on mount (e.g. history) stay still unless fadeAllOnMount; parts that arrive later fade in.
  const [initialPartCount] = React.useState(fadeAllOnMount ? 0 : parts.length);

  return (
    <div className="acp-message-markdown">
      {parts.map((part, index) => {
        if (part.kind === 'code') {
          return (
            <MarkdownCodeBlock
              key={`code-${index}`}
              code={part.content}
              language={part.language}
              isOpen={part.isOpen}
            />
          );
        }

        return (
          <MarkdownTextBlock
            key={`text-${index}`}
            content={part.content}
            fadeInWords
            fadeAllWords={index >= initialPartCount}
            onOpenFile={onOpenFile}
            onOpenFileDiff={onOpenFileDiff}
          />
        );
      })}
    </div>
  );
};

const TextMessage: React.FC<{
  message: AcpUserMessage | AcpAssistantMessage;
  animateEnter?: boolean;
  onUserMessageToggle?: () => void;
  onUndo?: () => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  onOpenFileDiff?: (path: string, line?: number, column?: number) => void;
}> = ({ message, animateEnter = false, onUserMessageToggle, onUndo, onOpenFile, onOpenFileDiff }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isCollapsible, setIsCollapsible] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || message.role !== 'user') {
      setIsCollapsible(false);
      return;
    }

    setIsExpanded(false);
    const frame = requestAnimationFrame(() => {
      setIsCollapsible(body.scrollHeight > body.clientHeight + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [message.content, message.role]);

  return (
    <div className={`acp-message acp-message-${message.role}`}>
      <div className="acp-message-content acp-message-content-with-actions">
        <div
          ref={bodyRef}
          className={`acp-user-message-body ${message.role === 'user' && !isExpanded ? 'acp-user-message-body-collapsed' : ''}`}
        >
          <StreamingMarkdownContent
            content={message.content}
            fadeAllOnMount={animateEnter}
            onOpenFile={onOpenFile}
            onOpenFileDiff={onOpenFileDiff}
          />
        </div>
        {message.role === 'user' && Array.isArray(message.attachments) && message.attachments.length > 0 && (() => {
          const visibleAttachments = message.attachments.filter((attachment) => {
            if (attachment.mime_type.startsWith('image/') || attachment.mime_type.startsWith('audio/')) {
              return true;
            }
            if (message.content && (message.content.includes(attachment.name) || message.content.includes(attachment.name.replace(/\.[^.]+$/, '')))) {
              return false;
            }
            return true;
          });

          if (visibleAttachments.length === 0) return null;

          return (
            <div className="acp-message-attachments">
              {visibleAttachments.map((attachment, index) => {
                const src = `data:${attachment.mime_type};base64,${attachment.data_base64}`;
                const isImage = attachment.mime_type.startsWith('image/');
                const isAudio = attachment.mime_type.startsWith('audio/');
                if (isImage) {
                  return (
                    <img
                      key={`${attachment.name}-${index}`}
                      src={src}
                      alt={attachment.name}
                      className="acp-message-attachment-image"
                    />
                  );
                }
                if (isAudio) {
                  return (
                    <audio
                      key={`${attachment.name}-${index}`}
                      controls
                      src={src}
                      className="acp-message-attachment-audio"
                    />
                  );
                }
                return (
                  <div
                    key={`${attachment.name}-${index}`}
                    className="acp-message-attachment-file"
                    title={attachment.mime_type}
                  >
                    {attachment.name}
                  </div>
                );
              })}
            </div>
          );
        })()}
        {message.role === 'user' && isCollapsible && (
          <button
            type="button"
            className="acp-user-message-toggle"
            aria-expanded={isExpanded}
            onClick={() => {
              onUserMessageToggle?.();
              setIsExpanded((expanded) => !expanded);
            }}
          >
            <span aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
        {message.role === 'user' && onUndo && (
          <div className="acp-message-actions">
            <button className="acp-undo-button" onClick={onUndo} title="Undo">
              Undo
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const MediaMessage: React.FC<{
  message: AcpMediaMessage;
}> = ({ message }) => {
  const src = message.data
    ? `data:${message.mime_type ?? (message.media_type === 'image' ? 'image/png' : 'audio/wav')};base64,${message.data}`
    : message.uri;

  if (!src) {
    return null;
  }

  return (
    <div className="acp-message acp-message-assistant">
      <div className="acp-message-content">
        {message.media_type === 'image' ? (
          <img
            src={src}
            alt={message.title ?? 'ACP image'}
            style={{ width: '100%', maxWidth: 720, height: 'auto', borderRadius: 8 }}
          />
        ) : (
          <audio controls src={src} style={{ width: '100%' }} />
        )}
      </div>
    </div>
  );
};

const ThoughtMessage: React.FC<{
  message: AcpThoughtMessage;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ message, isExpanded, onToggle }) => {
  if (!message.content || message.content.trim() === '') {
    return null;
  }
  const shouldToggle = true;
  const expanded = isExpanded;
  const lines = message.content.trim().split('\n');
  const previewLine = lines[0] || '';
  const previewText = previewLine
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/[`*_~]/g, '');
  return (
    <div className="acp-message acp-message-thought">
      <div className="acp-message-content">
        <div
          className={`acp-thought-text ${!expanded ? 'acp-thought-text-collapsed' : ''}`}
          onClick={shouldToggle ? onToggle : undefined}
          style={shouldToggle ? { cursor: 'pointer' } : undefined}
        >
          {expanded ? (
            <div className="acp-thought-markdown">
              <MarkdownTextBlock content={message.content.trim()} />
            </div>
          ) : (
            <span className="acp-thought-preview">{previewText}…</span>
          )}
        </div>
      </div>
    </div>
  );
};

const ErrorMessage: React.FC<{
  message: AcpErrorMessage;
}> = ({ message }) => (
  <div className="acp-message acp-message-error">
    <div className="acp-message-content">
      <div className="acp-error-indicator">Error</div>
      <div className="acp-error-content">{message.message}</div>
    </div>
  </div>
);

const AcpMessageComponent: React.FC<AcpMessageProps> = ({
  message,
  toolResult,
  toolUpdates,
  isExpanded = false,
  onToggle,
  onUserMessageToggle,
  onUndo,
  onOpenFile,
  onOpenFileDiff,
  onGetToolOutput,
  animateEnter = false,
  isProcessing,
}) => {
  switch (message.role) {
    case 'tool_call':
      if (!onToggle) return null;
      return (
        <ToolCallMessage
            message={message}
            toolResult={toolResult}
            toolUpdates={toolUpdates}
            isExpanded={isExpanded}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            onOpenFileDiff={onOpenFileDiff}
            onGetToolOutput={onGetToolOutput}
            isProcessing={isProcessing}
          />
      );
    case 'tool_result':
      if (!onToggle) return null;
      return (
        <ToolResultMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
          onGetToolOutput={onGetToolOutput}
        />
      );
    case 'tool_update':
      if (!onToggle) return null;
      return (
        <ToolUpdateMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case 'user':
      return (
        <TextMessage
          message={message}
          onUserMessageToggle={onUserMessageToggle}
          onUndo={onUndo}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
        />
      );
    case 'assistant':
      return (
        <TextMessage
          message={message}
          animateEnter={animateEnter}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
        />
      );
    case 'media':
      return <MediaMessage message={message} />;
    case 'thought':
      if (!onToggle) return null;
      return (
        <ThoughtMessage
          message={message}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      );
    case 'prompt_state':
      // Skip rendering prompt_state messages in the chat
      return null;
    case 'error':
      return <ErrorMessage message={message} />;
    case 'raw_update':
      return null;
    default:
      console.warn('Unknown message role:', message);
      return null;
  }
};

export const AcpMessage = React.memo(AcpMessageComponent, (previous, next) => (
  previous.message === next.message
  && previous.toolResult === next.toolResult
  && previous.toolUpdates === next.toolUpdates
  && previous.isExpanded === next.isExpanded
  && previous.onUserMessageToggle === next.onUserMessageToggle
  && previous.onOpenFile === next.onOpenFile
  && previous.onOpenFileDiff === next.onOpenFileDiff
  && previous.onGetToolOutput === next.onGetToolOutput
));

