import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { Mermaid } from 'mermaid';
import { FastSyntaxHighlighter, TokenDictionary } from 'anycode-editor';
import { copyTextToClipboard } from '../../utils';
import { Icons } from '../../components/Icons';
import './MermaidBlock.css';

let mermaidInstancePromise: Promise<Mermaid> | null = null;
let diagramCounter = 0;

const getMermaid = (): Promise<Mermaid> => {
    if (!mermaidInstancePromise) {
        mermaidInstancePromise = import('mermaid').then((m) => {
            const mermaid = m.default;
            mermaid.initialize({
                startOnLoad: false,
                theme: 'dark',
                look: 'classic',
                securityLevel: 'loose',
                flowchart: {
                    useMaxWidth: false,
                    htmlLabels: true,
                    curve: 'basis',
                    nodeSpacing: 45,
                    rankSpacing: 50,
                    padding: 15,
                },
                sequence: {
                    useMaxWidth: false,
                    actorMargin: 60,
                    messageMargin: 40,
                    boxMargin: 10,
                    actorFontSize: 13,
                    messageFontSize: 13,
                    noteFontSize: 13,
                },
                state: {
                    useMaxWidth: false,
                    fontSize: 13,
                },
                class: {
                    useMaxWidth: false,
                },
                er: {
                    useMaxWidth: false,
                    fontSize: 13,
                },
                gitGraph: {
                    useMaxWidth: false,
                },
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                fontSize: 13,
                themeVariables: {
                    darkMode: true,
                    background: 'transparent',
                    mainBkg: '#161b22',
                    nodeBorder: '#388bfd',
                    textColor: '#f0f6fc',
                    lineColor: '#58a6ff',
                    border1: '#30363d',
                    border2: '#30363d',
                    arrowheadColor: '#58a6ff',
                    clusterBkg: '#0d1117',
                    clusterBorder: '#30363d',
                    labelColor: '#f0f6fc',
                    actorBkg: '#161b22',
                    actorBorder: '#58a6ff',
                    actorTextColor: '#f0f6fc',
                    actorLineColor: '#30363d',
                    signalColor: '#58a6ff',
                    signalTextColor: '#f0f6fc',
                    labelBoxBkgColor: '#161b22',
                    labelBoxBorderColor: '#30363d',
                    labelTextColor: '#f0f6fc',
                    loopTextColor: '#f0f6fc',
                    noteBorderColor: '#388bfd',
                    noteBkgColor: '#161b22',
                    noteTextColor: '#f0f6fc',
                    activationBorderColor: '#58a6ff',
                    activationBkgColor: '#1f242c',
                    sequenceNumberColor: '#ffffff',
                    fontSize: '14px',
                },
            });

            if (typeof mermaid.setParseErrorHandler === 'function') {
                mermaid.setParseErrorHandler(() => {});
            }

            return mermaid;
        });
    }
    return mermaidInstancePromise;
};

const DiagramIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
);

const CodeIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
    </svg>
);

export interface MermaidBlockProps {
    code: string;
    isStreaming?: boolean;
    className?: string;
}

