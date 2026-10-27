# anycode-agent example

A small Vite app that renders `AgentSession` from the component source in this repo.

```bash
cd anycode-agent/example
npm install
npm run dev        # http://localhost:3003
```

The `vite.config.js` alias maps `anycode-agent` to `../src/index.ts`, so edits to the component show up on reload. Remove the alias to use the published package from npm instead.

## Demos

- **Transcript**: a static fixture showing every message role: user, thought, tool calls (read, edit with diff), tool results, and markdown with code. Sending a prompt appends a placeholder reply. Undo truncates the transcript.
- **Live session**: `mock-agent.js` streams a markdown reply word by word. It shows streaming, the prompt queue, cancel, undo, and "send now". Queue rules match the backend: cancel keeps queued prompts but does not start them, and "send now" moves an item to the front and resumes the queue.

The agent is fake. Nothing here talks to an ACP agent or a backend. To wire a real session, see the `anycode` app's `useAgents` hook.
