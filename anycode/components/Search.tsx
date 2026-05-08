import { useState, useRef, useEffect } from "react";
import { Icons } from "./Icons";
import "./Search.css";
import type { SearchResult, SearchMatch } from "../types";

const SEARCH_INPUT_STORAGE_KEY = "searchInput";

const StopIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <rect x="6" y="6" width="8" height="8" fill="currentColor"/>
    </svg>
);

interface SearchPreviewProps {
    match: SearchMatch;
    pattern: string;
    maxLength?: number;
}

const SearchPreview = ({ match, pattern, maxLength = 100 }: SearchPreviewProps) => {
    const displayPreview = maxLength > 0 ? match.preview.slice(0, maxLength) : match.preview;
    
    if (!pattern.trim()) {
        return <span className="search-preview" title={match.preview}>{displayPreview}</span>;
    }

    // Preview is created as: chars[preview_start..preview_end] 
    // where preview_start = max(0, match.column - 50)
    // So the match position in preview is: match.column - preview_start = min(50, match.column)
    const previewStart = Math.max(0, match.column - 50);
    const matchPositionInPreview = match.column - previewStart;
    const patternLength = pattern.length;
    
    // Ensure we don't go beyond preview bounds
    if (matchPositionInPreview < 0 || matchPositionInPreview + patternLength > displayPreview.length) {
        // Fallback: try to find pattern in preview
        const matchIndex = displayPreview.indexOf(pattern);
        if (matchIndex === -1) {
            return <span className="search-preview" title={match.preview}>{displayPreview}</span>;
        }
        const beforeMatch = displayPreview.slice(0, matchIndex);
        const matchText = displayPreview.slice(matchIndex, matchIndex + patternLength);
        const afterMatch = displayPreview.slice(matchIndex + patternLength);
        
        return (
            <span className="search-preview" title={match.preview}>
                {beforeMatch}
                <mark className="search-match">{matchText}</mark>
                {afterMatch}
            </span>
        );
    }
    
    // Split preview using match.column position
    const beforeMatch = displayPreview.slice(0, matchPositionInPreview);
    const matchText = displayPreview.slice(matchPositionInPreview, matchPositionInPreview + patternLength);
    const afterMatch = displayPreview.slice(matchPositionInPreview + patternLength);
    
    return (
        <span className="search-preview" title={match.preview}>
            {beforeMatch}
            <mark className="search-match">{matchText}</mark>
            {afterMatch}
        </span>
    );
};

interface SearchProps {
    id: string;
    onEnter: (data: { id: string; pattern: string }) => void;
    onInputChange?: () => void;
    onCancel: () => void;
    onClear?: () => void;
    onMatchClick: (filePath: string, match: SearchMatch) => void;
    results: SearchResult[];
    searchEnded: boolean;
}

