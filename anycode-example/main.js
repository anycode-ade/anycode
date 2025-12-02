import { AnycodeEditor } from 'anycode-base';

const code = `// Hello from Anycode Editor!
function greet(name) {
    return \`Hello, \${name}!\`;
}

console.log(greet('World'));
`;

async function init() {
    const editor = new AnycodeEditor(code, 'example.js', 'javascript');
    await editor.init();
    await editor.render();
    document.getElementById('editor')
        .appendChild(editor.getContainer());
}

init();

