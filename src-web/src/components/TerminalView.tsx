import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { sshService } from "../services/sshService";

interface SshDataEvent {
  channelId: string;
  data: number[];
}
interface SshStatusEvent {
  channelId: string;
  status: "connected" | "connecting" | "disconnected" | "error";
}

interface TerminalViewProps {
  profileId: string;
  channelId: string;
}

/**
 * Minimal xterm.js terminal for the standalone SSH tool -- ported down from
 * the host's `components/Terminal/TerminalView.tsx` (theme store, syntax
 * highlighting, multi-exec fan-out, PTY/Agent tab kinds, reconnect-overlay
 * store wiring all dropped; this only needs the SSH data/status event pair).
 */
export function TerminalView({ profileId, channelId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 14,
      theme: { background: "#282a36", foreground: "#f8f8f2" },
      cursorBlink: true,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const onDataDisposable = term.onData((data) => {
      sshService.write(profileId, channelId, new TextEncoder().encode(data));
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sshService.resize(profileId, channelId, term.rows, term.cols);
    });
    resizeObserver.observe(containerRef.current);

    const decoder = new TextDecoder();
    const unlistenData = listen<SshDataEvent>("ssh:data", (event) => {
      if (event.payload.channelId !== channelId) return;
      term.write(decoder.decode(new Uint8Array(event.payload.data), { stream: true }));
    });
    const unlistenStatus = listen<SshStatusEvent>("ssh:status", (event) => {
      if (event.payload.channelId !== channelId) return;
      if (event.payload.status === "disconnected") {
        term.write("\r\n\x1b[31m[连接已断开]\x1b[0m\r\n");
      }
    });

    return () => {
      onDataDisposable.dispose();
      resizeObserver.disconnect();
      unlistenData.then((f) => f());
      unlistenStatus.then((f) => f());
      term.dispose();
    };
  }, [profileId, channelId]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", padding: 8, background: "#282a36" }} />;
}
