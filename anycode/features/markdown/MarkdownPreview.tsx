import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FastSyntaxHighlighter, TokenDictionary } from 'anycode-base';
import type { AnycodeEditor } from 'anycode-base';
import type { FileState } from '../../types';
import { Icons } from '../../components/Icons';
import { copyTextToClipboard, normalizePath } from '../../utils';
import './MarkdownPreview.css';

export type MarkdownPreviewProps = {
    file: FileState;
    editor?: AnycodeEditor | null;
    onOpenFile?: (path: string, line?: number, column?: number) => void;
};

const memoryScrollCache = new Map<string, number>();

function getSavedScroll(key: string): number | null {
    return memoryScrollCache.get(key) ?? null;
}

function persistScroll(key: string, scrollTop: number) {
    memoryScrollCache.set(key, scrollTop);
}

const imageDimensionsCache = new Map<string, { width: number; height: number; aspectRatio: number }>();
const IMG_DIM_STORAGE_PREFIX = 'anycode:markdown-img:';

function getCachedImageDimensions(src: string): { width: number; height: number; aspectRatio: number } | null {
    if (imageDimensionsCache.has(src)) {
        return imageDimensionsCache.get(src)!;
    }
    try {
        const val = localStorage.getItem(`${IMG_DIM_STORAGE_PREFIX}${src}`);
        if (val) {
            const parsed = JSON.parse(val);
            if (parsed && parsed.width > 0 && parsed.height > 0) {
                const item = {
                    width: parsed.width,
                    height: parsed.height,
                    aspectRatio: parsed.width / parsed.height,
                };
                imageDimensionsCache.set(src, item);
                return item;
            }
        }
    } catch {
        // ignore
    }
    return null;
}

function saveImageDimensions(src: string, width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    const item = { width, height, aspectRatio: width / height };
    imageDimensionsCache.set(src, item);
    try {
        localStorage.setItem(`${IMG_DIM_STORAGE_PREFIX}${src}`, JSON.stringify({ width, height }));
    } catch {
        // ignore
    }
}

function isBadgeImage(src?: string, alt?: string): boolean {
    if (!src) return false;
    const lowerSrc = src.toLowerCase();
    const lowerAlt = (alt || '').toLowerCase();
    return (
        lowerSrc.includes('shields.io') ||
        lowerSrc.includes('/badge') ||
        lowerSrc.endsWith('.svg') ||
        lowerAlt.includes('badge') ||
        lowerAlt.includes('license')
    );
}

const MarkdownImage: React.FC<{
    src?: string;
    alt?: string;
    onLoadSuccess?: () => void;
} & React.ImgHTMLAttributes<HTMLImageElement>> = ({
    src,
    alt,
    onLoadSuccess,
    ...props
}) => {
    if (!src) return null;

    const isBadge = isBadgeImage(src, alt);
    const cachedDim = getCachedImageDimensions(src);
    const [loaded, setLoaded] = useState(() => Boolean(cachedDim));
    const [aspectRatio, setAspectRatio] = useState<number | null>(() => cachedDim?.aspectRatio ?? null);
    const [hasError, setHasError] = useState(false);

    const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            saveImageDimensions(src, img.naturalWidth, img.naturalHeight);
            setAspectRatio(img.naturalWidth / img.naturalHeight);
        }
        setLoaded(true);
        onLoadSuccess?.();
    };

    const handleError = () => {
        setHasError(true);
        setLoaded(true);
    };

    if (hasError) {
        return (
            <span className="markdown-image-error" title={`Failed to load image: ${src}`}>
                <span>🖼️</span>
                <span>{alt || 'Image failed to load'}</span>
            </span>
        );
    }

    if (isBadge) {
        return (
            <img
                {...props}
                src={src}
                alt={alt}
                loading="eager"
                decoding="async"
                className="markdown-preview-badge"
                onLoad={handleLoad}
                onError={handleError}
            />
        );
    }

    return (
        <img
            {...props}
            src={src}
            alt={alt}
            loading="eager"
            decoding="async"
            className="markdown-preview-image"
            style={{
                ...(aspectRatio ? { aspectRatio: `${aspectRatio}` } : {}),
                ...props.style,
            }}
            onLoad={handleLoad}
            onError={handleError}
        />
    );
};

