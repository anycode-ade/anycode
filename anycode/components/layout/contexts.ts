import React from 'react';
import { type AcpAgent, type AcpSession, type SearchMatch } from '../../types';
import { useAgents } from '../../hooks/useAgents';
import { useEditors } from '../../hooks/useEditors';
import { useFileTree } from '../../hooks/useFileTree';
import { useGit } from '../../hooks/useGit';
import { useSearch } from '../../hooks/useSearch';
import { useTerminals } from '../../hooks/useTerminals';

export type FileTreePanelContextValue = {
    fileTree: ReturnType<typeof useFileTree>;
    openFolder: (path: string) => void;
    openFileInEditorPane: (filePath: string, line?: number, column?: number) => void;
};

export type SearchPanelContextValue = {
    search: ReturnType<typeof useSearch>;
    onSearch: ({ pattern }: { id: string; pattern: string }) => void;
    onMatchClick: (filePath: string, match: SearchMatch) => void;
};

export type ChangesPanelContextValue = {
    git: ReturnType<typeof useGit>;
    openFileDiffInEditorPane: (filePath: string, line?: number, column?: number) => void;
};

export type EditorPanelContextValue = {
    editors: ReturnType<typeof useEditors>;
};

export type TerminalPanelContextValue = {
    terminals: ReturnType<typeof useTerminals>;
    isConnected: boolean;
    terminalPaneTerminalIds: Record<string, string>;
    focusedTerminalPaneId: string | null;
    bindTerminalToPane: (paneId: string, terminalId: string) => void;
    setFocusedTerminalPaneId: React.Dispatch<React.SetStateAction<string | null>>;
};

export type AgentPanelContextValue = {
    agents: ReturnType<typeof useAgents>;
    agentPaneSessionIds: Record<string, string>;
    focusedAgentPaneId: string | null;
    isConnected: boolean;
    availableAgents: AcpAgent[];
    bindAgentToPane: (paneId: string, agentId: string) => void;
    handleStartSpecificAgentInPane: (paneId: string, agent: AcpAgent) => string | undefined;
    handleCloseAgentEverywhere: (agentId: string) => void;
    openFileInEditorPane: (filePath: string, line?: number, column?: number) => void;
    openFileDiffInEditorPane: (filePath: string, line?: number, column?: number) => void;
    setFocusedAgentPaneId: React.Dispatch<React.SetStateAction<string | null>>;
};

export type ToolbarPanelContextValue = {
    editors: ReturnType<typeof useEditors>;
    terminals: ReturnType<typeof useTerminals>;
    sessionsArray: AcpSession[];
    focusedAgentId: string | null;
    focusedTerminalId: string | null;
    bindTerminalToFocusedPane: (terminalId: string) => void;
    bindAgentToFocusedPane: (agentId: string) => void;
    handleCloseAgentEverywhere: (agentId: string) => void;
};

export const FileTreePanelContext = React.createContext<FileTreePanelContextValue | null>(null);
export const SearchPanelContext = React.createContext<SearchPanelContextValue | null>(null);
export const ChangesPanelContext = React.createContext<ChangesPanelContextValue | null>(null);
export const EditorPanelContext = React.createContext<EditorPanelContextValue | null>(null);
export const TerminalPanelContext = React.createContext<TerminalPanelContextValue | null>(null);
export const AgentPanelContext = React.createContext<AgentPanelContextValue | null>(null);
export const ToolbarPanelContext = React.createContext<ToolbarPanelContextValue | null>(null);

export const useRequiredContext = <T,>(context: React.Context<T | null>, name: string): T => {
    const value = React.useContext(context);
    if (value === null) {
        throw new Error(`${name} is missing a provider.`);
    }
    return value;
};
