import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  agentTemplatesStore,
  DEFAULT_AGENT_PROMPT_TEMPLATES,
  ACP_PROMPT_TEMPLATES_STORAGE_KEY,
} from './agentTemplatesStore';

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
})();

(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).window = { localStorage: mockLocalStorage };

describe('agentTemplatesStore', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    agentTemplatesStore.resetToDefaults();
  });

  it('initializes with default templates', () => {
    const templates = agentTemplatesStore.get();
    expect(templates.length).toBe(4);
    expect(templates[0].label).toBe('Explain current diff');
    expect(templates[0].text).toBe('Explain current diff');
    expect(templates[1].label).toBe('Review changes for bugs');
    expect(templates[2].label).toBe('Generate commit message');
    expect(templates[3].label).toBe('Commit and push');
  });

  it('adds a new template with label and text and persists to localStorage', () => {
    const created = agentTemplatesStore.add({
      label: 'Fix TS errors',
      text: 'Check for any TS errors and fix them with explanation',
    });

    const templates = agentTemplatesStore.get();
    expect(templates.some((t) => t.id === created.id)).toBe(true);
    expect(created.label).toBe('Fix TS errors');
    expect(created.text).toBe('Check for any TS errors and fix them with explanation');

    const stored = JSON.parse(localStorage.getItem(ACP_PROMPT_TEMPLATES_STORAGE_KEY) || '[]');
    expect(stored.some((t: any) => t.id === created.id)).toBe(true);
  });

  it('updates an existing template', () => {
    const templates = agentTemplatesStore.get();
    const firstId = templates[0].id;

    agentTemplatesStore.update(firstId, {
      label: 'Explain diff',
      text: 'Please explain every changed file in git diff thoroughly and step by step',
    });

    const updated = agentTemplatesStore.get().find((t) => t.id === firstId);
    expect(updated?.label).toBe('Explain diff');
    expect(updated?.text).toBe('Please explain every changed file in git diff thoroughly and step by step');
  });

  it('removes a template', () => {
    const templates = agentTemplatesStore.get();
    const firstId = templates[0].id;

    agentTemplatesStore.remove(firstId);

    const nextTemplates = agentTemplatesStore.get();
    expect(nextTemplates.some((t) => t.id === firstId)).toBe(false);
  });

  it('reorders templates', () => {
    const templates = agentTemplatesStore.get();
    const firstId = templates[0].id;
    const secondId = templates[1].id;

    agentTemplatesStore.reorder(0, 1);

    const reordered = agentTemplatesStore.get();
    expect(reordered[0].id).toBe(secondId);
    expect(reordered[1].id).toBe(firstId);
  });

  it('resets to defaults', () => {
    agentTemplatesStore.set([]);
    expect(agentTemplatesStore.get().length).toBe(0);

    agentTemplatesStore.resetToDefaults();
    expect(agentTemplatesStore.get().length).toBe(DEFAULT_AGENT_PROMPT_TEMPLATES.length);
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = agentTemplatesStore.subscribe(listener);

    agentTemplatesStore.add({ title: 'New Prompt' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    agentTemplatesStore.add({ title: 'Another Prompt' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