const CodeCopyButton: React.FC<{ content: string }> = ({ content }) => {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const handleCopy = async () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        try {
            await copyTextToClipboard(content);
            setCopied(true);
            timerRef.current = setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <button
            className={`markdown-code-copy-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
            type="button"
            title={copied ? "Copied!" : "Copy code"}
            aria-label={copied ? "Copied" : "Copy code"}
        >
            {copied ? <Icons.Check /> : <Icons.Copy />}
        </button>
    );
};

const MarkdownCodeBlock: React.FC<{
    code: string;
    rawLanguage: string;
}> = ({ code, rawLanguage }) => {
    const lines = useMemo(() => {
        return FastSyntaxHighlighter.tokenizeLines(code, rawLanguage);
    }, [code, rawLanguage]);

    return (
        <div className="markdown-code-block">
            <CodeCopyButton content={code} />
            <pre className="markdown-code-content">
                <code>
                    {lines.map((lineTokens, lineIdx) => (
                        <React.Fragment key={lineIdx}>
                            {lineIdx > 0 && '\n'}
                            {lineTokens.map((token, tokenIdx) => {
                                if (!token.name) {
                                    return <span key={tokenIdx}>{token.text}</span>;
                                }
                                const tokenId = TokenDictionary.getId(token.name);
                                const classString = TokenDictionary.getClassString(tokenId);
                                return (
                                    <span key={tokenIdx} className={classString}>
                                        {token.text}
                                    </span>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </code>
            </pre>
        </div>
    );
};

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
    file,
    editor,
    onOpenFile,
}) => {
    const [content, setContent] = useState<string>(() => editor?.getText() ?? '');
    const containerRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const isRestoringRef = useRef(false);
    const isUnmountingRef = useRef(false);
    const targetScrollRef = useRef<number | null>(null);
    const restoreRafRef = useRef<number | null>(null);

    const currentFilePath = file.source?.path || file.name || file.id;
    const cacheKey = useMemo(() => normalizePath(currentFilePath), [currentFilePath]);

    const tryRestore = useCallback(() => {
        const target = targetScrollRef.current;
        const el = containerRef.current;
        if (target === null || !el) return;

        if (el.scrollHeight <= el.clientHeight) return;

        isRestoringRef.current = true;
        el.scrollTop = target;

        if (Math.abs(el.scrollTop - target) <= 2) {
            if (restoreRafRef.current) cancelAnimationFrame(restoreRafRef.current);
            restoreRafRef.current = requestAnimationFrame(() => {
                isRestoringRef.current = false;
                targetScrollRef.current = null;
            });
        }
    }, []);

    useEffect(() => {
        isUnmountingRef.current = false;
        const saved = getSavedScroll(cacheKey);
        if (saved !== null && saved > 0) {
            targetScrollRef.current = saved;
            tryRestore();
        } else {
            targetScrollRef.current = null;
        }

        return () => {
            isUnmountingRef.current = true;
            if (restoreRafRef.current) cancelAnimationFrame(restoreRafRef.current);
            const el = containerRef.current;
            if (el && !isRestoringRef.current && el.scrollTop > 0) {
                persistScroll(cacheKey, el.scrollTop);
            }
        };
    }, [cacheKey, tryRestore]);

    useEffect(() => {
        if (!editor) return;

        setContent(editor.getText());

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = editor.addOnChangeListener(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                setContent(editor.getText());
            }, 70);
        });

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            unsubscribe();
        };
    }, [editor]);

    useEffect(() => {
        if (targetScrollRef.current !== null) {
            tryRestore();
        }
    }, [content, tryRestore]);

    useEffect(() => {
        const contentEl = contentRef.current;
        if (!contentEl) return;

        const observer = new ResizeObserver(() => {
            if (targetScrollRef.current !== null) {
                tryRestore();
            }
        });

        observer.observe(contentEl);
        return () => observer.disconnect();
    }, [tryRestore]);

    useEffect(() => {
        if (targetScrollRef.current !== null) {
            const timeout = setTimeout(() => {
                if (targetScrollRef.current !== null) {
                    if (containerRef.current) {
                        containerRef.current.scrollTop = targetScrollRef.current;
                    }
                    isRestoringRef.current = false;
                    targetScrollRef.current = null;
                }
            }, 800);
            return () => clearTimeout(timeout);
        }
    }, [cacheKey]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (isRestoringRef.current || isUnmountingRef.current) return;
        const el = e.currentTarget;
        if (!el || el.clientHeight === 0) return;
        persistScroll(cacheKey, el.scrollTop);
    };

    const handleUserInteraction = () => {
        isRestoringRef.current = false;
        targetScrollRef.current = null;
    };

    const currentDirectory = useMemo(() => {
        const lastSlash = cacheKey.lastIndexOf('/');
        return lastSlash !== -1 ? cacheKey.substring(0, lastSlash) : '';
    }, [cacheKey]);

    const resolvePath = (relativeOrAbsPath: string): string => {
        const trimmed = relativeOrAbsPath.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
            return normalizePath(trimmed);
        }
        const cleaned = trimmed.replace(/^\.\//, '');
        return currentDirectory ? `${currentDirectory}/${cleaned}` : cleaned;
    };

    const mapImageSrc = (src?: string): string => {
        if (!src) return '';
        const trimmed = src.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
            return trimmed;
        }
        const resolved = resolvePath(trimmed);
        return `/api/local-image?path=${encodeURIComponent(resolved)}`;
    };

    const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href?: string) => {
        if (!href) return;
        const trimmed = href.trim();
        if (!trimmed) return;

        if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:')) {
            return;
        }

        e.preventDefault();

        if (trimmed.startsWith('#')) {
            const elementId = trimmed.slice(1);
            const targetElement = document.getElementById(elementId) ||
                document.getElementById(decodeURIComponent(elementId));
            targetElement?.scrollIntoView({ behavior: 'smooth' });
            return;
        }

        const match = trimmed.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/);
        const rawPath = match?.[1] ?? trimmed;
        const line = match?.[2] ? parseInt(match[2], 10) - 1 : undefined;
        const column = match?.[3] ? parseInt(match[3], 10) - 1 : undefined;

        const resolved = resolvePath(rawPath);
        if (onOpenFile && resolved) {
            onOpenFile(resolved, line, column);
        }
    };

    return (
        <div
            ref={containerRef}
            className="markdown-preview"
            onScroll={handleScroll}
            onWheel={handleUserInteraction}
            onPointerDown={handleUserInteraction}
            onTouchStart={handleUserInteraction}
        >
            {!content.trim() ? (
                <div className="markdown-preview-empty">No markdown content to preview</div>
            ) : (
                <div ref={contentRef} className="markdown-preview-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            a: ({ node: _node, href, children, ...props }) => {
                                const isExternal = href?.startsWith('http://') || href?.startsWith('https://') || href?.startsWith('mailto:');

                                return (
                                    <a
                                        {...props}
                                        href={href}
                                        onClick={(e) => handleLinkClick(e, href)}
                                        target={isExternal ? '_blank' : undefined}
                                        rel={isExternal ? 'noopener noreferrer' : undefined}
                                    >
                                        {children}
                                    </a>
                                );
                            },
                            img: ({ node: _node, src, alt, ...props }) => {
                                const mapped = mapImageSrc(typeof src === 'string' ? src : undefined);
                                if (!mapped) return null;
                                return (
                                    <MarkdownImage
                                        {...props}
                                        src={mapped}
                                        alt={alt}
                                        onLoadSuccess={() => {
                                            if (targetScrollRef.current !== null) {
                                                tryRestore();
                                            }
                                        }}
                                    />
                                );
                            },
                            code: ({ node: _node, className, children, ...props }) => {
                                const match = /language-(\w+)/.exec(className || '');
                                const text = String(children).replace(/\n$/, '');

                                if (!className && !String(children).includes('\n')) {
                                    return (
                                        <code className="markdown-preview-inline-code" {...props}>
                                            {children}
                                        </code>
                                    );
                                }

                                const rawLang = match ? match[1] : '';

                                return (
                                    <MarkdownCodeBlock
                                        code={text}
                                        rawLanguage={rawLang}
                                    />
                                );
                            },
                            pre: ({ children }) => {
                                return <>{children}</>;
                            },
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                </div>
            )}
        </div>
    );
};
