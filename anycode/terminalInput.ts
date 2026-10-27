// Escape sequences (arrow keys, function keys, bracketed paste markers) are not text. Returns the index after
// the sequence that starts at `start`.
const skipEscapeSequence = (data: string, start: number): number => {
    const kind = data[start + 1];
    if (kind === '[') {
        // CSI: parameter and intermediate bytes (0x20-0x3F), then one final byte.
        let end = start + 2;
        while (end < data.length && data[end] >= ' ' && data[end] <= '?') end += 1;
        return Math.min(end + 1, data.length);
    }
    // SS3 (ESC O x) carries one final byte; other ESC x pairs are Alt+key.
    return Math.min(start + (kind === 'O' ? 3 : 2), data.length);
};

/**
 * Rebuilds the line being typed at a terminal from its raw input stream and returns the commands submitted
 * with Enter. Only keystrokes are visible here: history recall, Tab completion and edits made inside the
 * shell are not reflected.
 */
export const applyTerminalInput = (line: string, data: string): { line: string; commands: string[] } => {
    const commands: string[] = [];
    let current = line;
    let i = 0;
    while (i < data.length) {
        const char = data[i];
        if (char === '\x1b') {
            i = skipEscapeSequence(data, i);
            continue;
        }
        if (char === '\r' || char === '\n') {
            const command = current.trim();
            if (command) commands.push(command);
            current = '';
        } else if (char === '\x7f' || char === '\b') {
            current = [...current].slice(0, -1).join('');
        } else if (char === '\x03' || char === '\x15') {
            // Ctrl+C and Ctrl+U discard the line being typed.
            current = '';
        } else if (char >= ' ') {
            current += char;
        }
        i += 1;
    }
    return { line: current, commands };
};
