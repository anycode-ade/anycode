
import { type Terminal, type AcpSession, type AcpAgent, type AcpPermissionMode } from './types';

export function saveItem<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error(`Failed to save ${key} to localStorage`, e);
    }
}

export function loadItem<T>(key: string): T | null {
    const stored = localStorage.getItem(key);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error(`Failed to parse ${key} from localStorage`, e);
        }
    }
    return null;
}

export function loadItemWithFallback<T>(key: string, fallbackKey: string): T | null {
    return loadItem<T>(key) ?? loadItem<T>(fallbackKey);
}

export function loadFilesPanelVisible(): boolean {
    return loadItemWithFallback<boolean>('filesPanelVisible', 'leftPanelVisible') ?? true;
}
export function loadTerminalPanelVisible(): boolean {
    return loadItemWithFallback<boolean>('terminalPanelVisible', 'bottomPanelVisible') ?? false;
}
export function loadTerminals(): Terminal[] {
    return loadItem('terminals') ?? [];
}
export function loadTerminalSelected(): number {
    return loadItem('terminalSelected') ?? 0;
}
export function loadAgentPanelVisible(): boolean {
    return loadItemWithFallback<boolean>('agentPanelVisible', 'rightPanelVisible') ?? true;
}
export function loadEditorPanelVisible(): boolean {
    return loadItemWithFallback<boolean>('editorPanelVisible', 'centerPanelVisible') ?? true;
}
export function loadDiffEnabled(): boolean {
    return loadItem('diffEnabled') ?? false;
}
export function loadFollowEnabled(): boolean {
    return loadItem('followEnabled') ?? false;
}

export function loadAcpPermissionMode(): AcpPermissionMode {
    return loadItem<AcpPermissionMode>('acpPermissionMode') ?? 'full_access';
}

export function saveAcpPermissionMode(mode: AcpPermissionMode): void {
    saveItem('acpPermissionMode', mode);
}

export function loadAcpSessions(): Map<string, AcpSession> {
    const stored = localStorage.getItem('acpSessions');
    if (stored) {
        try {
            const sessionsArray = JSON.parse(stored);
            const sessionsMap = new Map<string, AcpSession>();
            for (const [key, value] of Object.entries(sessionsArray)) {
                sessionsMap.set(key, value as AcpSession);
            }
            return sessionsMap;
        } catch (e) {
            console.error('Failed to parse acpSessions from localStorage', e);
        }
    }
    return new Map();
}

export function loadAgents(): AcpAgent[] {
    return loadItem('acpAgents') ?? [];
}
export function saveAgents(agents: AcpAgent[]): void {
    saveItem('acpAgents', agents);
}
export function loadDefaultAgentId(): string | null {
    return loadItem('acpDefaultAgentId') ?? null;
}
export function saveDefaultAgentId(agentId: string | null): void {
    saveItem('acpDefaultAgentId', agentId);
}
