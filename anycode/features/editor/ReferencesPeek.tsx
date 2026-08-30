import { useEffect, useMemo, useRef, useState } from 'react';
import { AnycodeEditor, AnycodeEditorReact } from 'anycode-react';
import type { ReferencesPeekItem, ReferencesPeekState } from '../../types';
import { getFileName, getLanguageFromFileName, uriToFilePath } from '../../utils';
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
    return uriToFilePath(item.uri || item.file || '');
};

let referencesPeekEditorCounter = 0;

const getHighlightRange = (item: ReferencesPeekItem | undefined) => {
    if (!item) {
        return null;
    }

    const startLine = Math.max(0, item.range.start.line);
    const startColumn = Math.max(0, item.range.start.character);
    let endLine = Math.max(0, item.range.end.line);
    let endColumn = Math.max(0, item.range.end.character);

    if (endLine < startLine || (endLine === startLine && endColumn <= startColumn)) {
        endLine = startLine;
        endColumn = startColumn + 1;
    }

    return { startLine, startColumn, endLine, endColumn };
};

type HighlightRange = NonNullable<ReturnType<typeof getHighlightRange>>;

type CreatePreviewEditorParams = {
    previewText: string;
    fileName: string;
    language: string;
    range: HighlightRange;
    isCancelled: () => boolean;
    onReady: (editor: AnycodeEditor) => void;
    onError: () => void;
};

const createPreviewEditor = async ({
    previewText,
    fileName,
    language,
    range,
    isCancelled,
    onReady,
    onError,
}: CreatePreviewEditorParams): Promise<void> => {
    let editor: AnycodeEditor | null = null;

    try {
        editor = new AnycodeEditor(previewText, fileName, language, {
            readOnly: true,
            line: range.startLine,
            column: range.startColumn,
        });
        await editor.init();

        if (isCancelled()) {
            editor.clean();
            return;
        }

        onReady(editor);
    } catch {
        editor?.clean();
        if (!isCancelled()) {
            onError();
        }
    }
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

    const selectedItem = state.items[state.selectedIndex];

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
        if (state.preview === null) {
            setPreviewEditor((prev) => {
                prev?.clean();
                return null;
            });
            previewEditorRef.current = null;
            previewEditorMetaRef.current = null;
            return;
        }

        let cancelled = false;
        const previewText = state.preview;
        if (!selectedItem) {
            return;
        }

        const filePath = resolveItemPath(selectedItem);
        const fileName = getFileName(filePath);
        const language = getLanguageFromFileName(fileName);
        const range = getHighlightRange(selectedItem);
        if (!range) {
            return;
        }
        const currentEditor = previewEditorRef.current;
        const currentMeta = previewEditorMetaRef.current;

        if (currentEditor && currentMeta && currentMeta.fileName === fileName &&
            currentMeta.language === language) {
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

        void createPreviewEditor({
            previewText,
            fileName,
            language,
            range,
            isCancelled: () => cancelled,
            onReady: (editor) => {
                setPreviewEditor((prev) => {
                    prev?.clean();
                    return editor;
                });
                previewEditorRef.current = editor;
                previewEditorMetaRef.current = { fileName, language };

                requestAnimationFrame(() => {
                    if (previewEditorRef.current !== editor) return;
                    editor.setSelectionRange(
                        range.startLine,
                        range.startColumn,
                        range.endLine,
                        range.endColumn,
                        true,
                    );
                });
            },
            onError: () => {
                setPreviewEditor((prev) => {
                    prev?.clean();
                    return null;
                });
                previewEditorRef.current = null;
                previewEditorMetaRef.current = null;
            },
        });

        return () => {
            cancelled = true;
        };
    }, [state.preview, selectedItem]);

    useEffect(() => {
        return () => {
            previewEditorRef.current?.clean();
            previewEditorRef.current = null;
            previewEditorMetaRef.current = null;
        };
    }, []);

    const refocusPreviewSelection = () => {
        const editor = previewEditorRef.current;
        const range = getHighlightRange(selectedItem);
        if (!editor || !range) {
            return;
        }

        editor.setSelectionRange(
            range.startLine,
            range.startColumn,
            range.endLine,
            range.endColumn,
            true,
        );
    };

    return (
        <div className="references-peek" onMouseDown={(event) => event.stopPropagation()}>
            <div className="references-peek-header">
                <div className="references-peek-header-main">
                    <div className="references-peek-title">
                        References ({state.items.length})
                    </div>
                    {state.preview && selectedItem ? (
                        <div className="references-peek-header-path" title={resolveItemPath(selectedItem)}>
                            {resolveItemPath(selectedItem)}
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
                                <span className="references-peek-group-path" title={group.filePath}>
                                    {getFileName(group.filePath)}
                                </span>
                                <span>{group.indexes.length}</span>
                            </div>
                            {group.indexes.map((index) => {
                                const item = state.items[index];
                                const isSelected = state.selectedIndex === index;
                                const line = item.range.start.line + 1;
                                const column = item.range.start.character + 1;
                                return (
                                    <div
                                        key={`${group.filePath}:${line}:${column}:${index}`}
                                        className={`references-peek-item ${isSelected ? 'is-selected' : ''}`}
                                    >
                                        <button
                                            className={`references-peek-item-select ${isSelected ? 'is-selected' : ''}`}
                                            type="button"
                                            ref={(el) => {
                                                if (el) {
                                                    itemRefs.current.set(index, el);
                                                } else {
                                                    itemRefs.current.delete(index);
                                                }
                                            }}
                                            onClick={() => {
                                                if (isSelected) {
                                                    refocusPreviewSelection();
                                                    return;
                                                }
                                                onSelectItem(index);
                                            }}
                                            onDoubleClick={() => onOpenItem(index)}
                                        >
                                            <span className="references-peek-item-location">
                                                {line}:{column}
                                            </span>
                                        </button>
                                        <button
                                            className="references-peek-item-open"
                                            type="button"
                                            onClick={() => {
                                                onOpenItem(index);
                                                onClose();
                                            }}
                                        >
                                            Open
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
