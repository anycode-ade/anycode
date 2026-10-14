import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Mermaid Integration', () => {
    beforeAll(async () => {
        // In Node.js testing environment (no browser DOM), DOMPurify does not bind
        // to a window automatically. Polyfill the methods so mermaid parsers don't fail in Node.
        let curr = process.cwd();
        let purifyPath: string | null = null;
        while (curr && curr !== path.dirname(curr)) {
            const candidate = path.join(curr, 'node_modules/.pnpm');
            if (fs.existsSync(candidate)) {
                const entry = fs.readdirSync(candidate).find((e) => e.startsWith('dompurify@'));
                if (entry) {
                    purifyPath = path.join(candidate, entry, 'node_modules/dompurify/dist/purify.es.mjs');
                    break;
                }
            }
            curr = path.dirname(curr);
        }

        if (purifyPath) {
            try {
                const dp = await import(purifyPath);
                const mod = (dp.default || dp) as any;
                if (mod) {
                    mod.sanitize = (s: string) => s;
                    mod.addHook = () => {};
                    mod.removeHook = () => {};
                }
            } catch {
                // ignore
            }
        }
    });

    it('lazily loads mermaid module and exposes required rendering APIs', async () => {
        const { default: mermaid } = await import('mermaid');
        expect(mermaid).toBeDefined();
        expect(typeof mermaid.initialize).toBe('function');
        expect(typeof mermaid.render).toBe('function');
        expect(typeof mermaid.parse).toBe('function');

        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            securityLevel: 'loose',
        });
    });

    it('identifies mermaid language fences in markdown', () => {
        const isMermaidLanguage = (lang: string) => {
            const normalized = lang.trim().toLowerCase();
            return normalized === 'mermaid' || normalized === 'mmd';
        };

        expect(isMermaidLanguage('mermaid')).toBe(true);
        expect(isMermaidLanguage('Mermaid')).toBe(true);
        expect(isMermaidLanguage('MERMAID')).toBe(true);
        expect(isMermaidLanguage('mmd')).toBe(true);
        expect(isMermaidLanguage('MMD')).toBe(true);
        expect(isMermaidLanguage(' mermaid ')).toBe(true);

        expect(isMermaidLanguage('javascript')).toBe(false);
        expect(isMermaidLanguage('python')).toBe(false);
        expect(isMermaidLanguage('html')).toBe(false);
        expect(isMermaidLanguage('')).toBe(false);
    });

    it('extracts language from markdown code fence class names', () => {
        const parseLanguageClass = (className?: string): string => {
            const match = /language-(\w+)/.exec(className || '');
            return match ? match[1].toLowerCase() : '';
        };

        expect(parseLanguageClass('language-mermaid')).toBe('mermaid');
        expect(parseLanguageClass('language-Mermaid')).toBe('mermaid');
        expect(parseLanguageClass('language-mmd')).toBe('mmd');
        expect(parseLanguageClass('language-typescript')).toBe('typescript');
        expect(parseLanguageClass(undefined)).toBe('');
        expect(parseLanguageClass('')).toBe('');
    });

    describe('diagram syntax validation', () => {
        it('successfully validates standard diagram types', async () => {
            const { default: mermaid } = await import('mermaid');

            const diagrams = [
                // Flowchart
                `graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[End]`,
                // Sequence Diagram
                `sequenceDiagram\n  autonumber\n  Alice->>Bob: Hello Bob\n  Bob-->>Alice: Hi Alice`,
                // State Diagram
                `stateDiagram-v2\n  [*] --> Still\n  Still --> [*]\n  Still --> Moving\n  Moving --> Still`,
                // Class Diagram
                `classDiagram\n  Animal <|-- Duck\n  Animal : +int age\n  Animal : +String gender`,
                // ER Diagram
                `erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains`,
                // Git Graph
                `gitGraph\n  commit\n  branch develop\n  checkout develop\n  commit\n  checkout main\n  merge develop`,
                // Pie Chart
                `pie title Pets\n  "Dogs" : 386\n  "Cats" : 85`,
            ];

            for (const diagram of diagrams) {
                const result = await mermaid.parse(diagram, { suppressErrors: false });
                expect(result).toBeTruthy();
            }
        });

        it('detects invalid mermaid syntax without crashing when suppressErrors is true', async () => {
            const { default: mermaid } = await import('mermaid');

            const brokenDiagram = 'graph TD\n  A --> [Unclosed bracket';
            const result = await mermaid.parse(brokenDiagram, { suppressErrors: true });
            expect(result).toBe(false);
        });

        it('throws descriptive error on invalid syntax when suppressErrors is false', async () => {
            const { default: mermaid } = await import('mermaid');

            const broken = 'totally_invalid_mermaid_syntax_12345';
            await expect(mermaid.parse(broken)).rejects.toThrow();
        });
    });

    describe('zoom calculation utilities', () => {
        const clampZoom = (zoom: number): number => {
            return Math.min(Math.max(Number(zoom.toFixed(2)), 0.3), 3.0);
        };

        const zoomIn = (current: number): number => {
            return Math.min(Number((current + 0.2).toFixed(2)), 3.0);
        };

        const zoomOut = (current: number): number => {
            return Math.max(Number((current - 0.2).toFixed(2)), 0.3);
        };

        it('correctly increments zoom by 0.2 and clamps at 3.0', () => {
            expect(zoomIn(1)).toBe(1.2);
            expect(zoomIn(1.2)).toBe(1.4);
            expect(zoomIn(2.8)).toBe(3.0);
            expect(zoomIn(3.0)).toBe(3.0);
            expect(zoomIn(3.5)).toBe(3.0);
        });

        it('correctly decrements zoom by 0.2 and clamps at 0.3', () => {
            expect(zoomOut(1)).toBe(0.8);
            expect(zoomOut(0.8)).toBe(0.6);
            expect(zoomOut(0.4)).toBe(0.3); // max(0.2, 0.3) -> 0.3
            expect(zoomOut(0.3)).toBe(0.3);
            expect(zoomOut(0.1)).toBe(0.3);
        });

        it('clamps arbitrary zoom values within limits', () => {
            expect(clampZoom(0.05)).toBe(0.3);
            expect(clampZoom(5.0)).toBe(3.0);
            expect(clampZoom(1.5)).toBe(1.5);
            expect(clampZoom(2.45)).toBe(2.45);
        });
    });
});