const Search = ({ id, onEnter, onInputChange, onCancel, onClear, onMatchClick, results, searchEnded }: SearchProps) => {
    const [input, setInput] = useState(() => {
        if (typeof window === "undefined") return "";
        return localStorage.getItem(SEARCH_INPUT_STORAGE_KEY) ?? "";
    });
    const searchPatternRef = useRef("");
    const [visibleMatches, setVisibleMatches] = useState<Record<string, Set<string> | undefined>>({});
    const [elapsedTime, setElapsedTime] = useState<number>(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const startTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    
    // Clear visible matches when search starts (when searchEnded becomes false)
    useEffect(() => {
        if (!searchEnded) {
            setVisibleMatches({});
            setElapsedTime(0);
            startTimeRef.current = Date.now();
            
            // Start timer
            intervalRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = (Date.now() - startTimeRef.current) / 1000;
                    setElapsedTime(elapsed);
                }
            }, 100); // Update every 100ms for smooth display
        } else {
            // Stop timer when search ends
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            startTimeRef.current = null;
        }
        
        // Cleanup on unmount
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [searchEnded]);

    // Auto-resize textarea based on content
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
        }
    }, [input]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el || !input) return;
        // Place caret at the end for restored value after mount/autofocus.
        const end = input.length;
        el.setSelectionRange(end, end);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (input) {
            localStorage.setItem(SEARCH_INPUT_STORAGE_KEY, input);
        } else {
            localStorage.removeItem(SEARCH_INPUT_STORAGE_KEY);
        }
    }, [input]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        onInputChange?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // ESC cancels the search
        if (e.key === "Escape" && !searchEnded) {
            e.preventDefault();
            onCancel();
            return;
        }
        // Enter submits the search, Shift+Enter inserts newline
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            searchPatternRef.current = input; // Save the pattern used for search
            if (onEnter) {
                onEnter({ id: id, pattern: input });
            }
        }
        // Shift+Enter allows default behavior (inserts \n)
    };

    const totalMatches = results.reduce(
        (sum, fileResult) => sum + fileResult.matches.length,
        0
    );
    const totalFiles = results.length;
    const elapsedMs = Math.max(0, Math.round(elapsedTime * 1000));
    const hasQuery = input.trim().length > 0 || results.length > 0;

    const handleFileClick = (filePath: string) => {
        // Toggle the visibility of matches for the clicked file
        setVisibleMatches((prevState) => ({
            ...prevState,
            [filePath]: prevState[filePath] ? undefined : new Set(), // If the file is clicked, toggle visibility
        }));
    };

    const handleMatchClick = (filePath: string, match: SearchMatch) => {
        onMatchClick(filePath, match);
    };

    return (
        <div className="search-container">
            
            <div className="search-input-wrapper">
                <textarea
                    className="search-input"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    ref={inputRef}
                    autoFocus
                    rows={1}
                    title={`Search... (Enter to search, Shift+Enter for newline)`}
                    placeholder={`Search...`}
                />
            </div>

            <div className="search-summary">
                {hasQuery ? (
                    <span className="search-summary-text">{`${totalMatches} matches · ${totalFiles} files · ${elapsedMs} ms`}</span>
                ) : (
                    <span className="search-summary-text search-summary-text-empty"></span>
                )}
                <div className="search-actions-group">
                {searchEnded ? (
                    <>
                        {input.trim() && (
                            <button 
                                className="search-button replay"
                                onClick={() => {
                                    searchPatternRef.current = input; // Save the pattern used for search
                                    onEnter({ id: id, pattern: input });
                                }}
                                title="Replay search"
                            >
                                <Icons.Refresh />
                            </button>
                        )}
                        {(input.trim() || results.length > 0) && (
                            <button
                                className="search-button"
                                onClick={() => {
                                    onClear?.();
                                }}
                                title="Clear results"
                            >
                                ✕
                            </button>
                        )}
                    </>
                ) : (
                    <>
                        <button 
                            className="search-button search-button-cancel"
                            onClick={onCancel}
                            title="Cancel search"
                        >
                            <StopIcon />
                        </button>
                        <span className="search-loading"><span>.</span><span>.</span><span>.</span></span>
                    </>
                )}
                </div>
            </div>

            <div className="search-results">
                {results.length > 0 ? (
                    results.map((fileResult, index) => {
                        const isExpanded = !!visibleMatches[fileResult.file_path];
                        return (
                        <div key={index} className="file-result">
                            <p className="file-path active" onClick={() => handleFileClick(fileResult.file_path)}>
                                <span className={`file-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
                                <span className="file-path-label" title={fileResult.display_path}>{fileResult.display_path}</span>
                                <span className="file-match-badge">{fileResult.matches.length}</span>
                            </p>
                            {isExpanded && ( 
                                <div className="matches">
                                    {fileResult.matches.map((match, matchIndex) => {
                                        const matchKey = `${fileResult.file_path}:${match.line}:${match.column}:${matchIndex}`;

                                        return (
                                            <div key={matchKey} className="search-item"
                                                onClick={() => handleMatchClick(fileResult.file_path, match)}
                                            >
                                                <strong>{match.line + 1}</strong>
                                                <SearchPreview match={match} pattern={searchPatternRef.current} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        );
                    })
                ) : (
                    <div className="no-results">No results found</div>
                )}
            </div>
        </div>
    );
};

export default Search;
