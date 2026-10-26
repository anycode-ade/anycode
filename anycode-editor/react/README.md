# anycode-editor-react

React wrapper component for `anycode-editor`.

Provides seamless React integration, lifecycle management, and event handling for the Tree-Sitter powered `AnycodeEditor`.

## Installation

```bash
pnpm add anycode-editor-react anycode-editor
# or
npm install anycode-editor-react anycode-editor
```

## Usage

```tsx
import React, { useEffect, useState } from 'react';
import { AnycodeEditor, AnycodeEditorReact, setWasmBasePath } from 'anycode-editor-react';

// Configure WASM path if needed (e.g. from public folder or CDN)
setWasmBasePath('/wasm/');

export function EditorView() {
  const [editor, setEditor] = useState<AnycodeEditor | null>(null);

  useEffect(() => {
    const ed = new AnycodeEditor(
      'console.log("Hello Anycode");',
      'editor-1',
      'javascript',
      { readOnly: false }
    );

    ed.init().then(() => {
      setEditor(ed);
    });

    return () => {
      ed.clean();
    };
  }, []);

  if (!editor) return <div>Loading editor...</div>;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <AnycodeEditorReact id="editor-1" editorState={editor} />
    </div>
  );
}
```

## License

Apache-2.0
