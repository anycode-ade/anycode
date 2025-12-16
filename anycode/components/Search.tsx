import { useState, useRef, useEffect } from "react";
import "./Search.css";
import type { SearchResult, SearchMatch } from "../types";

const ReplayIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" fill="currentColor"/>
    </svg>
);

const StopIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <rect x="6" y="6" width="8" height="8" fill="currentColor"/>
    </svg>
);

interface SearchProps {
    id: string;
    onEnter: (data: { id: string; pattern: string }) => void;
    onCancel: () => void;
    onMatchClick: (filePath: string, match: SearchMatch) => void;
    results: SearchResult[];
    searchEnded: boolean;
}

const Search = ({ id, onEnter, onCancel, onMatchClick, results, searchEnded }: SearchProps) => {
    const [input, setInput] = useState("");
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

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
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

    const formatElapsedTime = (seconds: number): string => {
        if (seconds < 1) {
            return `${(seconds * 1000).toFixed(0)}ms`;
        }
        return `${seconds.toFixed(2)}s`;
    };

    return (
        <div className="search-container">
            <div className="search-header">
                Search
            </div>
            
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
                <span>{totalMatches} matches</span>
                {elapsedTime > 0 && (
                    <span className="search-elapsed">{formatElapsedTime(elapsedTime)}</span>
                )}
                {searchEnded ? (
                    input.trim() && (
                        <button 
                            className="search-button replay"
                            onClick={() => {
                                onEnter({ id: id, pattern: input });
                            }}
                            title="Replay search"
                        >
                            <ReplayIcon />
                        </button>
                    )
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

            <div className="search-results">
                {results.length > 0 ? (
                    results.map((fileResult, index) => {
                        const isExpanded = !!visibleMatches[fileResult.file_path];
                        return (
                        <div key={index} className="file-result">
                            <p className="file-path active" onClick={() => handleFileClick(fileResult.file_path)}>
                                <span className={`file-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
                                {fileResult.matches.length}: {fileResult.file_path}
                            </p>
                            {isExpanded && ( 
                                <div className="matches">
                                    {fileResult.matches.map((match, matchIndex) => {
                                        const matchKey = `${fileResult.file_path}:${match.line}:${match.column}:${matchIndex}`;

                                        return (
                                            <div key={matchKey} className="search-item"
                                                onClick={() => handleMatchClick(fileResult.file_path, match)}
                                            >
                                                <strong>{match.line + 1}:{match.column + 1} </strong>
                                                <span className="search-preview" title={match.preview}>{match.preview.slice(0, 100)}</span>
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

