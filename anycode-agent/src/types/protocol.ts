export interface FileSearchResult {
    name: string;
    path: string;
    display_path?: string;
    type: 'file' | 'directory';
}

export interface OpenFileInfo {
    id: string;
    name: string;
    path: string;
}

export interface WorkspaceFileInfo {
    id: string;
    name: string;
    path: string;
    isDirectory?: boolean;
}

export interface AcpPromptStateMessage {
    role: 'prompt_state';
    is_processing: boolean;
}

export interface AcpPromptAttachment {
    name: string;
    mime_type: string;
    data_base64: string;
    size?: number;
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

export interface AcpAvailableCommand {
    name: string;
    description: string;
    input?: {
        hint?: string;
    };
}

export interface AcpAvailableCommandsMessage {
    role: 'available_commands';
    commands: AcpAvailableCommand[];
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

export interface AcpRawUpdateMessage {
    role: 'raw_update';
    agent_id: string;
    session_id?: string;
    ts: string;
    update: unknown;
}

export interface AcpQueuedMessage {
    id: string;
    prompt: string;
    attachments?: AcpPromptAttachment[];
    created_at: number;
}

export interface AcpQueueUpdateMessage {
    role: 'queue_update';
    queue: AcpQueuedMessage[];
}

export type AcpMessage =
    | AcpUserMessage
    | AcpAssistantMessage
    | AcpMediaMessage
    | AcpThoughtMessage
    | AcpToolCallMessage
    | AcpToolResultMessage
    | AcpToolUpdateMessage
    | AcpPromptStateMessage
    | AcpQueueUpdateMessage
    | AcpModelSelectorMessage
    | AcpReasoningSelectorMessage
    | AcpContextUsageMessage
    | AcpAvailableCommandsMessage
    | AcpErrorMessage
    | AcpOpenFileMessage
    | AcpRawUpdateMessage;

export interface AcpUserMessage {
    role: 'user';
    content: string;
    is_chunk?: boolean;
    checkpoint_id?: string;
    attachments?: AcpPromptAttachment[];
    /** Frontend-only ID used to reconcile an optimistic prompt with its ACP echo. */
    client_id?: string;
}

export interface AcpAssistantMessage {
    role: 'assistant';
    content: string;
    is_chunk?: boolean;
}

export interface AcpMediaMessage {
    role: 'media';
    media_type: 'image' | 'audio';
    mime_type?: string;
    data?: string;
    uri?: string;
    title?: string;
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
    has_full_output?: boolean;
    full_output_bytes?: number;
    is_truncated?: boolean;
    session_id?: string;
}

export interface AcpToolCallMessage {
    role: 'tool_call';
    id: string;
    session_id?: string;
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
    has_full_output?: boolean;
    full_output_bytes?: number;
    is_truncated?: boolean;
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

export interface AcpAuthMethod {
    id: string;
    name: string;
    description?: string;
}

export interface AcpSession {
    agentId: string;
    agentName: string;
    profile?: string;
    sessionId?: string;
    projectId?: string;
    agentConfigId?: string;
    messages: AcpMessage[];
    queue?: AcpQueuedMessage[];
    isActive: boolean;
    isStarting?: boolean;
    startError?: string;
    isProcessing?: boolean;
    lastReadMessageCount?: number;
    modelSelector?: Omit<AcpModelSelectorMessage, 'role'>;
    reasoningSelector?: Omit<AcpReasoningSelectorMessage, 'role'>;
    contextUsage?: Omit<AcpContextUsageMessage, 'role'>;
    availableCommands?: AcpAvailableCommand[];
    authRequired?: {
        methods: AcpAuthMethod[];
    };
    isAuthenticating?: boolean;
    pendingAuthMethod?: string;
}

export type AcpSessionState = AcpSession;

export interface AgentPromptTemplate {
    id: string;
    label: string;
    text: string;
    title?: string;
    prompt?: string;
}

export interface AcpSessionSummary {
    sessionId: string;
    cwd: string;
    projectId?: string;
    title?: string;
    updatedAt?: string;
    preview?: string;
}
