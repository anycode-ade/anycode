# ACP in Anycode

Anycode uses the Agent Client Protocol to connect the editor to external coding agents. The frontend sends the selected agent command and arguments to the backend, and the backend starts that process directly.

## Installation

Anycode runs the exact agent command configured in [`anycode/agents.ts`](../anycode/agents.ts). The only requirement is that the configured command is available on `PATH`.

Some agents ship ACP as a separate package or wrapper binary. Others expose ACP through a CLI flag. In practice that means you may need to install an ACP-specific module like `codex-acp` or `claude-code-acp` before Anycode can launch the agent.

### Codex

Install Codex globally:

```bash
npm install -g @zed-industries/codex-acp
```

### Gemini

Install Gemini:

```bash
npm install -g @google/gemini-cli
```

### Claude Code

Install the ACP wrapper or package provided by the vendor, then make sure `claude-code-acp` is available on `PATH`:

```bash
npm install -g  @agentclientprotocol/claude-agent-acp
```

### opencode

Enable ACP with the built-in subcommand:

```bash
npm i -g opencode-ai
```

Notes:

- Default agent presets live in [`anycode/agents.ts`](../anycode/agents.ts).
- If your provider offers a dedicated ACP package, install that package first and make sure its binary is available on `PATH`.
- If your provider only exposes ACP behind a flag, keep the base CLI installed and pass the configured args from `anycode/agents.ts`.
- Agent permission mode can be controlled with `ANYCODE_ACP_PERMISSION_MODE`:
  - `ask`
  - `full_access`

## How It Works

Anycode starts one ACP process per agent session.

The flow is:

1. The frontend sends the selected agent `command` and `args` to the backend.
2. The backend starts the agent process and waits for the ACP session to initialize.
3. The agent exchanges ACP messages with the backend over stdio.
4. Tool calls, permission requests, model selectors, reasoning selectors, and file links are streamed back to the frontend.
5. Session history is stored so sessions can be resumed later.

## Frontend API

The frontend agent types live in [`anycode/types.ts`](../anycode/types.ts), and the agent presets live in [`anycode/agents.ts`](../anycode/agents.ts).

Current request/response flow:

- `acp:start` -> start a new agent session
- `acp:prompt` -> send a prompt to an active session
- `acp:undo` -> revert to a checkpoint and resend a prompt
- `acp:cancel` -> cancel the current prompt
- `acp:stop` -> stop an active session
- `acp:sessions_list` -> list resumable sessions for a given command
- `acp:permission_response` -> answer a tool permission request
- `acp:set_model` -> change the active model for a session
- `acp:set_reasoning` -> change the reasoning level for a session
- `acp:set_permission_mode` -> switch between ask and full-access permission mode

## Configuration

Important details:

- Each agent preset has a `command` and `args` array.
- The backend starts the command exactly as provided by the frontend.
- Session resume uses the same command/args pair that created the session.
- If the command is missing from `PATH`, the agent will fail to start.

## Where To Look In Code

- [`anycode/agents.ts`](../anycode/agents.ts)
- [`anycode/hooks/useAgents.ts`](../anycode/hooks/useAgents.ts)
- [`anycode-backend/src/acp.rs`](../anycode-backend/src/acp.rs)
- [`anycode-backend/src/handlers/acp_handler.rs`](../anycode-backend/src/handlers/acp_handler.rs)

## Adding A New Agent

1. Add an agent preset to [`anycode/agents.ts`](../anycode/agents.ts).
2. Make sure the command is installed and available on `PATH`.
3. Restart Anycode or reload the agent list in the UI.
4. Start a new session with the new agent.

## Troubleshooting

- If the agent does not start, verify the command works directly in a terminal.
- If a session cannot be resumed, check that you are using the same command and arguments as the original session.
- If permission prompts do not appear, check the active permission mode.
- If the agent cannot read or write files, verify the backend has access to the project directory.
