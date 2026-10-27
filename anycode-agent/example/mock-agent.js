// A fake agent: streams a canned reply word by word.
// Returns the stream handle: `done` resolves to 'completed' or 'cancelled'.
export function streamReply(prompt, onText, { delayMs = 40 } = {}) {
    const parts = buildReply(prompt).split(/(?<=\s)/);
    let index = 0;
    let text = '';
    let timer = null;
    let finish;
    const done = new Promise((resolve) => {
        finish = resolve;
    });

    function step() {
        if (index >= parts.length) {
            timer = null;
            finish('completed');
            return;
        }
        text += parts[index++];
        onText(text);
        timer = setTimeout(step, delayMs);
    }

    timer = setTimeout(step, delayMs);
    return {
        done,
        cancel() {
            clearTimeout(timer);
            timer = null;
            finish('cancelled');
        },
    };
}

function buildReply(prompt) {
    return `You asked: "${prompt}"

This reply is **streamed** by a mock agent. Markdown, lists and code blocks render as they arrive:

- chunks come in one word at a time
- press **Cancel** to stop the reply
- prompts sent now wait in the queue

\`\`\`ts
export const TAX_RATE = 0.2;
\`\`\`
`;
}
