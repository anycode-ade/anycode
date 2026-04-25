import { useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditor, AnycodeEditorReact } from 'anycode-react';
import type { ReferencesPeekItem, ReferencesPeekState } from '../../types';
import { getFileName, getLanguageFromFileName } from '../../utils';
import './ReferencesPeek.css';

type ReferenceGroup = {
    filePath: string;
    indexes: number[];
};

type ReferencesPeekProps = {
    state: ReferencesPeekState;
    onClose: () => void;
    onSelectItem: (index: number) => void;
    onOpenItem: (index?: number) => void;
};

const resolveItemPath = (item: ReferencesPeekItem): string => {
    const source = item.uri || item.file || '';
    if (!source.startsWith('file://')) {
        return source;
    }
    const rawPath = source.slice('file://'.length);
    try {
        return decodeURIComponent(rawPath);
    } catch {
        return rawPath;
    }
};

let referencesPeekEditorCounter = 0;

const getHighlightRange = (preview: ReferencesPeekState['preview']) => {
    if (!preview) {
        return null;
    }

    const startLine = Math.max(0, preview.focusLine - preview.lineStart);
    const startColumn = Math.max(0, preview.focusColumn);
    let endLine = Math.max(0, preview.focusEndLine - preview.lineStart);
    let endColumn = Math.max(0, preview.focusEndColumn);

    if (endLine < startLine || (endLine === startLine && endColumn <= startColumn)) {
        endLine = startLine;
        endColumn = startColumn + 1;
    }

    return { startLine, startColumn, endLine, endColumn };
};

