// Code and diff blocks rendered by the anycode editor. Demo only: this mirrors
// anycode/components/agent/AnycodeBlocks.tsx without the app's mermaid renderer.
import { useEffect, useRef, useState } from 'react';
import { AnycodeEditor, AnycodeEditorReact, setWasmBasePath } from 'anycode-editor-react';
import {
  CodeCopyButton,
  DefaultCodeBlock,
  DefaultDiffBlock,
  LANGUAGE_EXTENSIONS,
  getLanguageFromFileName,
} from 'anycode-agent';

// Tree-sitter grammars load from public/wasm, a symlink to anycode-editor/core/wasm.
setWasmBasePath('/wasm/');

// Same rule as the app: a language gets the editor only when it has a grammar.
const EDITOR_LANGUAGES = new Set(Object.values(LANGUAGE_EXTENSIONS));

const EDITOR_OPTIONS = {
  readOnly: true,
  codeFoldingEnabled: false,
  wordHighlightEnabled: false,
  scrollbarMarkersEnabled: false,
  buffer: 1000,
};

let blockSeq = 0;

// Creates a read-only editor for `language` and keeps it in sync with `text`.
// Passing `oldText` (even '') shows `text` as a focused diff against it.
// `editor` stays null until ready, so callers can show plain text meanwhile.
function useReadOnlyEditor(text, language, oldText) {
  const isDiff = oldText !== undefined;
  const [editor, setEditor] = useState(null);
  const idRef = useRef(null);
  if (!idRef.current) {
    blockSeq += 1;
    idRef.current = `editor-block-${blockSeq}`;
  }

  // Rebuilt only when the language or diff mode changes. Text changes go through the
  // effect below, so streaming does not flash the fallback by recreating the editor.
  useEffect(() => {
    let ed = null;
    let cancelled = false;

    const init = async () => {
      try {
        ed = new AnycodeEditor(text, idRef.current, language, {
          ...EDITOR_OPTIONS,
          focusedDiffEnabled: isDiff,
          focusedDiffContextLines: 3,
        });
        await ed.init();
        if (cancelled) return;
        ed.setLineHeight(18);
        setEditor(ed);
      } catch (error) {
        console.warn(`Failed to render block with AnycodeEditor for language "${language}"`, error);
        ed?.clean();
        ed = null;
      }
    };

    void init();
    return () => {
      cancelled = true;
      ed?.clean();
      setEditor(null);
    };
    // `text` and `oldText` are read once here; the effect below applies later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, isDiff]);

  useEffect(() => {
    if (!editor) return;
    editor.updateTextIncremental(text);
    if (isDiff) {
      editor.setOriginalCode(oldText ?? '');
      editor.setDiffEnabled(true);
    }
  }, [editor, text, oldText, isDiff]);

  return { editor, id: idRef.current };
}

export function EditorCodeBlock({ code, language, isOpen = false }) {
  if (!EDITOR_LANGUAGES.has(language)) {
    return <DefaultCodeBlock code={code} language={language} isOpen={isOpen} />;
  }
  return <EditorCode code={code} language={language} isOpen={isOpen} />;
}

function EditorCode({ code, language, isOpen }) {
  const { editor, id } = useReadOnlyEditor(code, language);
  const containerRef = useRef(null);

  // Keep the newest lines visible while a streamed block grows.
  useEffect(() => {
    if (!editor) return;
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    });
  }, [code, editor]);

  return (
    <div className={`acp-code ${isOpen ? 'acp-code-streaming' : ''}`}>
      <div className="acp-code-toolbar">
        <CodeCopyButton content={code} />
      </div>
      <div ref={containerRef} className="acp-code-content">
        {editor ? (
          <AnycodeEditorReact id={id} editorState={editor} />
        ) : (
          <pre className="acp-code-block-fallback">{code}</pre>
        )}
      </div>
    </div>
  );
}

export function EditorDiffBlock({ diff }) {
  const language = getLanguageFromFileName(diff.path);
  if (!EDITOR_LANGUAGES.has(language)) {
    return <DefaultDiffBlock diff={diff} />;
  }
  return <EditorDiff diff={diff} language={language} />;
}

function EditorDiff({ diff, language }) {
  const { editor, id } = useReadOnlyEditor(diff.newText, language, diff.oldText ?? '');

  return (
    <div className="acp-code acp-diff-code">
      <div className="acp-code-toolbar">
        <CodeCopyButton content={diff.newText} />
      </div>
      <div className="acp-code-content">
        {editor ? (
          <AnycodeEditorReact id={id} editorState={editor} />
        ) : (
          <pre className="acp-code-block-fallback">{diff.newText}</pre>
        )}
      </div>
    </div>
  );
}
