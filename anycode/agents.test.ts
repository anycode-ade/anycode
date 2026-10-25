import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  getAgentAvatar,
  getDefaultAgentAvatar,
  setDefaultAgentAvatar,
  updateAgents,
} from './agents';
import { AcpAgent } from './types';

describe('Agent Avatar Resolution', () => {
  const store = new Map<string, string>();

  beforeAll(() => {
    const localStorageMock = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
    (globalThis as any).localStorage = localStorageMock;
  });

  beforeEach(() => {
    store.clear();
    setDefaultAgentAvatar(null, null);
  });

  it('returns null when no custom avatar and no default avatar is set', () => {
    const agents: AcpAgent[] = [
      { id: 'claude', name: 'Claude', command: 'claude-acp', args: [] },
    ];
    updateAgents(agents, 'claude');

    expect(getAgentAvatar('claude', 'Claude')).toBeNull();
  });

  it('returns default agent avatar when set and agent has no custom avatar', () => {
    const defaultData = 'data:image/png;base64,DEFAULT_AGENT_AVATAR';
    setDefaultAgentAvatar(defaultData);

    const agents: AcpAgent[] = [
      { id: 'claude', name: 'Claude', command: 'claude-acp', args: [] },
    ];
    updateAgents(agents, 'claude');

    expect(getAgentAvatar('claude', 'Claude')).toBe(defaultData);
  });

  it('returns custom avatar when set on the agent even if default avatar exists', () => {
    const defaultData = 'data:image/png;base64,DEFAULT_AGENT_AVATAR';
    const customData = 'data:image/png;base64,CUSTOM_CLAUDE_AVATAR';
    setDefaultAgentAvatar(defaultData);

    const agents: AcpAgent[] = [
      { id: 'claude', name: 'Claude', command: 'claude-acp', args: [], avatar: customData },
      { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] },
    ];
    updateAgents(agents, 'claude');

    // Claude has custom avatar
    expect(getAgentAvatar('claude', 'Claude')).toBe(customData);
    // Codex has no custom avatar, so gets default
    expect(getAgentAvatar('codex', 'Codex')).toBe(defaultData);
  });

  it('handles profiles independently: profile with custom avatar uses custom, profile without uses default', () => {
    const defaultData = 'data:image/png;base64,DEFAULT_AGENT_AVATAR';
    const workCustomData = 'data:image/png;base64,WORK_CUSTOM_AVATAR';
    setDefaultAgentAvatar(defaultData);

    const agents: AcpAgent[] = [
      {
        id: 'google-antigravity',
        name: 'Google Antigravity',
        command: 'agy-acp',
        args: [],
      },
      {
        id: 'google-antigravity-work',
        name: 'Google Antigravity',
        profile: 'work',
        command: 'agy-acp',
        args: [],
        avatar: workCustomData,
      },
      {
        id: 'google-antigravity-personal',
        name: 'Google Antigravity',
        profile: 'personal',
        command: 'agy-acp',
        args: [],
        // no custom avatar
      },
    ];
    updateAgents(agents, 'google-antigravity');

    // google-antigravity (no custom avatar) -> default
    expect(getAgentAvatar('google-antigravity', 'Google Antigravity')).toBe(defaultData);

    // google-antigravity-work (custom avatar) -> workCustomData
    expect(getAgentAvatar('google-antigravity-work', 'Google Antigravity (work)')).toBe(workCustomData);

    // google-antigravity-personal (no custom avatar) -> default
    expect(getAgentAvatar('google-antigravity-personal', 'Google Antigravity (personal)')).toBe(defaultData);
  });

  it('inherits root agent avatar for profile when root has custom avatar even if default avatar exists', () => {
    const defaultData = 'data:image/png;base64,DEFAULT_AGENT_AVATAR';
    const rootData = 'data:image/png;base64,ROOT_AGENT_AVATAR';
    setDefaultAgentAvatar(defaultData);

    const agents: AcpAgent[] = [
      {
        id: 'google-antigravity',
        name: 'Google Antigravity',
        command: 'agy-acp',
        args: [],
        avatar: rootData,
      },
      {
        id: 'google-antigravity-personal',
        name: 'Google Antigravity',
        profile: 'personal',
        command: 'agy-acp',
        args: [],
        // no custom avatar
      },
    ];
    updateAgents(agents, 'google-antigravity');

    // google-antigravity-personal inherits root agent avatar instead of generic default
    expect(getAgentAvatar('google-antigravity-personal', 'Google Antigravity (personal)')).toBe(rootData);
  });

  it('reverts back to null (AgentIcon) when default agent avatar is removed', () => {
    const defaultData = 'data:image/png;base64,DEFAULT_AGENT_AVATAR';
    setDefaultAgentAvatar(defaultData);

    const agents: AcpAgent[] = [
      { id: 'claude', name: 'Claude', command: 'claude-acp', args: [] },
    ];
    updateAgents(agents, 'claude');

    expect(getAgentAvatar('claude', 'Claude')).toBe(defaultData);

    // Remove default avatar
    setDefaultAgentAvatar(null);
    expect(getDefaultAgentAvatar()).toBeNull();
    expect(getAgentAvatar('claude', 'Claude')).toBeNull();
  });
});
