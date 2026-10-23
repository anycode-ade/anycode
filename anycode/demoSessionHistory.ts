// Stored history of the demo session. The demo socket replays it when that session is resumed,
// like the backend does for a real one, so the UI starts from a populated conversation.
import type { AcpMessage } from './types';

export const DEMO_RESUME_SESSION_ID = 'session-demo-1';
export const DEMO_RESUME_TURN_COUNT = 30;
// Turns whose prompt and answer contain DEMO_RESUME_QUERY. Used by the search test.
export const DEMO_RESUME_QUERY = 'needle';
export const DEMO_RESUME_MARKED_TURNS = [2, 24];

const isMarkedTurn = (turn: number) => DEMO_RESUME_MARKED_TURNS.includes(turn);

export const demoResumeUserPrompt = (turn: number): string => (
    isMarkedTurn(turn)
        ? `Turn ${turn}: where is the ${DEMO_RESUME_QUERY} in this file?`
        : `Turn ${turn}: how does the editor render this file?`
);

const demoResumeAnswer = (turn: number): string => {
    const marker = isMarkedTurn(turn)
        ? ` The ${DEMO_RESUME_QUERY} is near the top of the file, right after the imports.`
        : '';
    return [
        `## Answer ${turn}`,
        `The editor keeps only the visible rows in the DOM, so long files stay cheap to scroll.${marker}`,
        'Scrolling re-renders the visible region from the Tree-Sitter parse, and the rest of the document is left unmounted.',
        '- Rows outside the viewport are skipped.\n- Highlights are painted from the document model.',
    ].join('\n\n');
};

// Each turn runs one completed read_file tool call before the answer, like a real agent turn.
const demoResumeToolCall = (turn: number): AcpMessage[] => {
    const id = `tool-resume-${turn}`;
    const command = 'read_file README.md';
    return [
        {
            role: 'tool_call',
            id,
            name: 'read_file',
            command,
            title: 'Reading README.md for context',
            status: 'completed',
            arguments: { prompt: demoResumeUserPrompt(turn) },
        },
        {
            role: 'tool_result',
            id,
            result: {
                command,
                output: 'Read 182 bytes from README.md',
                formatted_output: '# Anycode Web IDE\nNext-generation IDE with Rust backend & React frontend.',
            },
        },
    ];
};

export function buildDemoResumeHistory(): AcpMessage[] {
    const history: AcpMessage[] = [];
    for (let turn = 1; turn <= DEMO_RESUME_TURN_COUNT; turn++) {
        history.push({ role: 'user', content: demoResumeUserPrompt(turn) });
        history.push(...demoResumeToolCall(turn));
        history.push({ role: 'assistant', content: demoResumeAnswer(turn) });
    }
    return history;
}
