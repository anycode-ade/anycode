import { Code } from "../code";
import { EditorState } from "../editor";

const MAX_WORD_MARKER_LINES = 5000;

export class WordHighlightRenderer {
    private codeContent: HTMLDivElement;
    private cachedCode: Code | null = null;
    private cachedText = '';
    private cachedToken = '';
    private cachedLines: number[] = [];

    constructor(codeContent: HTMLDivElement) {
        this.codeContent = codeContent;
    }

    public render(state: EditorState, collectMarkerLines: boolean = true): number[] {
        this.codeContent.querySelectorAll('span.wh')
            .forEach((element) => element.classList.remove('wh'));

        const wh = state.wordHighlight;
        if (!state.wordHighlightEnabled || !wh?.text || !wh.token) {
            this.invalidateMarkerLines();
            return [];
        }

        this.codeContent
            .querySelectorAll(`span[class~="${wh.token}"]`)
            .forEach((element) => {
                if (element.textContent === wh.text) element.classList.add('wh');
            });

        if (!collectMarkerLines || state.code.linesLength() > MAX_WORD_MARKER_LINES) return [];

        if (
            this.cachedCode === state.code
            && this.cachedText === wh.text
            && this.cachedToken === wh.token
        ) {
            return this.cachedLines;
        }

        const lines: number[] = [];
        for (let line = 0; line < state.code.linesLength(); line++) {
            if (!state.code.line(line).includes(wh.text)) continue;

            const hasMatch = state.code.getLineNodes(line).some((node) => {
                if (node.text !== wh.text || !node.name) return false;
                return node.name === wh.token || node.name.split('.').includes(wh.token!);
            });
            if (hasMatch) lines.push(line);
        }

        this.cachedCode = state.code;
        this.cachedText = wh.text;
        this.cachedToken = wh.token;
        this.cachedLines = lines;
        return lines;
    }

    public invalidateMarkerLines() {
        this.cachedCode = null;
        this.cachedText = '';
        this.cachedToken = '';
        this.cachedLines = [];
    }
}