export const MermaidBlock: React.FC<MermaidBlockProps> = ({
    code,
    isStreaming = false,
    className = '',
}) => {
    const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram');
    const [svgHtml, setSvgHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [copied, setCopied] = useState<boolean>(false);
    const [zoom, setZoom] = useState<number>(1);
    const [fitMode, setFitMode] = useState<boolean>(false);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastValidSvgRef = useRef<string | null>(null);

    useEffect(() => () => {
        if (copyTimerRef.current) {
            clearTimeout(copyTimerRef.current);
        }
    }, []);

    const lines = useMemo(() => {
        return FastSyntaxHighlighter.tokenizeLines(code, 'mermaid');
    }, [code]);

    const handleCopy = async () => {
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        try {
            await copyTextToClipboard(code);
            setCopied(true);
            copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    const handleZoomIn = () => {
        setFitMode(false);
        setZoom((prev) => Math.min(Number((prev + 0.2).toFixed(2)), 3.0));
    };
    const handleZoomOut = () => {
        setFitMode(false);
        setZoom((prev) => Math.max(Number((prev - 0.2).toFixed(2)), 0.3));
    };
    const handleZoomReset = () => {
        setFitMode(false);
        setZoom(1);
    };
    const handleToggleFit = () => {
        setFitMode((prev) => !prev);
        setZoom(1);
    };

    const renderDiagram = useCallback(async (textToRender: string, isCancelled: () => boolean) => {
        const trimmed = textToRender.trim();
        if (!trimmed) {
            if (!isCancelled()) {
                setSvgHtml(null);
                lastValidSvgRef.current = null;
                setError(null);
                setIsLoading(false);
            }
            return;
        }

        try {
            const mermaid = await getMermaid();
            if (isCancelled()) return;

            // Check if syntax parses cleanly
            const isValid = await mermaid.parse(trimmed, { suppressErrors: true });
            if (!isValid) {
                // If currently streaming, don't flash errors while typing/streaming
                if (isStreaming) {
                    return;
                }

                // If invalid and not streaming, get descriptive error message
                try {
                    await mermaid.parse(trimmed);
                } catch (parseErr: any) {
                    if (isCancelled()) return;
                    const msg = parseErr?.message || parseErr?.str || 'Mermaid syntax error';
                    setSvgHtml(null);
                    lastValidSvgRef.current = null;
                    setError(msg);
                    setIsLoading(false);
                    return;
                }
            }

            const uniqueId = `mermaid-diag-${Date.now().toString(36)}-${++diagramCounter}`;

            try {
                const { svg, bindFunctions } = await mermaid.render(uniqueId, trimmed);
                if (isCancelled()) return;

                lastValidSvgRef.current = svg;
                setSvgHtml(svg);
                setError(null);
                setIsLoading(false);

                if (bindFunctions && containerRef.current) {
                    requestAnimationFrame(() => {
                        if (containerRef.current) {
                            bindFunctions(containerRef.current);
                        }
                    });
                }
            } finally {
                const strayError = document.getElementById(`d${uniqueId}`);
                if (strayError) strayError.remove();
            }
        } catch (err: any) {
            if (isCancelled()) return;
            if (!isStreaming) {
                setSvgHtml(null);
                lastValidSvgRef.current = null;
                setError(err?.message || 'Failed to render Mermaid diagram');
            }
            setIsLoading(false);
        }
    }, [isStreaming]);

    useEffect(() => {
        let cancelled = false;
        const isCancelled = () => cancelled;

        const timer = setTimeout(() => {
            void renderDiagram(code, isCancelled);
        }, isStreaming ? 250 : 60);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [code, isStreaming, renderDiagram]);

    const activeSvg = svgHtml || lastValidSvgRef.current;
    const hasError = Boolean(error);

    return (
        <div className={`mermaid-block ${className}`}>
            <div className="mermaid-header">
                <div className="mermaid-header-left">
                    <span className="mermaid-badge">
                        <DiagramIcon />
                        Mermaid
                    </span>
                    {hasError && (
                        <span className="mermaid-error-indicator" title={error || undefined}>
                            Syntax error
                        </span>
                    )}
                </div>

                <div className="mermaid-header-actions">
                    {viewMode === 'diagram' && activeSvg && !hasError && (
                        <div className="mermaid-zoom-controls">
                            <button
                                type="button"
                                className={`mermaid-zoom-btn mermaid-fit-btn ${fitMode ? 'active' : ''}`}
                                onClick={handleToggleFit}
                                title={fitMode ? "Switch to 1:1 natural size" : "Fit diagram to width"}
                            >
                                {fitMode ? "Fit" : "1:1"}
                            </button>
                            <button
                                type="button"
                                className="mermaid-zoom-btn"
                                onClick={handleZoomOut}
                                title="Zoom out"
                            >
                                -
                            </button>
                            <button
                                type="button"
                                className="mermaid-zoom-btn mermaid-zoom-reset"
                                onClick={handleZoomReset}
                                title="Reset zoom (100%)"
                            >
                                {Math.round(zoom * 100)}%
                            </button>
                            <button
                                type="button"
                                className="mermaid-zoom-btn"
                                onClick={handleZoomIn}
                                title="Zoom in"
                            >
                                +
                            </button>
                        </div>
                    )}

                    <div className="mermaid-view-toggle">
                        <button
                            type="button"
                            className={`mermaid-toggle-btn ${viewMode === 'diagram' ? 'active' : ''}`}
                            onClick={() => setViewMode('diagram')}
                            title="Show diagram"
                        >
                            <DiagramIcon />
                            Diagram
                        </button>
                        <button
                            type="button"
                            className={`mermaid-toggle-btn ${viewMode === 'code' ? 'active' : ''}`}
                            onClick={() => setViewMode('code')}
                            title="Show source code"
                        >
                            <CodeIcon />
                            Code
                        </button>
                    </div>

                    <button
                        type="button"
                        className={`mermaid-action-btn ${copied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        title={copied ? "Copied!" : "Copy diagram code"}
                        aria-label={copied ? "Copied" : "Copy diagram code"}
                    >
                        {copied ? <Icons.Check /> : <Icons.Copy />}
                    </button>
                </div>
            </div>

            <div className="mermaid-body">
                {viewMode === 'diagram' ? (
                    hasError ? (
                        <div className="mermaid-error-container">
                            <div className="mermaid-error-title">
                                <span>Failed to render diagram</span>
                            </div>
                            <pre className="mermaid-error-message">{error}</pre>
                            <pre className="mermaid-code-view">
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
                    ) : isLoading && !activeSvg ? (
                        <div className="mermaid-loading">
                            <div className="mermaid-spinner" />
                            <span>Rendering diagram...</span>
                        </div>
                    ) : activeSvg ? (
                        <div className="mermaid-diagram-container" ref={containerRef}>
                            <div
                                className={`mermaid-svg-wrapper ${fitMode ? 'mermaid-fit' : ''}`}
                                style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
                                dangerouslySetInnerHTML={{ __html: activeSvg }}
                            />
                        </div>
                    ) : null
                ) : (
                    <pre className="mermaid-code-view">
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
                )}
            </div>
        </div>
    );
};
