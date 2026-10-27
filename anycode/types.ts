import type { Change, Edit } from 'anycode-editor';

// Omit applied to each member of a union. Plain Omit<Union, K> keeps only the keys
// shared by all members, which rejects variant-specific fields in object literals.
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type FileSource =
    | { type: 'filesystem'; path: string }
    | { type: 'git'; revision: string; path: string; project_id?: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export interface TreeNode {
    id: string;
    name: string;
    type: 'file' | 'directory';
    path: string;
    project_id?: string;
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
    source?: FileSource;
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

export interface DirectoryResponse {
    files: string[];
    dirs: string[];
    name: string;
    fullpath: string;
    relative_path: string;
    project_id?: string;
    project_name?: string;
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
    project_id?: string;
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
    icon?: string;
    avatar?: string;
    avatarOriginal?: string;
    version?: string;
    profile?: string;
    authors?: string[];
    env?: Record<string, string>;
    profileEnv?: Record<string, string>;
}

export interface AcpRegistryNpxDistribution {
    package: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface AcpRegistryBinaryTarget {
    archive: string;
    cmd: string;
    args?: string[];
    sha256?: string;
    env?: Record<string, string>;
}

export interface AcpRegistryAgentSummary {
    id: string;
    name: string;
    version: string;
    description: string;
    repository?: string;
    website?: string;
    authors?: string[];
    license?: string;
    license_url?: string;
    icon?: string;
    distribution_type: 'npx' | 'binary' | 'both' | 'unsupported';
    is_supported: boolean;
    is_installed: boolean;
    installed_version?: string;
    installed_path?: string;
    has_update: boolean;
    npx?: AcpRegistryNpxDistribution;
    binary_target?: AcpRegistryBinaryTarget;
}

export interface AcpRegistryProgressEvent {
    agent_id: string;
    progress: number;
    status: 'downloading' | 'completed' | 'failed';
    error?: string;
}

export interface ResolvedAgentPreset {
    id: string;
    name: string;
    command: string;
    args: string[];
    description?: string;
    env?: Record<string, string>;
    icon?: string;
    version: string;
    distribution_type: string;
}

export * from 'anycode-agent';

// Search types
export interface SearchMatch {
    line: number;
    column: number;
    preview: string;
}

export interface SearchResult {
    file_path: string;
    display_path: string;
    matches: SearchMatch[];
}

export interface SearchResultsBatch {
    project_id?: string;
    results: SearchResult[];
}

export interface SearchEnd {
    project_id?: string;
    elapsed: number;
    matches: number;
}

export interface ReferencesPeekItemRangePosition {
    line: number;
    character: number;
}

export interface ReferencesPeekItemRange {
    start: ReferencesPeekItemRangePosition;
    end: ReferencesPeekItemRangePosition;
}

export interface ReferencesPeekItem {
    uri: string;
    file: string;
    range: ReferencesPeekItemRange;
}

export interface ReferencesPeekState {
    paneId: string;
    loading: boolean;
    error: string | null;
    items: ReferencesPeekItem[];
    selectedIndex: number;
    preview: string | null;
}
