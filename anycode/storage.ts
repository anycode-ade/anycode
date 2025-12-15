
import { type Terminal, type AcpSession, type AcpAgent} from './types';

export function loadLeftPanelVisible(): boolean {
    const stored = localStorage.getItem('leftPanelVisible');
    if (stored) {
        return JSON.parse(stored);
    }
    return false;
}
export function loadTerminalVisible(): boolean {
    const stored = localStorage.getItem('terminalVisible');
    if (stored) {
        return JSON.parse(stored);
    }
    return false;
}

export function loadTerminals(): Terminal[] {
    const stored = localStorage.getItem('terminals');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Failed to parse terminals from localStorage', e);
        }
    }
    return [{ id: '0', name: 'terminal1', session: 'anycode', cols: 60, rows: 20 }];
};

export function loadTerminalSelected(): number {
    const stored = localStorage.getItem('terminalSelected');
    if (stored) {
        return JSON.parse(stored);
    }
    return 0;
}

export function loadAcpPanelVisible(): boolean {
    const stored = localStorage.getItem('acpPanelVisible');
    if (stored) {
        return JSON.parse(stored);
    }
    return true;
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

export function loadOpenAcpDialog(): string | null {
    const stored = localStorage.getItem('openAcpDialog');
    if (stored) {
        return JSON.parse(stored);
    }
    return null;
}

export function loadAgents(): AcpAgent[] {
    const stored = localStorage.getItem('acpAgents');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Failed to parse acpAgents from localStorage', e);
        }
    }
    return [];
}

export function saveAgents(agents: AcpAgent[]): void {
    try {
        localStorage.setItem('acpAgents', JSON.stringify(agents));
    } catch (e) {
        console.error('Failed to save acpAgents to localStorage', e);
    }
}

export function loadDefaultAgentId(): string | null {
    const stored = localStorage.getItem('acpDefaultAgentId');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Failed to parse acpDefaultAgentId from localStorage', e);
        }
    }
    return null;
}

export function saveDefaultAgentId(agentId: string | null): void {
    try {
        localStorage.setItem('acpDefaultAgentId', JSON.stringify(agentId));
    } catch (e) {
        console.error('Failed to save acpDefaultAgentId to localStorage', e);
    }
}