import React, { useCallback, useEffect, useRef, useState } from "react";
import { WTerm, type SearchState } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";
import "./Terminal.css";
import { resolveFontFamily, type FontConfig } from "../../hooks/useSettings";
import { selectionQuoteStore } from "../../features/agents/selectionQuoteStore";
import { copyTextToClipboard } from "../../utils";
import { Icons } from "../Icons";

interface TerminalProps {
  name: string;
  session: string;
  focusRequestToken: number | null;
  onData: (name: string, session: string, data: string) => void;
  onMessage: (name: string, session: string, callback: (data: string) => void) => (() => void);
  onResize: (name: string, session: string, cols: number, rows: number) => void;
  onTitle: (name: string, session: string, title: string) => void;
  isTerminalClosing: (name: string, session: string) => boolean;
  isConnected: boolean;
  onUploadFile: (file: File) => Promise<string | null>;
  fontConfig: FontConfig;
}

const TERMINAL_DELAY_MS = 100;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_SNAPSHOT_CHARS = 200_000;
const MAX_SEARCH_QUERY_LEN = 1024;
const INITIAL_SEARCH_STATE: SearchState = {
  query: "",
  caseSensitive: false,
  count: 0,
  activeIndex: -1,
  searching: false,
  limited: false,
};
const terminalStorageKey = (kind: "data" | "mouseMode", name: string, session: string) => (
  session === "anycode"
    ? `terminal:${kind}:${name}`
    : `terminal:${kind}:${session}:${name}`
);

const applyTerminalTheme = (element: HTMLElement) => {
  const rootStyles = getComputedStyle(document.documentElement);
  const isDynamicBg = Boolean(
    document.querySelector(".app-with-dynamic-bg, [data-dynamic-bg='global']")
  );
  const background = isDynamicBg
    ? "transparent"
    : rootStyles.getPropertyValue("--background-color").trim() ||
      rootStyles.getPropertyValue("--theme-background").trim() ||
      "#0a0a0a";
  const foreground =
    rootStyles.getPropertyValue("--foreground-color").trim() ||
    rootStyles.getPropertyValue("--theme-foreground").trim() ||
    "#f0f0f0";
  const selectionBackground =
    rootStyles.getPropertyValue("--theme-accent-background").trim() ||
    "rgba(86, 156, 214, 0.3)";

  element.style.setProperty("--term-bg", background);
  element.style.setProperty("--term-app-bg", background);
  element.style.setProperty("--term-fg", foreground);
  element.style.setProperty("--term-cursor", foreground);
  element.style.setProperty("--term-selection-bg", selectionBackground);
};

const applyTerminalFont = (element: HTMLElement, fontConfig: FontConfig) => {
  const rowHeight = Math.max(1, Math.round(fontConfig.size * fontConfig.lineHeight));
  element.style.setProperty("--term-font-family", resolveFontFamily(fontConfig));
  element.style.setProperty("--term-font-size", `${fontConfig.size}px`);
  element.style.setProperty("--term-line-height", String(fontConfig.lineHeight));
  element.style.setProperty("--term-row-height", `${rowHeight}px`);
  element.style.fontWeight = String(fontConfig.weight);
};

