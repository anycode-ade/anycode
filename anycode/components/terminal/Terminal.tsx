import React, { useEffect, useRef } from "react";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "./Terminal.css";
import "@xterm/xterm/css/xterm.css";

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
  onData: (name: string, data: string) => void;
  onMessage: (name: string, callback: (data: string) => void) => (() => void);
  onResize: (name: string, cols: number, rows: number) => void;
  rows: number;
  cols: number;
  isConnected: boolean;
}

const TERMINAL_DELAY_MS = 100;

const Terminal: React.FC<XTerminalProps> = ({
  name,
  onData,
  onMessage,
  onResize,
  rows,
  cols,
  isConnected,
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
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
  }, [onData, onResize]);

  const saveTerminalState = debounce(() => {
    if (!serializeAddonRef.current) return;
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
        fontWeight: "bold",
        scrollback: 10000,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        rightClickSelectsWord: true,
        allowTransparency: true,
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

      const rootStyles = getComputedStyle(document.documentElement);
      const panelBackground = rootStyles.getPropertyValue("--background-color").trim() || "#242424";
      terminal.options.theme = { background: panelBackground };

      requestAnimationFrame(() => {
        fitAddon.fit();
      });

      const resizeObserver = new ResizeObserver(() => {
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
      saveTerminalState();
      clearFitTimers();
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
    };
  }, [isConnected, name, onMessage]);

  useEffect(() => {
    if (!isConnected || !xtermRef.current) return;
    if (xtermRef.current.cols === cols && xtermRef.current.rows === rows) return;
    xtermRef.current.resize(cols, rows);
  }, [isConnected, cols, rows]);

  return (
    <div
      ref={terminalRef}
      style={{
        width: "100%",
        height: "100%",
        color: "white",
        position: "relative",
      }}
    >
      {!isConnected && <div className="terminal-disconnected">Disconnected</div>}
    </div>
  );
};

export default React.memo(Terminal);
