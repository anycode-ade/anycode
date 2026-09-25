import { AcpAgent } from './types';
import { loadAgents, saveAgents, loadDefaultAgentId, saveDefaultAgentId } from './storage';

// Default configuration of agents in code
// Can be overridden by user settings
export const KNOWN_PROFILE_TEMPLATES: Record<string, Record<string, string>> = {
    'antigravity-acp': {
        GEMINI_HOME: '~/.anycode/profiles/${id}',
        AGY_ACP_FORCE_FILE_STORAGE: '1',
    },
    'gemini': {
        GEMINI_HOME: '~/.anycode/profiles/${id}',
        AGY_ACP_FORCE_FILE_STORAGE: '1',
    },
    'claude': {
        CLAUDE_CONFIG_DIR: '~/.anycode/profiles/${id}',
    },
    'claude-code-acp': {
        CLAUDE_CONFIG_DIR: '~/.anycode/profiles/${id}',
    },
    'codex': {
        CODEX_HOME: '~/.anycode/profiles/${id}',
    },
    'codex-acp': {
        CODEX_HOME: '~/.anycode/profiles/${id}',
    },
};

export const GENERIC_PROFILE_TEMPLATE: Record<string, string> = {
    ANYCODE_PROFILE_DIR: '~/.anycode/profiles/${id}',
};

export function getRootAgentId(agentId: string, knownProfile?: string): string {
    if (knownProfile) {
        const slug = knownProfile.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        if (agentId.endsWith('-' + slug)) {
            return agentId.slice(0, -(slug.length + 1));
        }
    }
    const knownKeys = Object.keys(KNOWN_PROFILE_TEMPLATES).sort((a, b) => b.length - a.length);
    for (const key of knownKeys) {
        if (agentId === key || agentId.startsWith(key + '-')) {
            return key;
        }
    }
    const lastHyphen = agentId.lastIndexOf('-');
    return lastHyphen > 0 ? agentId.slice(0, lastHyphen) : agentId;
}

export function getProfileEnvForAgent(agent: AcpAgent, newId: string): Record<string, string> {
    const rootId = getRootAgentId(agent.id);
    const template = agent.profileEnv
        ?? KNOWN_PROFILE_TEMPLATES[agent.id]
        ?? KNOWN_PROFILE_TEMPLATES[rootId]
        ?? GENERIC_PROFILE_TEMPLATE;

    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(template)) {
        result[key] = val.replace(/\$\{id\}/g, newId);
    }
    return result;
}

export const DEFAULT_AGENTS: AcpAgent[] = [];

const isLegacyMockAgent = (agent: AcpAgent): boolean => {
    if (agent.id === 'qwen' && agent.command === 'qwen') return true;
    if (agent.id === 'grok' && agent.command === 'grok') return true;
    if (agent.id === 'opencode' && agent.command === 'opencode') return true;
    if (agent.id === 'codex' && agent.command === 'codex-acp') return true;
    return false;
};

let cachedAgents: AcpAgent[] | null = null;

export function getAllAgents(): AcpAgent[] {
    if (cachedAgents !== null) {
        return cachedAgents;
    }

    const rawSavedAgents = loadAgents();
    const savedAgents = rawSavedAgents.filter(a => !isLegacyMockAgent(a));
    if (savedAgents.length !== rawSavedAgents.length) {
        saveAgents(savedAgents);
    }

    const agentMap = new Map<string, AcpAgent>();

    savedAgents.forEach(agent => {
        let env = agent.env;
        if (env && env.GEMINI_HOME && !env.AGY_ACP_FORCE_FILE_STORAGE) {
            env = { ...env, AGY_ACP_FORCE_FILE_STORAGE: '1' };
        }

        let name = agent.name;
        let profile = agent.profile;
        if (!profile && name.includes('(')) {
            const parsed = parseAgentDisplayName(name);
            if (parsed.accountName) {
                name = parsed.baseName;
                profile = parsed.accountName;
            }
        }

        if (!profile && agent.id) {
            const rootId = getRootAgentId(agent.id);
            if (rootId && agent.id.startsWith(rootId + '-') && agent.id.length > rootId.length + 1) {
                const suffix = agent.id.slice(rootId.length + 1);
                if (suffix) {
                    profile = suffix;
                    if (name === agent.id || name.startsWith(rootId + '-')) {
                        name = rootId;
                    }
                }
            }
        }

        agentMap.set(agent.id, {
            ...agent,
            name,
            profile,
            env,
            profileEnv: agent.profileEnv ?? KNOWN_PROFILE_TEMPLATES[agent.id] ?? GENERIC_PROFILE_TEMPLATE,
            args: [...agent.args]
        });
    });

    cachedAgents = Array.from(agentMap.values());
    return cachedAgents;
}

export function getAgentById(id: string): AcpAgent | undefined {
    return getAllAgents().find(agent => agent.id === id);
}

