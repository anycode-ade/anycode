import React, { useEffect, useRef } from "react";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "./Terminal.css";
import "@xterm/xterm/css/xterm.css";
import { resolveFontFamily, type FontConfig } from "../../hooks/useSettings";

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => func(...args), wait);
  };
}

interface XTerminalProps {
  name: string;
  focusRequestToken: number | null;
  onData: (name: string, data: string) => void;
  onMessage: (name: string, callback: (data: string) => void) => (() => void);
  onResize: (name: string, cols: number, rows: number) => void;
  isTerminalClosing: (name: string) => boolean;
  rows: number;
  cols: number;
  isConnected: boolean;
  onUploadFile: (file: File) => Promise<string | null>;
  fontConfig: FontConfig;
}

const TERMINAL_DELAY_MS = 100;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const getTerminalTheme = () => {
  const rootStyles = getComputedStyle(document.documentElement);
  const background =
    rootStyles.getPropertyValue("--background-color").trim() ||
    rootStyles.getPropertyValue("--theme-background").trim() ||
    "#242424";
  const foreground =
    rootStyles.getPropertyValue("--foreground-color").trim() ||
    rootStyles.getPropertyValue("--theme-foreground").trim() ||
    "#f0f0f0";

  return {
    background,
    foreground,
    cursor: foreground,
    selectionBackground: rootStyles.getPropertyValue("--theme-accent-background").trim() || "#458588",
  };
};

const applyTerminalTheme = (terminal: XTermTerminal) => {
  terminal.options.theme = getTerminalTheme();
};