const syncTerminalBottomPad = (element: HTMLElement, terminal: WTerm) => {
  const rowHeight =
    (terminal as unknown as { _rowHeight?: number })._rowHeight ||
    parseFloat(element.style.getPropertyValue("--term-row-height")) ||
    17;
  const style = getComputedStyle(element);
  const verticalPadding =
    (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const contentHeight = Math.max(0, element.clientHeight - verticalPadding);
  const gridHeight = terminal.rows * rowHeight;
  const remainder =
    contentHeight >= gridHeight
      ? Math.min(Math.max(0, rowHeight - 1), contentHeight - gridHeight)
      : 0;
  element.style.setProperty("--term-bottom-pad", `${remainder}px`);
};

const Terminal: React.FC<TerminalProps> = ({
  name,
  session,
  focusRequestToken,
  onData,
  onMessage,
  onResize,
  onTitle,
  isTerminalClosing,
  isConnected,
  onUploadFile,
  fontConfig,
}) => {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const wtermRef = useRef<WTerm | null>(null);
  const ghosttyCoreRef = useRef<GhosttyCore | null>(null);
  const isReadyRef = useRef<boolean>(false);
  const isRestoringRef = useRef<boolean>(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const savedSnapshotRef = useRef<string>("");
  const mouseModeRef = useRef<boolean>(false);
  const savedScrollTopRef = useRef<number>(0);
  const wasAtBottomRef = useRef<boolean>(true);
  const saveSnapshotTimerRef = useRef<number | null>(null);
  const themeObserverRef = useRef<MutationObserver | null>(null);
  const didAutoFocusRef = useRef<boolean>(false);
  const pendingFocusRef = useRef<boolean>(false);
  const wasContainerVisibleRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const isSearchOpenRef = useRef(isSearchOpen);
  const searchQueryRef = useRef(searchQuery);
  const caseSensitiveRef = useRef(caseSensitive);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onTitleRef = useRef(onTitle);
  const isTerminalClosingRef = useRef(isTerminalClosing);
  const onUploadFileRef = useRef(onUploadFile);
  const fontConfigRef = useRef(fontConfig);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
    onTitleRef.current = onTitle;
    isTerminalClosingRef.current = isTerminalClosing;
    onUploadFileRef.current = onUploadFile;
    fontConfigRef.current = fontConfig;
  }, [onData, onResize, onTitle, isTerminalClosing, onUploadFile, fontConfig]);

  useEffect(() => {
    isSearchOpenRef.current = isSearchOpen;
    searchQueryRef.current = searchQuery;
    caseSensitiveRef.current = caseSensitive;
  }, [isSearchOpen, searchQuery, caseSensitive]);

  const runSearch = useCallback((query: string, isCaseSensitive: boolean) => {
    const terminal = wtermRef.current;
    if (!terminal || !isReadyRef.current) return;
    const bounded = query.slice(0, MAX_SEARCH_QUERY_LEN);
    if (!bounded) {
      terminal.clearSearch();
      setSearchState(INITIAL_SEARCH_STATE);
      return;
    }
    terminal.search(bounded, { caseSensitive: isCaseSensitive });
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchState(INITIAL_SEARCH_STATE);
    const terminal = wtermRef.current;
    if (terminal && isReadyRef.current) {
      terminal.clearSearch();
      terminal.focus();
    }
  }, []);

  const openSearch = useCallback(() => {
    const terminal = wtermRef.current;
    const selectedText = terminal?.getSelectionText()?.trim() ?? "";
    let nextQuery = searchQueryRef.current;
    if (selectedText && !selectedText.includes("\n") && selectedText.length <= MAX_SEARCH_QUERY_LEN) {
      nextQuery = selectedText;
      searchQueryRef.current = nextQuery;
      setSearchQuery(nextQuery);
    }
    setIsSearchOpen(true);
    if (nextQuery) {
      runSearch(nextQuery, caseSensitiveRef.current);
    }
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [runSearch]);

  const handleFindNext = useCallback(() => {
    const terminal = wtermRef.current;
    if (!terminal || !isReadyRef.current || !searchQueryRef.current) return;
    const current = terminal.getSearchState();
    if (current.query !== searchQueryRef.current || current.caseSensitive !== caseSensitiveRef.current) {
      runSearch(searchQueryRef.current, caseSensitiveRef.current);
      return;
    }
    terminal.findNext();
  }, [runSearch]);

  const handleFindPrevious = useCallback(() => {
    const terminal = wtermRef.current;
    if (!terminal || !isReadyRef.current || !searchQueryRef.current) return;
    const current = terminal.getSearchState();
    if (current.query !== searchQueryRef.current || current.caseSensitive !== caseSensitiveRef.current) {
      runSearch(searchQueryRef.current, caseSensitiveRef.current);
      return;
    }
    terminal.findPrevious();
  }, [runSearch]);

  const handleToggleCaseSensitive = useCallback(() => {
    const next = !caseSensitiveRef.current;
    caseSensitiveRef.current = next;
    setCaseSensitive(next);
    if (searchQueryRef.current) {
      runSearch(searchQueryRef.current, next);
    }
    searchInputRef.current?.focus();
  }, [runSearch]);

  const appendToSnapshot = (chunk: string) => {
    let next = savedSnapshotRef.current + chunk;
    if (next.length > MAX_SNAPSHOT_CHARS) {
      const rawCut = next.length - MAX_SNAPSHOT_CHARS;
      const newlineIdx = next.indexOf("\n", rawCut);
      const cut = newlineIdx !== -1 && newlineIdx - rawCut < 512 ? newlineIdx + 1 : rawCut;
      next = next.slice(cut);
    }
    savedSnapshotRef.current = next;
  };

  const restoreTerminalScroll = (terminal: WTerm, el: HTMLElement) => {
    if (!el.isConnected || el.clientWidth <= 0 || el.clientHeight <= 0) return;
    const internal = terminal as unknown as {
      _shouldScrollToBottom?: boolean;
      _pendingResizeScrollTop?: number | null;
      _programmaticScrollTop?: number | null;
      _cancelScheduledRender?: () => void;
      _doRender?: () => void;
    };
    internal._cancelScheduledRender?.();
    if (wasAtBottomRef.current) {
      internal._shouldScrollToBottom = true;
      internal._pendingResizeScrollTop = null;
      internal._doRender?.();
      const targetScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      internal._programmaticScrollTop = targetScrollTop;
      el.scrollTop = el.scrollHeight;
      savedScrollTopRef.current = el.scrollTop;
    } else {
      const targetScrollTop = savedScrollTopRef.current;
      internal._shouldScrollToBottom = false;
      internal._pendingResizeScrollTop = targetScrollTop;
      internal._doRender?.();
      internal._programmaticScrollTop = targetScrollTop;
      el.scrollTop = targetScrollTop;
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(
        `File(s) too large. Maximum size allowed is 20MB. (Oversized: ${oversized.map((f) => f.name).join(", ")})`
      );
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const paths: string[] = [];
    for (const file of files) {
      try {
        const savedPath = await onUploadFileRef.current(file);
        if (savedPath) {
          paths.push(savedPath);
        }
      } catch (err) {
        console.error("Failed to upload dropped file:", err);
      }
    }

    if (paths.length > 0) {
      const formattedPaths = paths.map((p) => `"${p}"`).join(" ");
      onDataRef.current(name, session, formattedPaths);
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }

    if (files.length === 0) return;

    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(
        `File(s) too large. Maximum size allowed is 20MB. (Oversized: ${oversized.map((f) => f.name).join(", ")})`
      );
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const paths: string[] = [];
    for (const file of files) {
      try {
        const savedPath = await onUploadFileRef.current(file);
        if (savedPath) {
          paths.push(savedPath);
        }
      } catch (err) {
        console.error("Failed to upload pasted file:", err);
      }
    }

    if (paths.length > 0) {
      const formattedPaths = paths.map((p) => `"${p}"`).join(" ");
      onDataRef.current(name, session, formattedPaths);
    }
  };

  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      key === "f"
    ) {
      event.preventDefault();
      event.stopPropagation();
      openSearch();
      return;
    }

    if (event.key === "Escape" && isSearchOpenRef.current) {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      key === "c"
    ) {
      const terminal = wtermRef.current;
      const selection = terminal?.getSelectionText();
      if (selection) {
        event.preventDefault();
        event.stopPropagation();
        void copyTextToClipboard(selection);
      }
    }
  };

  const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value.slice(0, MAX_SEARCH_QUERY_LEN);
    searchQueryRef.current = next;
    setSearchQuery(next);
    runSearch(next, caseSensitiveRef.current);
  };

  const handleSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        handleFindPrevious();
      } else {
        handleFindNext();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      handleFindNext();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      handleFindPrevious();
    }
  };

  const saveTerminalState = () => {
    if (isTerminalClosingRef.current(name, session)) return;
    try {
      const mouseTracking = wtermRef.current?.bridge?.mouseTracking?.();
      if (mouseTracking !== undefined) {
        mouseModeRef.current = mouseTracking !== 0;
      }
      localStorage.setItem(terminalStorageKey("data", name, session), savedSnapshotRef.current);
      localStorage.setItem(terminalStorageKey("mouseMode", name, session), mouseModeRef.current.toString());
    } catch {
      // Ignore quota errors
    }
  };

  const queueSnapshotSave = () => {
    if (saveSnapshotTimerRef.current !== null) {
      clearTimeout(saveSnapshotTimerRef.current);
    }
    saveSnapshotTimerRef.current = window.setTimeout(() => {
      saveSnapshotTimerRef.current = null;
      saveTerminalState();
    }, TERMINAL_DELAY_MS);
  };

  const restoreTerminalState = (terminal: WTerm) => {
    const snapshot = savedSnapshotRef.current || localStorage.getItem(terminalStorageKey("data", name, session)) || "";
    savedSnapshotRef.current = snapshot;

    isRestoringRef.current = true;
    try {
      if (snapshot) {
        terminal.write(snapshot);
      }

      const savedMouseMode = localStorage.getItem(terminalStorageKey("mouseMode", name, session));
      if (savedMouseMode === "true") {
        mouseModeRef.current = true;
        terminal.write("\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
      }
    } finally {
      isRestoringRef.current = false;
    }
  };

  const handleCheckTerminalSelection = () => {
    requestAnimationFrame(() => {
      const terminal = wtermRef.current;
      if (!terminal || !isReadyRef.current) return;
      const selectedText = terminal.getSelectionText() ?? "";
      if (selectedText && selectedText.trim().length >= 2) {
        selectionQuoteStore.set({
          id: `terminal:${name}`,
          text: selectedText.trim(),
          source: "terminal",
          label: `Terminal: ${name}`,
        });
      } else {
        if (selectionQuoteStore.get()?.id === `terminal:${name}`) {
          selectionQuoteStore.clear();
        }
      }
    });
  };

  useEffect(() => {
    let cleanupMessage: (() => void) | undefined;
    let cancelled = false;
    const pendingChunks: string[] = [];

    const clearSaveTimer = () => {
      if (saveSnapshotTimerRef.current !== null) {
        clearTimeout(saveSnapshotTimerRef.current);
        saveSnapshotTimerRef.current = null;
      }
    };

    if (!isConnected) {
      clearSaveTimer();
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (themeObserverRef.current) {
        themeObserverRef.current.disconnect();
        themeObserverRef.current = null;
      }
      if (wtermRef.current) {
        wtermRef.current.destroy();
        wtermRef.current = null;
      }
      if (ghosttyCoreRef.current) {
        ghosttyCoreRef.current.dispose();
        ghosttyCoreRef.current = null;
      }
      isReadyRef.current = false;
      return;
    }

    const container = terminalRef.current;
    if (!container) return;

    applyTerminalTheme(container);
    applyTerminalFont(container, fontConfigRef.current);

    const onContainerScroll = (event: Event) => {
      if (
        !wasContainerVisibleRef.current ||
        !container.isConnected ||
        container.clientWidth <= 0 ||
        container.clientHeight <= 0
      ) {
        event.stopImmediatePropagation();
        if (
          wtermRef.current &&
          isReadyRef.current &&
          container.isConnected &&
          container.clientWidth > 0 &&
          container.clientHeight > 0
        ) {
          restoreTerminalScroll(wtermRef.current, container);
        }
        return;
      }
      savedScrollTopRef.current = container.scrollTop;
      wasAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < 5;
    };
    container.addEventListener("scroll", onContainerScroll, { capture: true, passive: true });
    isReadyRef.current = false;

    const handler = (data: string) => {
      if (!isReadyRef.current || !wtermRef.current) {
        pendingChunks.push(data);
        return;
      }
      appendToSnapshot(data);
      wtermRef.current.write(data);
      queueSnapshotSave();
    };

    cleanupMessage = onMessage(name, session, handler);

    const themeObserver = new MutationObserver(() => {
      if (terminalRef.current) {
        applyTerminalTheme(terminalRef.current);
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    const appContainer = document.querySelector(".app-container");
    if (appContainer) {
      themeObserver.observe(appContainer, {
        attributes: true,
        attributeFilter: ["class", "data-dynamic-bg"],
      });
    }
    themeObserverRef.current = themeObserver;

    const onDocumentSelectionChange = () => {
      handleCheckTerminalSelection();
    };
    document.addEventListener("selectionchange", onDocumentSelectionChange);

    void GhosttyCore.load({ scrollbackLimit: 10 * 1024 * 1024 })
      .then(async (core) => {
        if (cancelled) {
          core.dispose();
          return;
        }
        ghosttyCoreRef.current = core;

        const terminal = new WTerm(container, {
          core,
          cursorBlink: true,
          autoResize: true,
          onData: (data) => {
            if (isRestoringRef.current) return;
            wasAtBottomRef.current = true;
            onDataRef.current(name, session, data);
          },
          onTitle: (title) => {
            onTitleRef.current(name, session, title);
          },
          onResize: (nextCols, nextRows) => {
            if (terminalRef.current) {
              syncTerminalBottomPad(terminalRef.current, terminal);
            }
            onResizeRef.current(name, session, nextCols, nextRows);
          },
          onSearchChange: (state) => {
            if (!cancelled) {
              setSearchState(state);
            }
          },
        });
        wtermRef.current = terminal;

        await terminal.init();
        if (cancelled || wtermRef.current !== terminal) return;
        isReadyRef.current = true;

        if (terminalRef.current) {
          syncTerminalBottomPad(terminalRef.current, terminal);
        }

        restoreTerminalState(terminal);
        if (pendingChunks.length > 0) {
          const combined = pendingChunks.join("");
          pendingChunks.length = 0;
          appendToSnapshot(combined);
          terminal.write(combined);
          queueSnapshotSave();
        }
        if (isSearchOpenRef.current && searchQueryRef.current) {
          terminal.search(searchQueryRef.current, {
            caseSensitive: caseSensitiveRef.current,
          });
        }

        terminal.fit();
        if (terminalRef.current) {
          syncTerminalBottomPad(terminalRef.current, terminal);
          wasContainerVisibleRef.current =
            terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0;
          restoreTerminalScroll(terminal, terminalRef.current);
        }
        onResizeRef.current(name, session, terminal.cols, terminal.rows);

        requestAnimationFrame(() => {
          if (cancelled || wtermRef.current !== terminal) return;
          terminal.fit();
          const el = terminalRef.current;
          const isContainerVisible = Boolean(
            el && el.clientWidth > 0 && el.clientHeight > 0
          );
          if (el) {
            syncTerminalBottomPad(el, terminal);
            wasContainerVisibleRef.current = isContainerVisible;
            restoreTerminalScroll(terminal, el);
          }
          if (isContainerVisible && (!didAutoFocusRef.current || pendingFocusRef.current)) {
            didAutoFocusRef.current = true;
            pendingFocusRef.current = false;
            terminal.focus();
          }
        });

        const resizeObserver = new ResizeObserver(() => {
          const el = terminalRef.current;
          const isContainerVisible = Boolean(
            el && el.clientWidth > 0 && el.clientHeight > 0
          );

          if (!isContainerVisible) {
            wasContainerVisibleRef.current = false;
            return;
          }

          const becameVisible = !wasContainerVisibleRef.current;
          wasContainerVisibleRef.current = true;

          if (becameVisible) {
            terminal.fit();
          }
          if (el) {
            syncTerminalBottomPad(el, terminal);
            restoreTerminalScroll(terminal, el);
          }

          if (becameVisible) {
            requestAnimationFrame(() => {
              if (cancelled || wtermRef.current !== terminal) return;
              if (terminalRef.current) {
                restoreTerminalScroll(terminal, terminalRef.current);
              }
              if (!didAutoFocusRef.current || pendingFocusRef.current) {
                didAutoFocusRef.current = true;
                pendingFocusRef.current = false;
                terminal.focus();
              }
            });
          }
        });

        if (terminalRef.current) {
          resizeObserver.observe(terminalRef.current);
        }
        resizeObserverRef.current = resizeObserver;
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to initialize WTerm:", err);
        }
      });

    return () => {
      cancelled = true;
      container.removeEventListener("scroll", onContainerScroll, { capture: true });
      document.removeEventListener("selectionchange", onDocumentSelectionChange);
      if (cleanupMessage) cleanupMessage();
      clearSaveTimer();
      if (isTerminalClosingRef.current(name, session)) {
        localStorage.removeItem(terminalStorageKey("data", name, session));
        localStorage.removeItem(terminalStorageKey("mouseMode", name, session));
      } else {
        saveTerminalState();
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      wasContainerVisibleRef.current = false;
      if (themeObserverRef.current) {
        themeObserverRef.current.disconnect();
        themeObserverRef.current = null;
      }
      if (wtermRef.current) {
        wtermRef.current.destroy();
        wtermRef.current = null;
      }
      if (ghosttyCoreRef.current) {
        ghosttyCoreRef.current.dispose();
        ghosttyCoreRef.current = null;
      }
      isReadyRef.current = false;
    };
  }, [isConnected, name, session, onMessage]);

  useEffect(() => {
    if (!terminalRef.current) return;
    applyTerminalFont(terminalRef.current, fontConfig);
    if (!wtermRef.current || !isReadyRef.current) return;
    requestAnimationFrame(() => {
      if (!wtermRef.current || !terminalRef.current) return;
      wtermRef.current.fit();
      syncTerminalBottomPad(terminalRef.current, wtermRef.current);
      restoreTerminalScroll(wtermRef.current, terminalRef.current);
    });
  }, [fontConfig]);

  useEffect(() => {
    if (focusRequestToken === null) {
      return;
    }

    const container = terminalRef.current;
    const isContainerVisible = Boolean(
      container && container.clientWidth > 0 && container.clientHeight > 0
    );
    if (!wtermRef.current || !isReadyRef.current || !isContainerVisible) {
      pendingFocusRef.current = true;
      return;
    }

    pendingFocusRef.current = false;
    if (container) {
      restoreTerminalScroll(wtermRef.current, container);
    }
    wtermRef.current.focus();
    const rafId = requestAnimationFrame(() => {
      if (wtermRef.current && terminalRef.current) {
        restoreTerminalScroll(wtermRef.current, terminalRef.current);
      }
      wtermRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [focusRequestToken]);

  const hasQuery = searchQuery.length > 0;
  const noMatches = hasQuery && !searchState.searching && searchState.count === 0;
  const matchCountLabel = !hasQuery
    ? ""
    : searchState.count > 0
      ? `${searchState.activeIndex + 1}/${searchState.count}${searchState.limited ? "+" : ""}`
      : searchState.searching
        ? "..."
        : "0/0";

  return (
    <div
      className="terminal-wrapper"
      onKeyDownCapture={handleKeyDownCapture}
      onPasteCapture={handlePaste}
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
      onMouseUpCapture={handleCheckTerminalSelection}
      onKeyUpCapture={handleCheckTerminalSelection}
      style={{
        width: "100%",
        height: "100%",
        padding: "6px 8px",
        boxSizing: "border-box",
        color: "var(--foreground-color, var(--theme-foreground, #f0f0f0))",
        position: "relative",
      }}
    >
      {isSearchOpen && (
        <div
          className={`terminal-search-bar${noMatches ? " is-no-matches" : ""}`}
          role="search"
          aria-label="Find in terminal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            type="text"
            className="terminal-search-input"
            placeholder="Find in terminal…"
            value={searchQuery}
            onChange={handleSearchInputChange}
            onKeyDown={handleSearchInputKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
          />
          {hasQuery && (
            <span
              className={`terminal-search-count${noMatches ? " is-empty" : ""}`}
              title={
                searchState.limited
                  ? "Showing first 10,000 matches — narrow your search to see more"
                  : undefined
              }
            >
              {matchCountLabel}
            </span>
          )}
          <button
            type="button"
            className={`terminal-search-btn terminal-search-case-btn${caseSensitive ? " is-active" : ""}`}
            onClick={handleToggleCaseSensitive}
            title="Match Case"
            aria-label="Match Case"
            aria-pressed={caseSensitive}
          >
            Aa
          </button>
          <div className="terminal-search-divider" />
          <button
            type="button"
            className="terminal-search-btn"
            onClick={handleFindPrevious}
            disabled={searchState.count === 0}
            title="Previous Match (Shift+Enter)"
            aria-label="Previous Match"
          >
            <Icons.ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="terminal-search-btn"
            onClick={handleFindNext}
            disabled={searchState.count === 0}
            title="Next Match (Enter)"
            aria-label="Next Match"
          >
            <Icons.ChevronDown size={14} />
          </button>
          <button
            type="button"
            className="terminal-search-btn terminal-search-close-btn"
            onClick={closeSearch}
            title="Close (Escape)"
            aria-label="Close Search"
          >
            <Icons.CloseSmall size={11} />
          </button>
        </div>
      )}
      <div
        ref={terminalRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />
      {!isConnected && <div className="terminal-disconnected">Disconnected</div>}
    </div>
  );
};

export default React.memo(Terminal);

