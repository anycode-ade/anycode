import { Change, Edit } from 'anycode-base';

export interface TreeNode {
    id: string;
    name: string;
    type: 'file' | 'directory';
    path: string;
    size?: number;
    children?: TreeNode[];
    isExpanded?: boolean;
    isSelected?: boolean;
    isLoading?: boolean;
    hasLoaded?: boolean;
}

export interface FileState {
    id: string;
    name: string;
    language: string;
    history?: {
        changes: Change[];
        index: number;
    };
}

export interface FileSystemItem {
    name: string;
    type: 'file' | 'directory';
    size?: number;
    path: string;
}

export interface DirectoryResponse {
    files: string[];
    dirs: string[];
    name: string;
    fullpath: string;
    relative_path: string;
}

export interface DirectoryErrorResponse {
    error: string;
    name: string;
    fullpath: string;
    relative_path: string;
}

// Terminal protocol types
export interface TerminalInitPayload {
    cols?: number;
    rows?: number;
}

export interface TerminalResizePayload {
    cols: number;
    rows: number;
}

export interface TerminalDataPayload {
    content: string;
}

export interface Cursor {
    line: number;
    column: number;
}

export interface CursorHistory {
    undoStack: Array<{ file: string; cursor: Cursor }>;
    redoStack: Array<{ file: string; cursor: Cursor }>;
}

export interface Terminal {
    id: string;
    name: string;
    session: string;
    cols: number;
    rows: number;
}

export interface WatcherEdits {
    file: string;
    edits: Edit[];
}

export interface WatcherCreate {
    path: string;
    isFile: boolean;
}

export interface WatcherRemove {
    path: string;
    isFile: boolean;
}

export interface PendingBatch {
    changes: Change[];
    timerId: number | null;
}

// ACP protocol types
export interface AcpAgent {
    id: string;
    name: string;
    command: string;
    args: string[];
    description?: string;
}

export type AcpPermissionMode = 'ask' | 'full_access';

export interface AcpPromptStateMessage {
    role: 'prompt_state';
    is_processing: boolean;
}

export interface AcpSelectOption {
    config_id: string;
    value: string;
    name: string;
    description?: string;
}

export interface AcpModelSelectorMessage {
    role: 'session_model_selector';
    current_value: string;
    options: AcpSelectOption[];
}

export interface AcpReasoningSelectorMessage {
    role: 'session_reasoning_selector';
    current_value: string;
    options: AcpSelectOption[];
}

export interface AcpContextUsageMessage {
    role: 'context_usage';
    used: number;
    size: number;
}

export interface AcpErrorMessage {
    role: 'error';
    message: string;
}

export interface AcpOpenFileMessage {
    role: 'open_file';
    path: string;
    line?: number;
}

export type AcpMessage =
    | AcpUserMessage
    | AcpAssistantMessage
    | AcpThoughtMessage
    | AcpToolCallMessage
    | AcpToolResultMessage
    | AcpToolUpdateMessage
    | AcpPromptStateMessage
    | AcpModelSelectorMessage
    | AcpReasoningSelectorMessage
    | AcpContextUsageMessage
    | AcpPermissionRequestMessage
    | AcpErrorMessage
    | AcpOpenFileMessage;

export interface AcpUserMessage {
    role: 'user';
    content: string;
    is_chunk?: boolean;
    checkpoint_id?: string;
}

export interface AcpAssistantMessage {
    role: 'assistant';
    content: string;
    is_chunk?: boolean;
}

export interface AcpThoughtMessage {
    role: 'thought';
    content: string;
    is_chunk?: boolean;
}

export interface AcpLocation {
    path: string;
    line?: number;
}

export type AcpToolKind = 'edit' | 'read' | 'search' | 'execute' | string;

export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'canceled' | string;

export interface AcpDiffContent {
    type: 'diff';
    path: string;
    oldText?: string | null;
    newText: string;
}

export interface AcpToolCallUnknownContent {
    type: string;
    [key: string]: unknown;
}

export type AcpToolCallContent = AcpDiffContent | AcpToolCallUnknownContent;

export interface AcpToolCallPayload {
    kind?: AcpToolKind;
    status?: AcpToolCallStatus;
    content?: AcpToolCallContent[];
    locations?: AcpLocation[];
    raw_input?: Record<string, unknown>;
    raw_output?: unknown;
}

export interface AcpToolCallProgressPayload {
    tool_call_id: string;
    kind?: AcpToolKind;
    status?: AcpToolCallStatus;
    title?: string | null;
    content?: AcpToolCallContent[];
    locations?: AcpLocation[];
    raw_input?: Record<string, unknown>;
    raw_output?: unknown;
    meta?: unknown;
}

export interface AcpToolCallMessage {
    role: 'tool_call';
    id: string;
    name: string;
    command?: string;
    title?: string;
    kind?: AcpToolKind;
    status?: AcpToolCallStatus;
    arguments: Record<string, unknown> | AcpToolCallPayload;
    content?: AcpToolCallContent[];
    raw_input?: Record<string, unknown>;
    raw_output?: unknown;
    locations?: AcpLocation[];
}

export interface AcpToolResultMessage {
    role: 'tool_result';
    id: string;
    result: AcpToolCallProgressPayload | Record<string, unknown>;
}

export interface AcpToolUpdateMessage {
    role: 'tool_update';
    id: string;
    update: AcpToolCallProgressPayload | Record<string, unknown>;
}

export interface AcpPermissionOption {
    id: string;
    name: string;
}

export interface AcpPermissionRequestMessage {
    role: 'permission_request';
    id: string;
    tool_call: {
        id: string;
        name: string;
        command?: string;
        arguments: any;
        locations?: AcpLocation[];
    };
    options: AcpPermissionOption[];
}

export interface AcpToolCall {
    id: string;
    name: string;
    arguments: any;
}

export interface AcpToolResult {
    id: string;
    result: any;
}

export interface AcpToolUpdate {
    id: string;
    update: any;
}

export interface AcpSession {
    agentId: string;
    agentName: string;
    sessionId?: string;
    agentConfigId?: string;
    messages: AcpMessage[];
    isActive: boolean;
    isProcessing?: boolean;
    modelSelector?: Omit<AcpModelSelectorMessage, 'role'>;
    reasoningSelector?: Omit<AcpReasoningSelectorMessage, 'role'>;
    contextUsage?: Omit<AcpContextUsageMessage, 'role'>;
}

export interface AcpSessionSummary {
    sessionId: string;
    cwd: string;
    title?: string;
    updatedAt?: string;
    preview?: string;
}

// Search types
export interface SearchMatch {
    line: number;
    column: number;
    preview: string;
}

export interface SearchResult {
    file_path: string;
    matches: SearchMatch[];
}

export interface SearchEnd {
    elapsed: number;
    matches: number;
}
