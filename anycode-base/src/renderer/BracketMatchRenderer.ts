import { EditorState } from "../editor";
import { AnycodeLine } from "../types";
import { getElementAtPosition } from "../utils";

export class BracketMatchRenderer {
    private codeContent: HTMLDivElement;
    private getLine: (lineNumber: number) => AnycodeLine | null;

    constructor(
        codeContent: HTMLDivElement,
        getLine: (lineNumber: number) => AnycodeLine | null
    ) {
        this.codeContent = codeContent;
        this.getLine = getLine;
    }

    public render(state: EditorState) {
        const { code, cursor, selection } = state;
        const targets: Element[] = [];

        if (!selection || selection.isEmpty()) {
            const match = code.getMatchingBracket(cursor);
            if (match) {
                const openPosition = code.getPosition(match.openOffset);
                const closePosition = code.getPosition(match.closeOffset);
                const openLine = this.getLine(openPosition.line);
                const closeLine = this.getLine(closePosition.line);
                const openElement = openLine
                    ? getElementAtPosition(openLine, openPosition.column)
                    : null;
                const closeElement = closeLine
                    ? getElementAtPosition(closeLine, closePosition.column)
                    : null;

                if (openElement) targets.push(openElement);
                if (closeElement) targets.push(closeElement);
            }
        }

        const current = Array.from(this.codeContent.querySelectorAll('.bm'));
        for (const element of current) {
            if (!targets.includes(element)) element.classList.remove('bm');
        }
        for (const element of targets) {
            if (!element.classList.contains('bm')) element.classList.add('bm');
        }
    }

    public clear() {
        this.codeContent.querySelectorAll('.bm')
            .forEach((element) => element.classList.remove('bm'));
    }
}
