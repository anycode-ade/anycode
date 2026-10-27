# anycode-agent

AI agent chat and ACP session UI component for React.

`anycode-agent` provides the chat interface, tool call visualization, diff rendering, and prompt queues for the Agent Client Protocol (ACP). It powers the agent panel in Anycode and can be used standalone in any React application.

---

## ✨ Features

- ⚡ **Zero IDE Lock-in:** Runs standalone out of the box with built-in fallbacks. No hard dependencies on Tree-Sitter, Ghostty, or Socket.IO.
- 🔌 **Component Slots (Inversion of Control):** Inject your own high-performance code editor (such as `anycode-editor` or custom Tree-Sitter editor), diff viewer, terminal emulator (Ghostty, wterm), or user avatars.
- 💬 **ACP Protocol Native:** First-class support for ACP events: thoughts/reasoning folding, tool calls, tool results, streaming message chunks, model/reasoning selectors, and auth banners.
- 📜 **Smooth Auto-Scroll & Native Highlighting:** Eased follow-bottom scrolling during fast token streaming, persisted scroll position per session, and native CSS Custom Highlight API for in-chat search.
- 🎯 **Rich Prompt Bar (`AcpInput`):**
  - Auto-resizing multi-line text input with IME composition safety.
  - Contextual `@` file mentions and `/` slash commands.
  - Code & terminal selection quoting with interactive chip badges.
  - Drag-and-drop and clipboard paste image attachments.
- ⏳ **Prompt Queueing (`AcpQueue`):** Queue prompts while the agent is busy, reorder with up/down arrows, edit on the fly, or send immediately.
- 💾 **Pluggable Storage:** Built-in `SafeLocalStorage` (SSR-safe, handles Safari private mode quota errors) and `MemoryStorage`.

---

## 📦 Installation

```bash
pnpm add anycode-agent
# or
npm install anycode-agent
# or
yarn add anycode-agent
```

### Peer Dependencies
Ensure you have React 18 or 19 installed:
```bash
pnpm add react react-dom
```

---

## 🚀 Quick Start

Import the CSS and render `<AgentSession />`:

```tsx
import React, { useState } from 'react';
import {
  AgentSession,
  type AcpMessage,
  type AgentSessionProps,
} from 'anycode-agent';
import 'anycode-agent/styles.css';

export function AgentChat() {
  const [messages, setMessages] = useState<AcpMessage[]>([
    {
      role: 'assistant',
      content: 'Hello! I am your AI assistant. How can I help you today?',
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSendPrompt = (agentId: string, prompt: string) => {
    // 1. Append user message
    const userMsg: AcpMessage = { role: 'user', content: prompt };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    // 2. Send prompt to your ACP backend / agent process
    myAcpClient.sendPrompt({ agentId, prompt }).then((response) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: response.text }]);
      setIsProcessing(false);
    });
  };

  return (
    <div style={{ width: '450px', height: '100vh', display: 'flex' }}>
      <AgentSession
        agentId="assistant-1"
        title="Coding Assistant"
        isConnected={true}
        isProcessing={isProcessing}
        messages={messages}
        onSendPrompt={handleSendPrompt}
        onCancelPrompt={() => myAcpClient.cancel()}
        onUndoPrompt={() => myAcpClient.undo()}
        onCloseAgent={() => console.log('Close session')}
        onFocusPane={() => {}}
      />
    </div>
  );
}
```

---

## 🧪 Example App

A runnable demo with a static transcript and a live mock session lives in [`example/`](./example). Run it with `cd example && npm install && npm run dev`.

## 🧩 Slot Architecture (Component Inversion of Control)

Every major sub-view in `anycode-agent` can be replaced using the `components` prop on `<AgentSession />`. If omitted, lightweight default fallbacks are used automatically.

