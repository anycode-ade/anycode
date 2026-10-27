import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentSession, AcpAvatar } from 'anycode-agent';
import '../src/styles.css';
import './demo.css';
import { streamReply } from './mock-agent.js';
import { EditorCodeBlock, EditorDiffBlock } from './editor-blocks.jsx';

const noop = () => {};

// Brand logos from public/: Codex mark for the agent, anycode logo for the user.
const AGENT_AVATAR = '/codex.svg';
const USER_AVATAR = '/anycode.svg';

function DemoAvatar(props) {
  return <AcpAvatar {...props} avatar={AGENT_AVATAR} userAvatar={USER_AVATAR} />;
}

const COMPONENTS = { Avatar: DemoAvatar, CodeBlock: EditorCodeBlock, DiffBlock: EditorDiffBlock };

const MODEL_OPTIONS = [
  { config_id: 'model', value: 'sonnet', name: 'Claude Sonnet 4.5' },
  { config_id: 'model', value: 'opus', name: 'Claude Opus 4.1' },
  { config_id: 'model', value: 'haiku', name: 'Claude Haiku 4.5' },
];

// Shared shell: the component takes the whole pane, so each demo passes only what it needs.
// The model dropdown is hidden unless both modelSelector and onSelectModel are given.
function Session(props) {
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);

  return (
    <div className="agent-pane">
      <AgentSession
        agentId="example-agent"
        title="Coding assistant"
        projectName="anycode"
        isConnected
        onFocusPane={noop}
        onCloseAgent={noop}
        components={COMPONENTS}
        modelSelector={{ current_value: model, options: MODEL_OPTIONS }}
        onSelectModel={(_agentId, option) => setModel(option.value)}
        {...props}
      />
    </div>
  );
}

// Undo drops the chosen prompt and everything after it.
function truncateFrom(messages, checkpointId) {
  const index = messages.findIndex((m) => m.role === 'user' && m.checkpoint_id === checkpointId);
  return index === -1 ? messages : messages.slice(0, index);
}

// ---------------------------------------------------------------------------
// Demo 1: static transcript. Shows how each message role renders.
// ---------------------------------------------------------------------------

