import { AnycodeEditor, Code, MultiBufferCode } from 'anycode-editor';
import { createMockLsp } from './mock-lsp.js';

const SIMPLE_CODE = `// Hello from Anycode Editor!
function greet(name) {
    return \`Hello, \${name}!\`;
}

console.log(greet('World'));
`;

const IGNORE_EDITS_CODE = `// ignoreEdits: the cursor and selection work, but typing does not change the text.
export function add(a: number, b: number): number {
    return a + b;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
`;

const DIFF_BEFORE = `function total(items) {
    let sum = 0;
    for (const item of items) {
        sum += item.price;
    }
    return sum;
}

function label(n) {
    return "Total: " + n;
}
`;

const DIFF_AFTER = `function total(items) {
    return items.reduce((sum, item) => sum + item.price, 0);
}

function label(n) {
    return \`Total: \${n}\`;
}

export { total, label };
`;

const DIFF_MODES = [
    ['plain', 'Plain'],
    ['combine', 'Combined'],
    ['diff', 'Focused diff'],
];

const FILES = [
    {
        id: 'api',
        path: 'src/api.ts',
        before: `export async function fetchUser(id: string) {
    const res = await fetch('/users/' + id);
    return res.json();
}
`,
        after: `export async function fetchUser(id: string) {
    const res = await fetch(\`/users/\${encodeURIComponent(id)}\`);
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    return res.json();
}
`,
    },
    {
        id: 'format',
        path: 'src/format.ts',
        before: `export function price(cents: number) {
    return '$' + cents / 100;
}
`,
        after: `export function price(cents: number) {
    return '$' + (cents / 100).toFixed(2);
}

export function percent(value: number) {
    return \`\${(value * 100).toFixed(1)}%\`;
}
`,
    },
    {
        id: 'main',
        path: 'src/main.ts',
        before: `import { fetchUser } from './api';

fetchUser('42').then(console.log);
`,
        after: `import { fetchUser } from './api';
import { price } from './format';

fetchUser('42').then((user) => console.log(user.name, price(user.balance)));
`,
    },
    {
        id: 'cart',
        path: 'src/cart.ts',
        before: `export function cartTotal(items: { cents: number; qty: number }[]) {
    let sum = 0;
    for (const item of items) sum += item.cents * item.qty;
    return sum;
}
`,
        after: `export function cartTotal(items: { cents: number; qty: number }[]) {
    return items.reduce((sum, item) => sum + item.cents * item.qty, 0);
}

export function isEmpty(items: unknown[]) {
    return items.length === 0;
}
`,
    },
    {
        id: 'user',
        path: 'src/user.ts',
        before: `export interface User {
    id: string;
    name: string;
}
`,
        after: `export interface User {
    id: string;
    name: string;
    email: string;
    balance: number;
}
`,
    },
    {
        id: 'config',
        path: 'src/config.ts',
        before: `export const config = {
    apiUrl: 'http://localhost:8080',
    timeoutMs: 3000,
};
`,
        after: `export const config = {
    apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8080',
    timeoutMs: 5000,
    retries: 3,
    debug: false,
};
`,
    },
    {
        id: 'logger',
        path: 'src/logger.ts',
        before: `export function log(message: string) {
    console.log(message);
}
`,
        after: `import { config } from './config';

export function log(message: string) {
    if (config.debug) console.log('[debug]', message);
}

export function error(message: string) {
    console.error('[error]', message);
}
`,
    },
    {
        id: 'date',
        path: 'src/utils/date.ts',
        before: `export function formatDate(d: Date) {
    return d.toISOString().slice(0, 10);
}
`,
        after: `export function formatDate(d: Date, locale = 'en-US') {
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function daysBetween(a: Date, b: Date) {
    return Math.round(Math.abs(b.getTime() - a.getTime()) / 86_400_000);
}
`,
    },
    {
        id: 'strings',
        path: 'src/utils/strings.ts',
        before: `export function slugify(s: string) {
    return s.toLowerCase().replace(' ', '-');
}
`,
        after: `export function slugify(s: string) {
    return s.trim().toLowerCase().replace(/\s+/g, '-');
}

export function truncate(s: string, max = 80) {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
`,
    },
    {
        id: 'router',
        path: 'src/router.ts',
        before: `const routes: Record<string, () => void> = {};

export function on(path: string, handler: () => void) {
    routes[path] = handler;
}
`,
        after: `const routes = new Map<string, () => void>();

export function on(path: string, handler: () => void) {
    routes.set(path, handler);
}

export function navigate(path: string) {
    routes.get(path)?.();
}
`,
    },
    {
        id: 'store',
        path: 'src/store.ts',
        before: `let state: Record<string, unknown> = {};

export function set(key: string, value: unknown) {
    state[key] = value;
}
`,
        after: `type Listener = (value: unknown) => void;

const state = new Map<string, unknown>();
const listeners = new Map<string, Listener[]>();

export function set(key: string, value: unknown) {
    state.set(key, value);
    listeners.get(key)?.forEach((fn) => fn(value));
}

export function subscribe(key: string, fn: Listener) {
    listeners.set(key, [...(listeners.get(key) ?? []), fn]);
}
`,
    },
    {
        id: 'theme',
        path: 'src/theme.ts',
        before: `export const colors = {
    bg: '#222',
    fg: '#eee',
};
`,
        after: `export const colors = {
    bg: '#222',
    fg: '#eee',
    accent: '#2f6ea5',
    muted: '#888',
};

export function cssVars() {
    return Object.entries(colors).map(([k, v]) => \`--\${k}: \${v};\`).join('\\n');
}
`,
    },
    {
        id: 'validate',
        path: 'src/validate.ts',
        before: `export function isEmail(s: string) {
    return s.includes('@');
}
`,
        after: `export function isEmail(s: string) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

export function isUrl(s: string) {
    try {
        new URL(s);
        return true;
    } catch {
        return false;
    }
}
`,
    },
];

