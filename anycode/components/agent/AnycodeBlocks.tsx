import React, { useEffect, useRef, useState } from 'react';
import { AnycodeEditor, AnycodeEditorReact } from 'anycode-editor-react';
import {
  type CodeBlockProps,
  type DiffBlockProps,
  CodeCopyButton,
} from 'anycode-agent';
import { EDITOR_SUPPORTED_LANGUAGES, getLanguageFromFileName } from '../../utils';
import { MermaidBlock } from '../../features/markdown/MermaidBlock';

let codeBlockIdCounter = 0;

export const AnycodeCodeBlock: React.FC<CodeBlockProps> = ({ code, language, isOpen = false }) => {
  if (language === 'mermaid' || language === 'mmd') {
    return <MermaidBlock code={code} isStreaming={isOpen} />;
  }

  const [editor, setEditor] = useState<AnycodeEditor | null>(null);
  const blockIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const useEditor = EDITOR_SUPPORTED_LANGUAGES.has(language);

  if (!blockIdRef.current) {
    codeBlockIdCounter += 1;
    blockIdRef.current = `acp-code-block-${codeBlockIdCounter}`;
  }

  useEffect(() => {
    if (editor) {
      editor.updateTextIncremental(code);
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [code, editor]);

  useEffect(() => {
    if (!useEditor) {
      setEditor(null);
      return;
    }

    let cancelled = false;
    let ed: AnycodeEditor | null = null;

    const init = async () => {
      try {
        ed = new AnycodeEditor(code, blockIdRef.current!, language, {
          readOnly: true,
          codeFoldingEnabled: false,
          wordHighlightEnabled: false,
          scrollbarMarkersEnabled: false,
          buffer: 1000,
        });
        await ed.init();
        ed.setLineHeight(18);

        if (cancelled) {
          ed.clean();
          return;
        }

        setEditor(ed);
      } catch (error) {
        console.warn(`Failed to render code block with AnycodeEditor for language "${language}"`, error);
        if (ed) {
          ed.clean();
        }
        setEditor(null);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (ed) {
        ed.clean();
      }
      setEditor(null);
    };
  }, [language, useEditor]);

  const codeToolbar = (
    <div className="acp-code-toolbar">
      <CodeCopyButton content={code} />
    </div>
  );

  if (!useEditor) {
    return (
      <div className="acp-code">
        {codeToolbar}
        <div ref={containerRef} className="acp-code-content">
          <pre className="acp-code-block-fallback">{code}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`acp-code ${isOpen ? 'acp-code-streaming' : ''}`}>
      {codeToolbar}
      <div ref={containerRef} className="acp-code-content">
        {editor ? (
          <AnycodeEditorReact id={blockIdRef.current!} editorState={editor} />
        ) : (
          <pre className="acp-code-block-fallback">{code}</pre>
        )}
      </div>
    </div>
  );
};

export const AnycodeDiffBlock: React.FC<DiffBlockProps> = ({ diff }) => {
  const [editor, setEditor] = useState<AnycodeEditor | null>(null);
  const blockIdRef = useRef<string | null>(null);
  const language = getLanguageFromFileName(diff.path);
  const useEditor = EDITOR_SUPPORTED_LANGUAGES.has(language);

  if (!blockIdRef.current) {
    codeBlockIdCounter += 1;
    blockIdRef.current = `acp-diff-block-${codeBlockIdCounter}`;
  }

  useEffect(() => {
    if (!useEditor) {
      setEditor(null);
      return;
    }

    let cancelled = false;
    let nextEditor: AnycodeEditor | null = null;

    const init = async () => {
      try {
        nextEditor = new AnycodeEditor(diff.newText, blockIdRef.current!, language, {
          readOnly: true,
          focusedDiffEnabled: true,
          focusedDiffContextLines: 3,
          codeFoldingEnabled: false,
          wordHighlightEnabled: false,
          scrollbarMarkersEnabled: false,
          buffer: 1000,
        });
        await nextEditor.init();
        nextEditor.setLineHeight(18);
        nextEditor.setOriginalCode(diff.oldText ?? '');
        nextEditor.setDiffEnabled(true);

        if (cancelled) {
          nextEditor.clean();
          return;
        }

        setEditor(nextEditor);
      } catch (error) {
        console.warn(`Failed to render diff block with AnycodeEditor for language "${language}"`, error);
        if (nextEditor) {
          nextEditor.clean();
        }
        setEditor(null);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (nextEditor) {
        nextEditor.clean();
      }
      setEditor(null);
    };
  // Text updates are applied by the effect below; recreating the editor on
  // every streamed change would flash the fallback <pre> each time.
  }, [language, useEditor]);

  useEffect(() => {
    if (!editor) return;
    editor.updateTextIncremental(diff.newText);
    editor.setOriginalCode(diff.oldText ?? '');
    editor.setDiffEnabled(true);
    editor.setLineHeight(18);
  }, [diff.newText, diff.oldText, editor]);

  const codeToolbar = (
    <div className="acp-code-toolbar">
      <CodeCopyButton content={diff.newText} />
    </div>
  );

  if (!useEditor) {
    return (
      <div className="acp-code acp-diff-code">
        {codeToolbar}
        <div className="acp-code-content">
          <pre className="acp-tool-result-content">
            {`--- before\n${diff.oldText ?? ''}\n+++ after\n${diff.newText}`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="acp-code acp-diff-code">
      {codeToolbar}
      <div className="acp-code-content">
        {editor ? (
          <AnycodeEditorReact id={blockIdRef.current!} editorState={editor} />
        ) : (
          <pre className="acp-code-block-fallback">{diff.newText}</pre>
        )}
      </div>
    </div>
  );
};