const FIXTURE_MESSAGES = [
  {
    role: 'user',
    content: 'Why does the tab bar jump when I resize the window?',
    checkpoint_id: 'cp-fixture-1',
  },
  {
    role: 'thought',
    content: 'The active tab is measured once, before the layout settles, so the scroll offset is computed from a stale width. Reading the component first.',
  },
  {
    role: 'tool_call',
    id: 'tool-read',
    name: 'read_file',
    kind: 'read',
    status: 'completed',
    title: 'Read src/components/TabBar.tsx',
    arguments: { path: 'src/components/TabBar.tsx' },
  },
  {
    role: 'tool_result',
    id: 'tool-read',
    result: {
      tool_call_id: 'tool-read',
      status: 'completed',
      raw_output: 'export function TabBar({ tabs, activeId }) {\n  const ref = useRef(null);\n  useEffect(() => {\n    ref.current.scrollLeft = activeOffset(ref.current, activeId);\n  }, [activeId]);\n  // ...\n}',
    },
  },
  {
    role: 'tool_call',
    id: 'tool-edit',
    name: 'edit_file',
    kind: 'edit',
    status: 'completed',
    title: 'Edit src/components/TabBar.tsx',
    arguments: { path: 'src/components/TabBar.tsx' },
    content: [
      {
        type: 'diff',
        path: 'src/components/TabBar.tsx',
        oldText: '  useEffect(() => {\n    ref.current.scrollLeft = activeOffset(ref.current, activeId);\n  }, [activeId]);',
        newText: '  useEffect(() => {\n    const observer = new ResizeObserver(() => scrollToActive());\n    observer.observe(ref.current);\n    return () => observer.disconnect();\n  }, [activeId]);',
      },
    ],
  },
  {
    role: 'tool_result',
    id: 'tool-edit',
    result: { tool_call_id: 'tool-edit', status: 'completed' },
  },
  {
    role: 'assistant',
    content: 'The offset was computed only when `activeId` changed, so a resize left the active tab off-screen. The fix re-centres on every resize:\n\n```ts\nuseEffect(() => {\n  const observer = new ResizeObserver(() => scrollToActive());\n  observer.observe(ref.current);\n  return () => observer.disconnect();\n}, [activeId]);\n```\n\nNext step: add a test for a narrow window.',
  },
  {
    role: 'user',
    content: 'Ok, add that test. Make sure the active tab stays visible at 320px.',
    checkpoint_id: 'cp-fixture-2',
  },
  {
    role: 'thought',
    content: 'Existing tests render TabBar at the default width. I need to find where the test helpers set the viewport, then reuse them.',
  },
  {
    role: 'tool_call',
    id: 'tool-search',
    name: 'grep',
    kind: 'search',
    status: 'completed',
    title: 'Search for setViewport',
    arguments: { pattern: 'setViewport' },
  },
  {
    role: 'tool_result',
    id: 'tool-search',
    result: {
      tool_call_id: 'tool-search',
      status: 'completed',
      raw_output: 'src/components/TabBar.test.tsx:12: setViewport(320);\nsrc/test/helpers.ts:4: export function setViewport(width: number) {',
    },
  },
  {
    role: 'tool_call',
    id: 'tool-test',
    name: 'run_command',
    kind: 'execute',
    status: 'completed',
    title: 'Run npm test -- TabBar',
    arguments: { command: 'npm test -- TabBar' },
  },
  {
    role: 'tool_result',
    id: 'tool-test',
    result: {
      tool_call_id: 'tool-test',
      status: 'completed',
      raw_output: 'PASS src/components/TabBar.test.tsx\n  ✓ keeps the active tab visible on resize (34 ms)\n\nTests: 1 passed, 1 total',
    },
  },
  {
    role: 'assistant',
    content: 'Added `keeps the active tab visible on resize` to `TabBar.test.tsx`. It sets the viewport to 320px, changes the active tab, and checks that its offset is inside the scroll container.\n\nThe test passes. It fails on the old code, so it covers the regression:\n\n- uses the existing `setViewport` helper\n- does not touch the component code\n- runs in about 34 ms',
  },
  {
    role: 'user',
    content: 'Does the same bug affect the vertical tab list?',
    checkpoint_id: 'cp-fixture-3',
  },
  {
    role: 'thought',
    content: 'The vertical list scrolls on the Y axis and uses the same `activeOffset` helper, so it probably has the same stale-measure problem. I will check it.',
  },
  {
    role: 'assistant',
    content: 'Probably yes. `VerticalTabList` calls `activeOffset` in the same effect, so it has the same stale-measure issue on a height change.\n\nI would apply the same `ResizeObserver` fix there and add a test for a short window height. Want me to do that?',
  },
];

function TranscriptDemo() {
  const [messages, setMessages] = useState(FIXTURE_MESSAGES);

  return (
    <Session
      messages={messages}
      onSendPrompt={(_agentId, prompt, attachments = []) =>
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: prompt, attachments },
          { role: 'assistant', content: 'This is a static transcript, so nothing was sent to an agent. Open **Live session** to see streaming, queueing and cancel.' },
        ])
      }
      onCancelPrompt={noop}
      onUndoPrompt={(_agentId, checkpointId) => setMessages((prev) => truncateFrom(prev, checkpointId))}
    />
  );
}

// ---------------------------------------------------------------------------
// Demo 2: live session driven by the mock agent. Mirrors the queue rules of the
// real backend: cancel keeps queued prompts but does not start them; "send now"
// moves an item to the front and resumes the queue.
// ---------------------------------------------------------------------------

let idSeq = 0;
const nextId = (prefix) => `${prefix}-${++idSeq}`;

// Only the last assistant message is ever streamed into.
function withLastAssistant(messages, content) {
  const next = messages.slice();
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].role === 'assistant') {
      next[i] = { ...next[i], content };
      break;
    }
  }
  return next;
}