```tsx
import {
  AgentSession,
  type AcpCustomComponents,
  type CodeBlockProps,
  type DiffBlockProps,
  type TerminalViewProps,
  type AcpAvatarProps,
  CodeCopyButton,
} from 'anycode-agent';

const customComponents: AcpCustomComponents = {
  // 1. Custom Code Viewer (e.g. anycode-editor / custom Tree-Sitter editor)
  CodeBlock: ({ code, language, isOpen }: CodeBlockProps) => (
    <div className="my-custom-code-block">
      <div className="toolbar">
        <span>{language}</span>
        <CodeCopyButton content={code} />
      </div>
      <MyCodeEditor code={code} language={language} readOnly />
    </div>
  ),

  // 2. Custom Diff Viewer
  DiffBlock: ({ diff }: DiffBlockProps) => (
    <MyDiffViewer
      oldValue={diff.oldText ?? ''}
      newValue={diff.newText}
      filePath={diff.path}
    />
  ),

  // 3. Custom Terminal Output (e.g. Ghostty / wterm)
  TerminalView: ({ content, isError, maxHeight }: TerminalViewProps) => (
    <MyTerminalView content={content} isError={isError} maxHeight={maxHeight} />
  ),

  // 4. Custom User / Agent Avatar
  Avatar: ({ type, agentTitle, size, userAvatar }: AcpAvatarProps) => (
    <img
      src={type === 'user' ? (userAvatar || '/user.png') : '/bot-logo.svg'}
      alt={agentTitle || 'Avatar'}
      style={{ width: size ?? 24, height: size ?? 24, borderRadius: '50%' }}
    />
  ),
};

export function App() {
  return <AgentSession {...props} components={customComponents} />;
}
```

---

## ✂️ Selection & Code Quoting System

`anycode-agent` provides a built-in quote store so users can select text in any editor, log viewer, or terminal outside the chat and quote it directly into the input bar.

### 1. Feeding Quotes into the Store
Whenever selection changes in your editor or terminal:

```ts
import { selectionQuoteStore } from 'anycode-agent';

// From an editor:
selectionQuoteStore.set({
  id: 'selection-1',
  source: 'editor',
  filePath: 'src/utils/helpers.ts',
  displayPath: 'utils/helpers.ts',
  lineRange: [42, 58],
  language: 'typescript',
  text: selectedText,
  label: 'helpers.ts (L42-58)',
});

// From a terminal:
selectionQuoteStore.set({
  id: 'term-quote-1',
  source: 'terminal',
  text: selectedLog,
  label: 'Terminal: bash',
});

// Clear selection:
selectionQuoteStore.clear();
```

### 2. How it Appears to the User
When `selectionQuoteStore` has an active quote, `<AcpInput />` displays a glowing `+ Add quote` star button. Clicking it turns the quote into a removable badge chip in the input and splits the user's message into blocks.

### 3. How Quotes are Sent
When the user submits, `formatPromptBlocks(blocks)` automatically formats quotes into standard Markdown:
```markdown
[helpers.ts:42-58](utils/helpers.ts#L42-L58)
```typescript
export function calculateHash(data: string): string {
  // ...
}
```

Can you optimize this function?
```

---

## 🛠️ Handling Tool Calls & Large Outputs

When an agent executes tools (e.g., editing files, running bash commands, searching the codebase), ACP generates `tool_call`, `tool_update`, and `tool_result` messages.

### Message Structure
```ts
interface AcpToolCallMessage {
  role: 'tool_call';
  id: string;
  name: string;
  title: string;
  kind?: 'edit' | 'execute' | 'read' | 'search' | string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'canceled';
  arguments: Record<string, unknown>;
  content?: AcpToolCallContent[]; // e.g. [{ type: 'diff', path, oldText, newText }]
  raw_input?: Record<string, unknown>;
  raw_output?: unknown;
  is_truncated?: boolean;
  has_full_output?: boolean;
  full_output_bytes?: number;
}
```

