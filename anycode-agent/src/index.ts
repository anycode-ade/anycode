// Components
export {
  AgentSession,
  type AgentSessionProps,
  type AgentSessionProps as AcpSessionProps,
  type AcpEmptyStateRenderProps,
} from './components/AgentSession';
export { AcpMessages } from './components/AcpMessages';
export { AcpMessage as AcpMessageView, type AcpMessageProps } from './components/AcpMessage';
export { AcpInput } from './components/AcpInput';
export { AcpQueue, type AcpQueueProps } from './components/AcpQueue';
export { AcpAvatar, type AcpAvatarProps } from './components/AcpAvatar';
export { AgentIcon, hasBuiltinAgentIcon } from './components/AgentIcon';
export { AcpIcons } from './components/AcpIcons';
export { AcpTerminalCard, type AcpTerminalCardProps, formatCwd } from './components/AcpTerminalCard';
export { AcpWorkGroup } from './components/AcpWorkGroup';
export { CodeCopyButton } from './components/CodeCopyButton';

// Slots
export {
  AcpComponentsContext,
  useAcpComponents,
  DefaultCodeBlock,
  DefaultDiffBlock,
  DefaultTerminalView,
  type AcpCustomComponents,
  type CodeBlockProps,
  type DiffBlockProps,
  type TerminalViewProps,
} from './slots';

// Protocol & Types
export * from './types/protocol';

// Utils
export {
  selectionQuoteStore,
  useSelectionQuote,
  formatSingleQuote,
  formatPromptBlocks,
  formatPromptWithQuotes,
  formatPromptWithQuote,
  type SelectionQuote,
  type QuoteSource,
  type InputBlock,
} from './utils/selectionQuoteStore';
export { toolOutputCache, ToolOutputCache, type CacheEntry } from './utils/toolOutputCache';
export {
  normalizePath,
  uriToFilePath,
  getFileName,
  getParentPath,
  copyTextToClipboard,
  formatBytes,
  LANGUAGE_EXTENSIONS,
  getLanguageFromFileName,
} from './utils/helpers';
export {
  type ToolResultImage,
  getToolResultImages,
} from './utils/acpToolUtils';
export {
  type AcpStorage,
  MemoryStorage,
  SafeLocalStorage,
  defaultStorage,
} from './utils/storage';