const Terminal: React.FC<XTerminalProps> = ({
  name,
  focusRequestToken,
  onData,
  onMessage,
  onResize,
  isTerminalClosing,
  rows,
  cols,
  isConnected,
  onUploadFile,
  fontConfig,
}) => {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTermTerminal | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const savedSnapshotRef = useRef<string>("");
  const mouseModeRef = useRef<boolean>(false);
  const resizeRafRef = useRef<number | null>(null);
  const fitDebounceTimerRef = useRef<number | null>(null);
  const saveSnapshotTimerRef = useRef<number | null>(null);
  const themeObserverRef = useRef<MutationObserver | null>(null);
  const didAutoFocusRef = useRef<boolean>(false);
  const wasContainerVisibleRef = useRef(false);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const isTerminalClosingRef = useRef(isTerminalClosing);
  const onUploadFileRef = useRef(onUploadFile);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
    isTerminalClosingRef.current = isTerminalClosing;
    onUploadFileRef.current = onUploadFile;
  }, [onData, onResize, isTerminalClosing, onUploadFile]);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(`File(s) too large. Maximum size allowed is 20MB. (Oversized: ${oversized.map(f => f.name).join(', ')})`);
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
      const formattedPaths = paths.map(p => `"${p}"`).join(' ');
      onDataRef.current(name, formattedPaths);
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }

    if (files.length === 0) return;

    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(`File(s) too large. Maximum size allowed is 20MB. (Oversized: ${oversized.map(f => f.name).join(', ')})`);
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
      const formattedPaths = paths.map(p => `"${p}"`).join(' ');
      onDataRef.current(name, formattedPaths);
    }
  };

  const saveTerminalState = debounce(() => {
    if (isTerminalClosingRef.current(name) || !serializeAddonRef.current) return;
    const snapshot = serializeAddonRef.current.serialize();
    savedSnapshotRef.current = snapshot;
    localStorage.setItem(`terminal:data:${name}`, snapshot);
    localStorage.setItem(`terminal:mouseMode:${name}`, mouseModeRef.current.toString());
  }, TERMINAL_DELAY_MS);

  const queueSnapshotSave = () => {
    if (saveSnapshotTimerRef.current !== null) {
      clearTimeout(saveSnapshotTimerRef.current);
    }
    saveSnapshotTimerRef.current = window.setTimeout(() => {
      saveSnapshotTimerRef.current = null;
      saveTerminalState();
    }, TERMINAL_DELAY_MS);
  };

  const restoreTerminalState = (terminal: XTermTerminal) => {
    const snapshot = savedSnapshotRef.current || localStorage.getItem(`terminal:data:${name}`);

    if (serializeAddonRef.current) {
      const currentState = serializeAddonRef.current.serialize();
      if (currentState === snapshot) return;
    }

    if (snapshot) {
      terminal.reset();
      terminal.write(snapshot);
      fitAddonRef.current?.fit();
    }

    const savedMouseMode = localStorage.getItem(`terminal:mouseMode:${name}`);
    if (savedMouseMode === "true") {
      mouseModeRef.current = true;
      terminal.write("\x1b[?1000h");
      terminal.write("\x1b[?1002h");
      terminal.write("\x1b[?1003h");
      terminal.write("\x1b[?1006h");
    }
  };

  useEffect(() => {
    let cleanupMessage: (() => void) | undefined;

    const clearFitTimers = () => {
      if (fitDebounceTimerRef.current !== null) {
        clearTimeout(fitDebounceTimerRef.current);
        fitDebounceTimerRef.current = null;
      }
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      if (saveSnapshotTimerRef.current !== null) {
        clearTimeout(saveSnapshotTimerRef.current);
        saveSnapshotTimerRef.current = null;
      }
    };

    if (!isConnected) {
      clearFitTimers();
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (themeObserverRef.current) {
        themeObserverRef.current.disconnect();
        themeObserverRef.current = null;
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      return;
    }

    if (!xtermRef.current) {
      const terminal = new XTermTerminal({
        cursorBlink: true,
        rows,
        cols,
        scrollback: 10000,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        rightClickSelectsWord: true,
        allowTransparency: true,
        fontFamily: resolveFontFamily(fontConfig),
        fontSize: fontConfig.size,
        fontWeight: fontConfig.weight,
        lineHeight: fontConfig.lineHeight,
      });

      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);

      const serializeAddon = new SerializeAddon();
      serializeAddonRef.current = serializeAddon;
      terminal.loadAddon(serializeAddon);

      if (terminalRef.current) {
        terminal.open(terminalRef.current);
      }
      xtermRef.current = terminal;

      applyTerminalTheme(terminal);

      const themeObserver = new MutationObserver(() => {
        applyTerminalTheme(terminal);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["style"],
      });
      themeObserverRef.current = themeObserver;

      requestAnimationFrame(() => {
        fitAddon.fit();
        if (!didAutoFocusRef.current) {
          didAutoFocusRef.current = true;
          terminal.focus();
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        const container = terminalRef.current;
        const isContainerVisible = Boolean(
          container && container.clientWidth > 0 && container.clientHeight > 0
        );

        if (!isContainerVisible) {
          wasContainerVisibleRef.current = false;
          return;
        }

        if (!wasContainerVisibleRef.current) {
          wasContainerVisibleRef.current = true;
          if (fitDebounceTimerRef.current !== null) {
            clearTimeout(fitDebounceTimerRef.current);
            fitDebounceTimerRef.current = null;
          }
          if (resizeRafRef.current !== null) {
            cancelAnimationFrame(resizeRafRef.current);
            resizeRafRef.current = null;
          }
          fitAddon.fit();
          return;
        }

        if (fitDebounceTimerRef.current !== null) {
          clearTimeout(fitDebounceTimerRef.current);
        }
        fitDebounceTimerRef.current = window.setTimeout(() => {
          fitDebounceTimerRef.current = null;
          if (resizeRafRef.current !== null) return;
          resizeRafRef.current = requestAnimationFrame(() => {
            resizeRafRef.current = null;
            fitAddon.fit();
          });
        }, TERMINAL_DELAY_MS);
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }
      resizeObserverRef.current = resizeObserver;

      restoreTerminalState(terminal);

      const handler = (data: string) => {
        terminal.write(data);
        queueSnapshotSave();

        if (
          data.includes("\x1b[?1000h") ||
          data.includes("\x1b[?1002h") ||
          data.includes("\x1b[?1003h") ||
          data.includes("\x1b[?1006h")
        ) {
          mouseModeRef.current = true;
          queueSnapshotSave();
        } else if (
          data.includes("\x1b[?1000l") ||
          data.includes("\x1b[?1002l") ||
          data.includes("\x1b[?1003l") ||
          data.includes("\x1b[?1006l")
        ) {
          mouseModeRef.current = false;
          queueSnapshotSave();
        }
      };

      cleanupMessage = onMessage(name, handler);

      terminal.onData((data) => {
        onDataRef.current(name, data);
        queueSnapshotSave();
      });

      terminal.onResize((size) => {
        onResizeRef.current(name, size.cols, size.rows);
      });
    }

    return () => {
      if (cleanupMessage) cleanupMessage();
      if (isTerminalClosingRef.current(name)) {
        localStorage.removeItem(`terminal:data:${name}`);
        localStorage.removeItem(`terminal:mouseMode:${name}`);
      } else {
        saveTerminalState();
      }
      clearFitTimers();
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      wasContainerVisibleRef.current = false;
      if (themeObserverRef.current) {
        themeObserverRef.current.disconnect();
        themeObserverRef.current = null;
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
    };
  }, [isConnected, name, onMessage]);

  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.fontFamily = resolveFontFamily(fontConfig);
    xtermRef.current.options.fontSize = fontConfig.size;
    xtermRef.current.options.fontWeight = fontConfig.weight;
    xtermRef.current.options.lineHeight = fontConfig.lineHeight;
    requestAnimationFrame(() => fitAddonRef.current?.fit());
  }, [fontConfig]);

  useEffect(() => {
    if (!isConnected || !xtermRef.current) return;
    if (xtermRef.current.cols === cols && xtermRef.current.rows === rows) return;
    xtermRef.current.resize(cols, rows);
  }, [isConnected, cols, rows]);

  useEffect(() => {
    if (focusRequestToken === null || !xtermRef.current) {
      return;
    }

    xtermRef.current.focus();
  }, [focusRequestToken]);

  return (
    <div
      ref={terminalRef}
      onPasteCapture={handlePaste}
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
      style={{
        width: "100%",
        height: "100%",
        color: "var(--foreground-color, var(--theme-foreground, #f0f0f0))",
        position: "relative",
      }}
    >
      {!isConnected && <div className="terminal-disconnected">Disconnected</div>}
    </div>
  );
};

export default React.memo(Terminal);
