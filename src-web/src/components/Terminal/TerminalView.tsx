import React, { useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { sshService } from "../../services/sshService";
import { agentService } from "../../services/agentService";
import { useToastStore } from "../shared/Toast";
import { getTerminalTheme } from "../../utils/terminalTheme";
import { highlightTerminalChunk } from "../../utils/terminalHighlight";
import { formatError } from "../../utils/error";
import type { SshDataEvent, SshStatusEvent } from "../../types/bindings";

export interface TerminalTab {
  id: string;
  kind: "ssh" | "agent";
  profileId: string;
  title: string;
  disconnected?: boolean;
}

interface TerminalViewProps {
  tab: TerminalTab;
  /** 断线重连时用来重新 cd 进同一个目录。*/
  cwd?: string;
  /** 断线/重连事件默认回调——远程工具模式用独立的 `remoteSessionStore`，传这两个
   * 回调覆盖默认行为。*/
  onDisconnected?: (id: string) => void;
  onReconnect?: (id: string, cwd?: string) => void;
  /** 每次用户在这个终端里敲字符都会额外调一次——多路执行模式用它把输入转发给
   * 其它终端。*/
  onInput?: (id: string, data: Uint8Array) => void;
}

/**
 * 终端渲染，原样搬自宿主 `src-web/src/components/Terminal/TerminalView.tsx`，
 * 但去掉了 "local"（本地 PTY）这一种 Tab kind——宿主版本 SSH/Agent/本地 PTY 三种
 * Tab 共用同一个组件，本地终端属于 `roc_desk-workspace` 工具的范畴（本地工作区
 * 概念、`ptyService`），这个工具没有搬那部分，也没有本地终端入口会传入
 * `kind: "local"`，所以直接去掉了那个分支，不留一个永远走不到的死代码路径。
 */
export const TerminalView: React.FC<TerminalViewProps> = ({ tab, cwd, onDisconnected, onReconnect, onInput }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  const writeToBackend = (data: Uint8Array) =>
    tab.kind === "ssh" ? sshService.write(tab.profileId, tab.id, data) : agentService.write(tab.profileId, tab.id, data);

  const copySelectionToClipboard = (): boolean => {
    const text = termRef.current?.getSelection();
    if (!text) return false;
    navigator.clipboard.writeText(text).catch(() => {});
    termRef.current?.clearSelection();
    return true;
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) await writeToBackend(new TextEncoder().encode(text));
    } catch {
      // 剪贴板读取失败静默忽略，不用错误 toast 打断用户正在敲的命令。
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const write = writeToBackend;
    const resize = (rows: number, cols: number) =>
      tab.kind === "ssh" ? sshService.resize(tab.profileId, tab.id, rows, cols) : agentService.resize(tab.profileId, tab.id, rows, cols);
    const dataEvent = tab.kind === "ssh" ? "ssh:data" : "agent:data";
    const statusEvent = tab.kind === "ssh" ? "ssh:status" : "agent:status";

    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 14,
      fontWeight: "400",
      fontWeightBold: "600",
      lineHeight: 1.22,
      letterSpacing: 0.15,
      theme: getTerminalTheme(tab.kind),
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // CMD 的 QuickEdit 模式：选中文本后按 Enter 是"复制"，不是"提交这行命令"。
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.key === "Enter" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (copySelectionToClipboard()) return false;
      }
      return true;
    });

    const onDataDisposable = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      write(bytes);
      onInput?.(tab.id, bytes);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      resize(term.rows, term.cols);
    });
    resizeObserver.observe(containerRef.current);

    const decoder = new TextDecoder();
    const unlistenDataPromise = listen<SshDataEvent>(dataEvent, (event) => {
      if (event.payload.channelId !== tab.id) return;
      const text = decoder.decode(new Uint8Array(event.payload.data), { stream: true });
      term.write(highlightTerminalChunk(text));
    });

    const unlistenStatusPromise = listen<SshStatusEvent>(statusEvent, (event) => {
      if (event.payload.channelId !== tab.id) return;
      if (event.payload.status === "disconnected") {
        term.write("\r\n\x1b[31m[连接已断开]\x1b[0m\r\n");
        onDisconnected?.(tab.id);
      }
    });

    return () => {
      onDataDisposable.dispose();
      resizeObserver.disconnect();
      unlistenDataPromise.then((unlisten) => unlisten());
      unlistenStatusPromise.then((unlisten) => unlisten());
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.kind, tab.profileId, onDisconnected, onInput]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* 背景色必须和 terminalTheme.ts 里 Dracula 主题的 background 完全一致——终端
          画布固定深色，不随应用亮/暗切换（用户确认过维持这个设计）。*/}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", padding: 8, background: "#282A36" }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!copySelectionToClipboard()) void pasteFromClipboard();
        }}
        onDoubleClick={() => {
          if (!termRef.current?.hasSelection()) void pasteFromClipboard();
        }}
      />
      {tab.disconnected && (
        <div className="terminal-disconnected-overlay">
          <button
            className="btn primary sm"
            onClick={() => {
              if (!onReconnect) return;
              Promise.resolve(onReconnect(tab.id, cwd)).catch((e) => {
                useToastStore.getState().push("error", `重新连接失败：${formatError(e)}`);
              });
            }}
          >
            <RefreshCw style={{ width: 14, height: 14 }} /> 重新连接
          </button>
        </div>
      )}
    </div>
  );
};