### Lazy-loading Truncated Outputs
To keep WebSocket streaming fast, backends often truncate huge tool outputs and store the full output in a database or blob store.

Provide `onGetToolOutput` to fetch the full output on demand:
```tsx
<AgentSession
  {...props}
  onGetToolOutput={async (toolId, sessionId) => {
    const res = await fetch(`/api/tools/${toolId}/full-output?session=${sessionId}`);
    const data = await res.json();
    return data.output; // string
  }}
/>
```
Fetched outputs are automatically cached in the client-side `toolOutputCache` (LRU up to 100 MB, 5-minute TTL).

---

## 💾 Custom Storage Adapter

`anycode-agent` persists input drafts and scroll positions so tabs and page reloads don't lose the user's work. You can customize the storage engine:

```tsx
import { AgentSession, type AcpStorage } from 'anycode-agent';

class CustomStorage implements AcpStorage {
  getItem(key: string) {
    return sessionStorage.getItem(key);
  }
  setItem(key: string, value: string) {
    sessionStorage.setItem(key, value);
  }
  removeItem(key: string) {
    sessionStorage.removeItem(key);
  }
}

<AgentSession {...props} storage={new CustomStorage()} />
```

---

## 📋 Props Reference (`AgentSessionProps`)

| Prop | Type | Description |
| :--- | :--- | :--- |
| `agentId` | `string` | **Required.** Unique identifier for the agent session |
| `title` | `string` | **Required.** Name or display title of the agent |
| `messages` | `AcpMessage[]` | **Required.** Array of ACP messages in the conversation |
| `isConnected` | `boolean` | **Required.** Whether the ACP backend connection is active |
| `isProcessing` | `boolean` | If true, shows active thinking / streaming spinners |
| `isStarting` | `boolean` | If true, shows initial startup loading state |
| `startError` | `string` | Startup error message if agent failed to launch |
| `queue` | `AcpQueuedMessage[]` | Array of queued prompts waiting for execution |
| `components` | `AcpCustomComponents` | Custom component slots (`CodeBlock`, `DiffBlock`, `TerminalView`, `Avatar`) |
| `emptyState` | `ReactNode \| (props) => ReactNode` | Custom empty state rendered when there are no messages |
| `storage` | `AcpStorage` | Storage adapter (defaults to `SafeLocalStorage`) |
| `modelSelector` | `AcpModelSelectorMessage` | Model dropdown configuration options and active value |
| `reasoningSelector` | `AcpReasoningSelectorMessage` | Reasoning/thinking effort configuration |
| `availableCommands` | `AcpAvailableCommand[]` | Slash commands available for autocompletion (`/help`, `/plan`) |
| `authRequired` | `{ methods: AcpAuthMethod[] }` | Displays an authentication banner if the agent requires login |
| `onSendPrompt` | `(agentId, prompt, attachments) => void` | Called when the user submits a prompt |
| `onCancelPrompt` | `(agentId) => void` | Called when the user clicks the stop / cancel button |
| `onUndoPrompt` | `(agentId, checkpointId) => void` | Called when the user reverts to a checkpoint |
| `onOpenFile` | `(path, line, col) => void` | Called when a file link is clicked in tool calls or markdown |
| `onOpenFileDiff` | `(path, line, col) => void` | Called when a diff file header is clicked |
| `onGetToolOutput` | `(toolId, sessionId) => Promise<string \| null>` | Callback for lazy-loading truncated tool outputs |

---

## 🎨 Styling & Theming

`anycode-agent` comes with dark and light theme styles. Import the pre-bundled stylesheet in your application:

```ts
import 'anycode-agent/styles.css';
```

All elements use namespaced BEM-style CSS classes prefixed with `acp-` (e.g., `.acp-session`, `.acp-message`, `.acp-input`, `.acp-work-group`, `.acp-tool-call`), making overrides clean and isolated.

---

## 📄 License

Apache-2.0 © Anycode
