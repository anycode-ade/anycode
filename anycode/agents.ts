import { AcpAgent } from './types';
import { loadAgents, saveAgents, loadDefaultAgentId, saveDefaultAgentId } from './storage';

// Default configuration of agents in code
// Can be overridden by user settings
export const DEFAULT_AGENTS: AcpAgent[] = [
    {
        id: 'qwen',
        name: 'Qwen',
        command: 'qwen',
        args: [],
        description: 'Qwen AI coding agent',
    },
    {
        id: 'gemini',
        name: 'Gemini',
        command: 'gemini',
        args: ["--experimental-acp", "--yolo"],
        description: 'Google Gemini AI coding agent',
    },
    {
        id: 'claude',
        name: 'Claude',
        command: 'claude-code-acp',
        args: ["--experimental-acp", "--yolo"],
        description: 'Cluade AI coding agent',
    },
    {
        id: 'codex',
        name: 'codex',
        command: 'codex-acp',
        args: [],
        description: 'codex',
    },
    {
        id: 'opencode',
        name: 'opencode',
        command: 'opencode',
        args: ["acp"],
        description: 'opencode',
    },
];

let cachedAgents: AcpAgent[] | null = null;

export function getAllAgents(): AcpAgent[] {
    if (cachedAgents !== null) {
        return cachedAgents;
    }
    
    const savedAgents = loadAgents();
    
    // Merge saved agents with default agents
    // Ensure all DEFAULT_AGENTS are present (add missing ones)
    const agentMap = new Map<string, AcpAgent>();
    
    // First, add all saved agents
    savedAgents.forEach(agent => {
        agentMap.set(agent.id, {
            ...agent,
            args: [...agent.args] // Ensure args array is copied
        });
    });
    
    // Then, add all default agents that are missing
    DEFAULT_AGENTS.forEach(defaultAgent => {
        if (!agentMap.has(defaultAgent.id)) {
            // Create a deep copy of default agent
            agentMap.set(defaultAgent.id, {
                ...defaultAgent,
                args: [...defaultAgent.args]
            });
        }
    });
    
    cachedAgents = Array.from(agentMap.values());
    
    // If we added missing default agents, save the updated list
    if (cachedAgents.length > savedAgents.length) {
        saveAgents(cachedAgents);
    }
    
    // If no agents were saved before, also set default agent ID
    if (savedAgents.length === 0 && !loadDefaultAgentId() && cachedAgents.length > 0) {
        saveDefaultAgentId(cachedAgents[0].id);
    }
    
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

export function updateAgents(agents: AcpAgent[], defaultAgentId: string | null): void {
    cachedAgents = agents;
    saveAgents(agents);
    saveDefaultAgentId(defaultAgentId);
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
    // Create a deep copy so agents can be edited independently
    cachedAgents = DEFAULT_AGENTS.map(agent => ({
        ...agent,
        args: [...agent.args]
    }));
    saveAgents(cachedAgents);
    if (cachedAgents.length > 0) {
        saveDefaultAgentId(cachedAgents[0].id);
    }
}

export function getDefaultAgent(): AcpAgent | undefined {
    const defaultId = getDefaultAgentId();
    if (defaultId) {
        return getAgentById(defaultId);
    }
    return getAllAgents()[0];
}