export const ReferencesPeek = ({
    state,
    onClose,
    onSelectItem,
    onOpenItem,
}: ReferencesPeekProps) => {
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
    const [previewEditor, setPreviewEditor] = useState<AnycodeEditor | null>(null);
    const previewEditorRef = useRef<AnycodeEditor | null>(null);
    const previewEditorIdRef = useRef<string | null>(null);
    const previewEditorMetaRef = useRef<{ fileName: string; language: string } | null>(null);

    if (!previewEditorIdRef.current) {
        referencesPeekEditorCounter += 1;
        previewEditorIdRef.current = `references-peek-editor-${referencesPeekEditorCounter}`;
    }

    const grouped = useMemo<ReferenceGroup[]>(() => {
        const groups = new Map<string, number[]>();

        state.items.forEach((item, index) => {
            const path = resolveItemPath(item);
            const bucket = groups.get(path);
            if (bucket) {
                bucket.push(index);
            } else {
                groups.set(path, [index]);
            }
        });

        return Array.from(groups.entries()).map(([filePath, indexes]) => ({ filePath, indexes }));
    }, [state.items]);

    useEffect(() => {
        const selected = itemRefs.current.get(state.selectedIndex);
        if (!selected) return;

        selected.focus({ preventScroll: true });
        selected.scrollIntoView({ block: 'nearest' });
    }, [state.selectedIndex, state.items.length]);

    useEffect(() => {
        previewEditorRef.current = previewEditor;
    }, [previewEditor]);

    useEffect(() => {
        if (!state.preview) {
            setPreviewEditor((prev) => {
                prev?.clean();
                return null;
            });
            previewEditorRef.current = null;
            previewEditorMetaRef.current = null;
            return;
        }

        let cancelled = false;
        let adopted = false;
        let nextEditor: AnycodeEditor | null = null;
        const previewText = state.preview.lines.join('\n');
        const fileName = getFileName(state.preview.filePath);
        const language = getLanguageFromFileName(fileName);
        const range = getHighlightRange(state.preview);
        if (!range) {
            return;
        }
        const currentEditor = previewEditorRef.current;
        const currentMeta = previewEditorMetaRef.current;

        if (currentEditor && currentMeta && currentMeta.fileName === fileName && currentMeta.language === language) {
            currentEditor.updateTextIncremental(previewText);
            currentEditor.setSelectionRange(
                range.startLine,
                range.startColumn,
                range.endLine,
                range.endColumn,
                true,
            );
            return;
        }

        const init = async () => {
            try {
                nextEditor = new AnycodeEditor(previewText, fileName, language, {
                    readOnly: true,
                    line: range.startLine,
                    column: range.startColumn,
                });
                await nextEditor.init();

                if (cancelled) {
                    nextEditor.clean();
                    return;
                }

                setPreviewEditor((prev) => {
                    prev?.clean();
                    return nextEditor;
                });
                previewEditorRef.current = nextEditor;
                previewEditorMetaRef.current = { fileName, language };
                adopted = true;

                requestAnimationFrame(() => {
                    if (previewEditorRef.current !== nextEditor) return;
                    nextEditor.setSelectionRange(
                        range.startLine,
                        range.startColumn,
                        range.endLine,
                        range.endColumn,
                        true,
                    );
                });
            } catch {
                if (nextEditor) {
                    nextEditor.clean();
                }
                if (!cancelled) {
                    setPreviewEditor((prev) => {
                        prev?.clean();
                        return null;
                    });
                    previewEditorRef.current = null;
                }
            }
        };

        void init();

        return () => {
            cancelled = true;
            if (nextEditor && !adopted) {
                nextEditor.clean();
            }
        };
    }, [state.preview]);

    useEffect(() => {
        return () => {
            previewEditorRef.current?.clean();
            previewEditorRef.current = null;
            previewEditorMetaRef.current = null;
        };
    }, []);

    return (
        <div className="references-peek" onMouseDown={(event) => event.stopPropagation()}>
            <div className="references-peek-header">
                <div className="references-peek-header-main">
                    <div className="references-peek-title">
                        References ({state.items.length})
                    </div>
                    {state.preview ? (
                        <div className="references-peek-header-path" title={state.preview.filePath}>
                            {state.preview.filePath}
                        </div>
                    ) : null}
                </div>
                <button
                    className="references-peek-close"
                    type="button"
                    onClick={onClose}
                    aria-label="Close references peek"
                >
                    ×
                </button>
            </div>
            <div className="references-peek-body">
                <div className="references-peek-preview">
                    {state.loading ? (
                        <div className="references-peek-empty">Loading references...</div>
                    ) : state.error ? (
                        <div className="references-peek-empty">{state.error}</div>
                    ) : state.items.length === 0 ? (
                        <div className="references-peek-empty">No references found</div>
                    ) : state.preview ? (
                        <div className="references-peek-preview-code">
                            <div className="references-peek-preview-editor">
                                {previewEditor ? (
                                    <AnycodeEditorReact
                                        id={previewEditorIdRef.current!}
                                        editorState={previewEditor}
                                    />
                                ) : (
                                    <div className="references-peek-empty">Loading preview...</div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="references-peek-empty">Preview unavailable</div>
                    )}
                </div>
                <div className="references-peek-list">
                    {grouped.map((group) => (
                        <div key={group.filePath} className="references-peek-group">
                            <div className="references-peek-group-title">
                                {getFileName(group.filePath)} <span>{group.indexes.length}</span>
                            </div>
                            {group.indexes.map((index) => {
                                const item = state.items[index];
                                const isSelected = state.selectedIndex === index;
                                const line = item.range.start.line + 1;
                                const column = item.range.start.character + 1;
                                return (
                                    <button
                                        key={`${group.filePath}:${line}:${column}:${index}`}
                                        className={`references-peek-item ${isSelected ? 'is-selected' : ''}`}
                                        type="button"
                                        ref={(el) => {
                                            if (el) {
                                                itemRefs.current.set(index, el);
                                            } else {
                                                itemRefs.current.delete(index);
                                            }
                                        }}
                                        onClick={() => onSelectItem(index)}
                                        onDoubleClick={() => onOpenItem(index)}
                                    >
                                        <span className="references-peek-item-location">
                                            {line}:{column}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
