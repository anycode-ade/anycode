import React, { createContext, useContext } from 'react';
import type { AcpDiffContent } from '../types/protocol';
import { CodeCopyButton } from '../components/CodeCopyButton';
import type { AcpAvatarProps } from '../components/AcpAvatar';

export interface CodeBlockProps {
  code: string;
  language: string;
  isOpen?: boolean;
}

export interface DiffBlockProps {
  diff: AcpDiffContent;
}

export interface TerminalViewProps {
  content: string;
  isError?: boolean;
  maxHeight?: number;
  variant?: 'standalone' | 'embedded';
  showCopyButton?: boolean;
}

export interface AcpCustomComponents {
  CodeBlock?: React.ComponentType<CodeBlockProps>;
  DiffBlock?: React.ComponentType<DiffBlockProps>;
  TerminalView?: React.ComponentType<TerminalViewProps>;
  Avatar?: React.ComponentType<AcpAvatarProps>;
}

export const DefaultCodeBlock: React.FC<CodeBlockProps> = ({ code, language, isOpen }) => {
  return (
    <div className={`acp-code ${isOpen ? 'acp-code-streaming' : ''}`}>
      <div className="acp-code-toolbar">
        <CodeCopyButton content={code} />
      </div>
      <div className="acp-code-content">
        <pre className="acp-code-block-fallback">{code}</pre>
      </div>
    </div>
  );
};

export const DefaultDiffBlock: React.FC<DiffBlockProps> = ({ diff }) => {
  const displayText =
    diff.oldText !== undefined && diff.oldText !== null
      ? `--- before\n${diff.oldText}\n+++ after\n${diff.newText}`
      : diff.newText;

  return (
    <div className="acp-code acp-diff-code">
      <div className="acp-code-toolbar">
        <CodeCopyButton content={diff.newText} />
      </div>
      <div className="acp-code-content">
        <pre className="acp-code-block-fallback">{displayText}</pre>
      </div>
    </div>
  );
};

export const DefaultTerminalView: React.FC<TerminalViewProps> = ({
  content,
  isError = false,
  maxHeight = 220,
}) => {
  return (
    <div
      className={`acp-terminal-fallback ${isError ? 'is-error' : ''}`}
      style={{
        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px',
        padding: '8px',
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '4px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      <pre style={{ margin: 0 }}>{content}</pre>
    </div>
  );
};

export const AcpComponentsContext = createContext<AcpCustomComponents>({});
export const useAcpComponents = () => useContext(AcpComponentsContext);