export function getDefaultAgentId(): string | null {
    const savedId = loadDefaultAgentId();
    if (savedId) {
        // Verify that agent with this ID exists
        const agent = getAgentById(savedId);
        if (agent) {
            return savedId;
        }
    }

    // Fallback to first agent
    const agents = getAllAgents();
    if (agents.length > 0) {
        return agents[0].id;
    }

    return null;
}

type AgentsSyncCallback = (agents: AcpAgent[], defaultAgentId: string | null) => void;
let syncCallback: AgentsSyncCallback | null = null;

export function onAgentsUpdated(callback: AgentsSyncCallback | null): void {
    syncCallback = callback;
}

export function updateAgents(agents: AcpAgent[], defaultAgentId: string | null, shouldSync: boolean = true): void {
    cachedAgents = agents;
    saveAgents(agents);
    saveDefaultAgentId(defaultAgentId);
    if (shouldSync && syncCallback) {
        syncCallback(agents, defaultAgentId);
    }
}

export function setRemoteAgents(agents: AcpAgent[], defaultAgentId: string | null): void {
    saveAgents(agents);
    saveDefaultAgentId(defaultAgentId);
    clearAgentsCache();
    getAllAgents();
}

export function addOrUpdateAgent(agent: AcpAgent): void {
    const agents = getAllAgents();
    const existingIndex = agents.findIndex(a => a.id === agent.id);
    let nextAgents: AcpAgent[];
    if (existingIndex >= 0) {
        nextAgents = [...agents];
        nextAgents[existingIndex] = agent;
    } else {
        nextAgents = [...agents, agent];
    }
    updateAgents(nextAgents, getDefaultAgentId());
}

export function removeAgent(id: string): void {
    const agents = getAllAgents().filter(a => a.id !== id);
    const defaultId = getDefaultAgentId() === id ? (agents[0]?.id ?? null) : getDefaultAgentId();
    updateAgents(agents, defaultId);
}

export function clearAgentsCache(): void {
    cachedAgents = null;
}

export function ensureDefaultAgents(): void {
    // Force reload and merge with default agents
    clearAgentsCache();
    getAllAgents(); // This will merge saved agents with default agents
}

export function resetToDefaultAgents(): void {
    cachedAgents = [];
    saveAgents([]);
    saveDefaultAgentId(null);
    if (syncCallback) {
        syncCallback([], null);
    }
}

export function getDefaultAgent(): AcpAgent | undefined {
    const defaultId = getDefaultAgentId();
    if (defaultId) {
        return getAgentById(defaultId);
    }
    const all = getAllAgents();
    return all.length > 0 ? all[0] : undefined;
}

export function parseAgentDisplayName(fullName: string): { baseName: string; accountName?: string } {
    const match = fullName.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (match) {
        const baseName = match[1].trim() || fullName;
        const accountName = match[2].trim() || undefined;
        return { baseName, accountName };
    }
    return { baseName: fullName };
}

export function resolveAgentDisplay(
    item: { agentId?: string; agentName?: string; agentConfigId?: string; id?: string; name?: string; profile?: string },
    availableAgents: AcpAgent[] = []
): { baseName: string; accountName?: string; fullName: string } {
    const id = item.agentId || item.id || '';
    const rawName = item.agentName || item.name || id;
    const configId = item.agentConfigId;

    // 1. Exact match by configId or id
    let matched = availableAgents.find((a) => {
        if (configId && a.id === configId) return true;
        if (id && a.id === id) return true;
        return false;
    });

    // 2. Prefix match for runtime session IDs (e.g. `${configId}-1`), longest ID first
    if (!matched && id) {
        const candidates = availableAgents
            .filter((a) => id.startsWith(a.id + '-'))
            .sort((a, b) => b.id.length - a.id.length);
        matched = candidates[0];
    }

    let accountName = item.profile || matched?.profile;
    let baseName = matched?.name || rawName;

    if (!accountName) {
        const parsed = parseAgentDisplayName(baseName);
        if (parsed.accountName) {
            accountName = parsed.accountName;
            baseName = parsed.baseName;
        }
    }

    if (!accountName && id) {
        const rootId = getRootAgentId(id);
        if (rootId && id.startsWith(rootId + '-') && id.length > rootId.length + 1) {
            const suffix = id.slice(rootId.length + 1).replace(/-\d+$/, '');
            if (suffix) {
                accountName = suffix;
                if (baseName === id || baseName.startsWith(rootId + '-')) {
                    baseName = matched?.name && matched.name !== id ? matched.name : rootId;
                }
            }
        }
    }

    if (accountName && baseName) {
        const lowerProfile = accountName.toLowerCase();
        if (baseName.toLowerCase().endsWith('-' + lowerProfile)) {
            baseName = baseName.slice(0, -(accountName.length + 1)).trim();
        } else if (baseName.toLowerCase().endsWith(' (' + lowerProfile + ')')) {
            baseName = baseName.slice(0, -(accountName.length + 3)).trim();
        }
    }

    if (!baseName && id) {
        baseName = id;
    }

    const fullName = accountName ? `${baseName} (${accountName})` : baseName;
    return { baseName, accountName, fullName };
}