function LiveDemo() {
  const [messages, setMessages] = useState([]);
  const [queue, setQueue] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Refs hold the source of truth for callbacks that run later (stream end, timers).
  // They only touch refs and state setters, so stale closures are safe.
  const runRef = useRef(null); // { stream } while a reply is streaming
  const pausedRef = useRef(false); // set by cancel/undo; queued prompts wait until resumed
  const queueRef = useRef([]);

  function setQueueItems(next) {
    queueRef.current = next;
    setQueue(next);
  }

  function startNext() {
    const next = queueRef.current[0];
    if (runRef.current || pausedRef.current || !next) return;
    setQueueItems(queueRef.current.slice(1));
    startReply(next.prompt, next.attachments);
  }

  function startReply(prompt, attachments) {
    const run = {};
    runRef.current = run;
    setIsProcessing(true);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: prompt, attachments, checkpoint_id: nextId('cp') },
      { role: 'assistant', content: '' },
    ]);

    run.stream = streamReply(prompt, (text) => {
      if (runRef.current === run) setMessages((prev) => withLastAssistant(prev, text));
    });

    run.stream.done.then(() => {
      if (runRef.current !== run) return; // cancelled or replaced by "send now"
      runRef.current = null;
      setIsProcessing(false);
      startNext();
    });
  }

  // Stops the reply in flight and pauses the queue. Returns false if nothing was running.
  function stopRun() {
    const run = runRef.current;
    if (!run) return false;
    runRef.current = null;
    run.stream.cancel();
    pausedRef.current = true;
    setIsProcessing(false);
    return true;
  }

  function handleSendPrompt(_agentId, prompt, attachments = []) {
    // An empty queue means nothing is being held back, so a new prompt runs right away.
    if (queueRef.current.length === 0) pausedRef.current = false;
    setQueueItems([...queueRef.current, { id: nextId('q'), prompt, attachments, created_at: Date.now() }]);
    startNext();
  }

  function handleCancel() {
    stopRun();
  }

  function handleUndo(_agentId, checkpointId) {
    stopRun();
    setMessages((prev) => truncateFrom(prev, checkpointId));
  }

  function handleSendNow(_agentId, itemId) {
    const index = queueRef.current.findIndex((item) => item.id === itemId);
    if (index === -1) return;
    const item = queueRef.current[index];
    setQueueItems([item, ...queueRef.current.filter((_, i) => i !== index)]);
    pausedRef.current = false;
    if (runRef.current) {
      const run = runRef.current;
      runRef.current = null;
      run.stream.cancel();
    }
    startNext();
  }

  function handleUpdateQueue(_agentId, itemId, prompt) {
    setQueueItems(queueRef.current.map((item) => (item.id === itemId ? { ...item, prompt } : item)));
  }

  function handleRemoveQueue(_agentId, itemId) {
    setQueueItems(queueRef.current.filter((item) => item.id !== itemId));
  }

  function handleMoveQueue(_agentId, itemId, direction) {
    const list = queueRef.current.slice();
    const index = list.findIndex((item) => item.id === itemId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setQueueItems(list);
  }

  return (
    <Session
      messages={messages}
      queue={queue}
      isProcessing={isProcessing}
      onSendPrompt={handleSendPrompt}
      onCancelPrompt={handleCancel}
      onUndoPrompt={handleUndo}
      onSendQueueItemNow={handleSendNow}
      onUpdateQueueItem={handleUpdateQueue}
      onRemoveQueueItem={handleRemoveQueue}
      onMoveQueueItem={handleMoveQueue}
    />
  );
}

// ---------------------------------------------------------------------------

const DEMOS = [
  { id: 'transcript', label: 'Transcript', Component: TranscriptDemo },
  { id: 'live', label: 'Live session', Component: LiveDemo },
];

function App() {
  const [activeId, setActiveId] = useState(DEMOS[0].id);
  const active = DEMOS.find((demo) => demo.id === activeId);

  return (
    <div className="app">
      <header className="app-header">
        <h1>anycode-agent examples</h1>
        <nav>
          {DEMOS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              className={`btn ${demo.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(demo.id)}
            >
              {demo.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {/* key remounts the demo so its state does not leak between tabs */}
        <active.Component key={active.id} />
      </main>
    </div>
  );
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
