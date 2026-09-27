import { useSyncExternalStore } from 'react';
import type { AgentPromptTemplate } from '../../types';

export const ACP_PROMPT_TEMPLATES_STORAGE_KEY = 'acpPromptTemplates';

export const DEFAULT_AGENT_PROMPT_TEMPLATES: AgentPromptTemplate[] = [
  {
    id: 'explain-diff',
    label: 'Explain current diff',
    text: 'Explain current diff',
  },
  {
    id: 'review-bugs',
    label: 'Review changes for bugs',
    text: 'Review changes for bugs',
  },
  {
    id: 'generate-commit',
    label: 'Generate commit message',
    text: 'Generate commit message',
  },
  {
    id: 'commit-push',
    label: 'Commit and push',
    text: 'Commit and push',
  },
];

const loadInitialTemplates = (): AgentPromptTemplate[] => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_AGENT_PROMPT_TEMPLATES;
  }
  try {
    const raw = localStorage.getItem(ACP_PROMPT_TEMPLATES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_AGENT_PROMPT_TEMPLATES;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item, idx) => {
        const label = (typeof item.label === 'string' && item.label)
          || (typeof item.title === 'string' && item.title)
          || '';
        const text = (typeof item.text === 'string' && item.text)
          || (typeof item.prompt === 'string' && item.prompt)
          || label;
        return {
          id: typeof item.id === 'string' && item.id ? item.id : `template-${Date.now()}-${idx}`,
          label,
          text,
          title: label,
          prompt: text,
        };
      });
    }
  } catch (err) {
    console.error('Failed to load agent prompt templates from localStorage', err);
  }
  return DEFAULT_AGENT_PROMPT_TEMPLATES;
};

let currentTemplates: AgentPromptTemplate[] = loadInitialTemplates();
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.error('Error in agentTemplatesStore listener', e);
    }
  });
};

const persist = (templates: AgentPromptTemplate[]) => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(ACP_PROMPT_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    } catch (e) {
      console.error('Failed to persist agent prompt templates to localStorage', e);
    }
  }
};

export const agentTemplatesStore = {
  get: (): AgentPromptTemplate[] => currentTemplates,

  set: (templates: AgentPromptTemplate[]): void => {
    currentTemplates = templates;
    persist(currentTemplates);
    notify();
  },

  add: (template: { label?: string; text?: string; title?: string; prompt?: string; id?: string }): AgentPromptTemplate => {
    const label = (template.label || template.title || '').trim();
    const text = (template.text !== undefined ? template.text : template.prompt !== undefined ? template.prompt : label).trim();
    const newTemplate: AgentPromptTemplate = {
      id: template.id || `template-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      text: text || label,
      title: label,
      prompt: text || label,
    };
    currentTemplates = [...currentTemplates, newTemplate];
    persist(currentTemplates);
    notify();
    return newTemplate;
  },

  update: (id: string, patch: Partial<AgentPromptTemplate>): void => {
    let hasChanges = false;
    currentTemplates = currentTemplates.map((item) => {
      if (item.id === id) {
        hasChanges = true;
        const nextLabel = patch.label !== undefined
          ? patch.label.trim()
          : patch.title !== undefined
            ? patch.title.trim()
            : item.label;
        const nextText = patch.text !== undefined
          ? patch.text.trim()
          : patch.prompt !== undefined
            ? patch.prompt.trim()
            : item.text;
        return {
          ...item,
          ...patch,
          label: nextLabel,
          text: nextText || nextLabel,
          title: nextLabel,
          prompt: nextText || nextLabel,
        };
      }
      return item;
    });
    if (hasChanges) {
      persist(currentTemplates);
      notify();
    }
  },

  remove: (id: string): void => {
    const next = currentTemplates.filter((item) => item.id !== id);
    if (next.length !== currentTemplates.length) {
      currentTemplates = next;
      persist(currentTemplates);
      notify();
    }
  },

  reorder: (startIndex: number, endIndex: number): void => {
    if (startIndex < 0 || startIndex >= currentTemplates.length || endIndex < 0 || endIndex >= currentTemplates.length) {
      return;
    }
    const next = [...currentTemplates];
    const [removed] = next.splice(startIndex, 1);
    next.splice(endIndex, 0, removed);
    currentTemplates = next;
    persist(currentTemplates);
    notify();
  },

  resetToDefaults: (): void => {
    currentTemplates = [...DEFAULT_AGENT_PROMPT_TEMPLATES];
    persist(currentTemplates);
    notify();
  },

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useAgentTemplates = (): AgentPromptTemplate[] => {
  return useSyncExternalStore(
    agentTemplatesStore.subscribe,
    agentTemplatesStore.get,
    agentTemplatesStore.get,
  );
};