const LSP_CODE = `interface Product {
    id: string;
    name: string;
    cents: number;
}

const TAX_RATE = 0.2;

function withTax(cents: number): number {
    return Math.round(cents * (1 + TAX_RATE));
}

export function formatPrice(cents: number): string {
    return '$' + (withTax(cents) / 100).toFixed(2);
}

export function totalPrice(items: Product[]): string {
    const cents: any = items.map((item) => item.cents).reduce((a, b) => a + b, 0);
    var total = withTax(cents);
    return formatPrice(total);
}
`;

// Each demo gets a fresh pane and a toolbar helper, and returns its editor.
// The editor is attached and rendered by the demo itself.
const DEMOS = {
    async simple({ pane }) {
        const editor = new AnycodeEditor(SIMPLE_CODE, 'example.js', 'javascript');
        await editor.init();
        pane.append(editor.getContainer());
        editor.render();
        return editor;
    },

    async ignoreEdits({ pane }) {
        const editor = new AnycodeEditor(IGNORE_EDITS_CODE, 'math.ts', 'typescript', { ignoreEdits: true });
        await editor.init();
        pane.append(editor.getContainer());
        editor.render();
        return editor;
    },

    async diff({ pane, addButton }) {
        const editor = new AnycodeEditor(DIFF_AFTER, 'cart.js', 'javascript');
        await editor.init();
        editor.setOriginalText(DIFF_BEFORE);
        pane.append(editor.getContainer());
        editor.render();

        const buttons = DIFF_MODES.map(([mode, label]) => [
            mode,
            addButton(label, () => setMode(mode)),
        ]);
        function setMode(mode) {
            editor.setDiffMode(mode);
            for (const [m, button] of buttons) button.classList.toggle('active', m === mode);
        }
        setMode('combine');
        return editor;
    },

    async multibuffer({ pane }) {
        const entries = FILES.map((file) => ({
            id: file.id,
            path: file.path,
            code: new Code(file.after, file.path, 'typescript'),
            originalCode: new Code(file.before, file.path, 'typescript'),
        }));
        // The multibuffer does not initialize per-file buffers; do it here.
        await Promise.all(entries.flatMap((entry) => [entry.code.init(), entry.originalCode.init()]));

        const current = new MultiBufferCode(entries);
        const original = new MultiBufferCode(entries.map((entry) => ({ ...entry, code: entry.originalCode })));
        const editor = new AnycodeEditor('', 'review', '', {
            code: current,
            originalCode: original,
            focusedDiffEnabled: true,
        });
        await editor.init();
        pane.append(editor.getContainer());
        editor.render();
        editor.setDiffMode('diff');
        return editor;
    },

    async lsp({ pane }) {
        const editor = new AnycodeEditor(LSP_CODE, 'pricing.ts', 'typescript');
        const lsp = createMockLsp(() => editor.getCodeModel().getContent());
        await editor.init();

        const root = document.createElement('div');
        root.className = 'lsp';
        const editorBox = document.createElement('div');
        editorBox.className = 'lsp-editor';
        editorBox.append(editor.getContainer());
        const output = document.createElement('div');
        output.className = 'lsp-output';
        root.append(editorBox, output);
        pane.append(root);
        editor.render();

        // The editor shows hovers, completions, errors and references itself;
        // the demo decides what to do with definitions and references results.
        function showOutput(title, items = []) {
            output.replaceChildren();
            const heading = document.createElement('div');
            heading.className = 'lsp-title';
            heading.textContent = title;
            output.append(heading);
            for (const item of items) {
                const button = document.createElement('button');
                button.className = 'lsp-item';
                button.type = 'button';
                button.textContent = `${item.line + 1}:${item.column + 1}  ${item.text}`;
                button.addEventListener('click', () => editor.requestFocus(item.line, item.column, true));
                output.append(button);
            }
        }
        showOutput('F10 hover, F11 references, F12 or Ctrl/⌘-click definition, Alt-click references, Ctrl/⌘+Space completion.');

        editor.setCompletionProvider((request) => lsp.completion(request));
        editor.setHoverProvider((request) => lsp.hover(request));
        editor.setGoToDefinitionProvider(async (request) => {
            const definition = await lsp.definition(request);
            if (!definition) {
                showOutput('No definition found.');
                return;
            }
            editor.requestFocus(definition.range.start.line, definition.range.start.character, true);
            showOutput(`Definition: line ${definition.range.start.line + 1}.`);
        });
        editor.setReferencesPeekProvider(async (request) => {
            const references = await lsp.references(request);
            showOutput(`References: ${references.length}`, references.map((ref) => ({
                line: ref.range.start.line,
                column: ref.range.start.character,
                text: editor.getCodeModel().line(ref.range.start.line).trim(),
            })));
        });

        const refreshDiagnostics = () => editor.setErrors(lsp.diagnostics());
        refreshDiagnostics();
        editor.setOnChange(refreshDiagnostics);
        return editor;
    },
};

const host = document.getElementById('host');
const toolbar = document.getElementById('toolbar');
const tabs = [...document.querySelectorAll('#tabs [data-demo]')];

let activeEditor = null;
let runId = 0;

function addButton(label, onClick) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    toolbar.append(button);
    return button;
}

async function show(name) {
    const run = ++runId;

    activeEditor?.clean();
    activeEditor = null;
    host.replaceChildren();
    toolbar.replaceChildren();
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.demo === name);

    // The pane lives in the page right away, so a slower stale run cannot leak
    // into the current one: it only touches its own pane.
    const pane = document.createElement('div');
    pane.id = 'editor';
    host.append(pane);

    const editor = await DEMOS[name]({
        pane,
        addButton: (label, onClick) => (run === runId ? addButton(label, onClick) : null),
    });
    if (run !== runId) {
        editor.clean();
        return;
    }
    activeEditor = editor;
}

for (const tab of tabs) {
    tab.addEventListener('click', () => show(tab.dataset.demo));
}

show('simple');
