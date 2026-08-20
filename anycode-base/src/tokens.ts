import type { HighlighedNode } from "./code";

/**
 * Global token dictionary that maps token names to numeric IDs (Uint16).
 * Also precomputes and caches the exact CSS class string to avoid all runtime splits,
 * sets, and joins during DOM rendering.
 */
export class TokenDictionary {
    private static nameToId = new Map<string, number>();
    private static idToName: (string | null)[] = [null];
    private static idToClassString: string[] = [''];

    public static getId(name: string | null): number {
        if (!name) return 0;
        let id = this.nameToId.get(name);
        if (id === undefined) {
            id = this.idToName.length;
            this.nameToId.set(name, id);
            this.idToName.push(name);

            // Precompute pre-joined CSS class string (e.g. "function.method function method")
            const parts = name.split('.').filter(Boolean);
            const deduplicated = Array.from(new Set([name, ...parts]));
            this.idToClassString.push(deduplicated.join(' '));
        }
        return id;
    }

    public static getName(id: number): string | null {
        return this.idToName[id] ?? null;
    }

    public static getClassString(id: number): string {
        return this.idToClassString[id] ?? '';
    }
}

/**
 * Binary token layout (8 bytes per token in a Uint32Array):
 * - data[i * 2 + 0]: (tokenId << 16) | flags
 * - data[i * 2 + 1]: (startColumn << 16) | length
 */
export class BinaryTokens {
    /**
     * Creates a Uint32Array representation from HighlighedNode[]
     */
    public static encode(nodes: HighlighedNode[]): Uint32Array {
        const count = nodes.length;
        const data = new Uint32Array(count * 2);

        let column = 0;
        for (let i = 0; i < count; i++) {
            const node = nodes[i];
            const tokenId = TokenDictionary.getId(node.name);
            const textLen = node.text.length;

            data[i * 2] = ((tokenId & 0xffff) << 16);
            data[i * 2 + 1] = ((column & 0xffff) << 16) | (textLen & 0xffff);

            column += textLen;
        }

        return data;
    }

    /**
     * Decodes Uint32Array back to HighlighedNode[] for backward compatibility / tests
     */
    public static decode(data: Uint32Array, lineText: string): HighlighedNode[] {
        const count = (data.length / 2) | 0;
        if (count === 0) {
            return [{ name: null, text: lineText || "\u200B" }];
        }

        const nodes: HighlighedNode[] = new Array(count);
        for (let i = 0; i < count; i++) {
            const word0 = data[i * 2];
            const word1 = data[i * 2 + 1];

            const tokenId = (word0 >>> 16) & 0xffff;
            const startColumn = (word1 >>> 16) & 0xffff;
            const textLen = word1 & 0xffff;

            const name = TokenDictionary.getName(tokenId);
            const text = lineText.substring(startColumn, startColumn + textLen);

            nodes[i] = { name, text };
        }

        return nodes;
    }

    /**
     * Fast 32-bit hash calculated directly over binary tokens and lineText
     */
    public static fastHash(data: Uint32Array, lineText: string): number {
        let hash = lineText.length;
        for (let i = 0; i < data.length; i++) {
            hash = ((hash << 5) - hash + data[i]) | 0;
        }
        for (let i = 0; i < lineText.length; i++) {
            hash = ((hash << 5) - hash + lineText.charCodeAt(i)) | 0;
        }
        return hash | 0;
    }
}
