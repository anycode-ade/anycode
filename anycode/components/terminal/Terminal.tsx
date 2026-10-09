import React, { useEffect, useRef } from "react";
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";
import "./Terminal.css";
import { resolveFontFamily, type FontConfig } from "../../hooks/useSettings";
import { selectionQuoteStore } from "../../features/agents/selectionQuoteStore";
import { copyTextToClipboard } from "../../utils";

interface TerminalProps {
  name: string;
  focusRequestToken: number | null;
  onData: (name: string, data: string) => void;
  onMessage: (name: string, callback: (data: string) => void) => (() => void);
  onResize: (name: string, cols: number, rows: number) => void;
  isTerminalClosing: (name: string) => boolean;
  isConnected: boolean;
  onUploadFile: (file: File) => Promise<string | null>;
  fontConfig: FontConfig;
}

const TERMINAL_DELAY_MS = 100;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_SNAPSHOT_CHARS = 200_000;

const applyTerminalTheme = (element: HTMLElement) => {
  const rootStyles = getComputedStyle(document.documentElement);
  const background =
    rootStyles.getPropertyValue("--background-color").trim() ||
    rootStyles.getPropertyValue("--theme-background").trim() ||
    "#242424";
  const foreground =
    rootStyles.getPropertyValue("--foreground-color").trim() ||
    rootStyles.getPropertyValue("--theme-foreground").trim() ||
    "#f0f0f0";
  const selectionBackground =
    rootStyles.getPropertyValue("--theme-accent-background").trim() ||
    "rgba(86, 156, 214, 0.3)";

  element.style.setProperty("--term-bg", background);
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
  focusRequestToken,
  onData,
  onMessage,
  onResize,
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
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const isTerminalClosingRef = useRef(isTerminalClosing);
  const onUploadFileRef = useRef(onUploadFile);
  const fontConfigRef = useRef(fontConfig);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
    isTerminalClosingRef.current = isTerminalClosing;
    onUploadFileRef.current = onUploadFile;
    fontConfigRef.current = fontConfig;
  }, [onData, onResize, isTerminalClosing, onUploadFile, fontConfig]);

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
      onDataRef.current(name, formattedPaths);
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
      onDataRef.current(name, formattedPaths);
    }
  };

  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "c"
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

  const saveTerminalState = () => {
    if (isTerminalClosingRef.current(name)) return;
    try {
      const mouseTracking = wtermRef.current?.bridge?.mouseTracking?.();
      if (mouseTracking !== undefined) {
        mouseModeRef.current = mouseTracking !== 0;
      }
      localStorage.setItem(`terminal:data:${name}`, savedSnapshotRef.current);
      localStorage.setItem(`terminal:mouseMode:${name}`, mouseModeRef.current.toString());
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
    const snapshot = savedSnapshotRef.current || localStorage.getItem(`terminal:data:${name}`) || "";
    savedSnapshotRef.current = snapshot;

    isRestoringRef.current = true;
    try {
      if (snapshot) {
        terminal.write(snapshot);
      }

      const savedMouseMode = localStorage.getItem(`terminal:mouseMode:${name}`);
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

    cleanupMessage = onMessage(name, handler);

    const themeObserver = new MutationObserver(() => {
      if (terminalRef.current) {
        applyTerminalTheme(terminalRef.current);
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
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
            onDataRef.current(name, data);
          },
          onResize: (nextCols, nextRows) => {
            if (terminalRef.current) {
              syncTerminalBottomPad(terminalRef.current, terminal);
            }
            onResizeRef.current(name, nextCols, nextRows);
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

        terminal.fit();
        if (terminalRef.current) {
          syncTerminalBottomPad(terminalRef.current, terminal);
          wasContainerVisibleRef.current =
            terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0;
          restoreTerminalScroll(terminal, terminalRef.current);
        }
        onResizeRef.current(name, terminal.cols, terminal.rows);

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
      if (isTerminalClosingRef.current(name)) {
        localStorage.removeItem(`terminal:data:${name}`);
        localStorage.removeItem(`terminal:mouseMode:${name}`);
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
  }, [isConnected, name, onMessage]);

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

  return (
    <div
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
        backgroundColor: "var(--background-color, var(--theme-background, #242424))",
        color: "var(--foreground-color, var(--theme-foreground, #f0f0f0))",
        position: "relative",
      }}
    >
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

