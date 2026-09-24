import React, { useCallback, useEffect, useRef, useState } from "react";
import { MonitorX } from "lucide-react";
import { rdpService, type PanelBounds, type RdpStatus } from "../../services/rdpService";
import { formatError } from "../../utils/error";
import type { ConnectionProfile } from "../../types/bindings";

interface RdpViewProps {
  profile: ConnectionProfile;
  /** 对应这个会话标签是不是当前激活的那个——内嵌窗口是操作系统级别的原生窗口，
   * 不受 CSS display 影响，标签切走/切回必须显式调 rdp_hide/rdp_show。*/
  visible: boolean;
}

type ViewStatus = "connecting" | "connected" | "error";

/**
 * RDP 远程桌面，原样搬自宿主 `src-web/src/components/RemoteTool/RdpView.tsx`：
 * 不自己渲染画面——后端拉起 wfreerdp.exe（FreeRDP）并把它的窗口叠在这个组件占位
 * div 的屏幕区域上。这个组件本身只负责：量测占位区域的屏幕坐标告诉后端摆哪、
 * 标签切换时显式隐藏/显示、卸载时断开，以及把后端报上来的真实连接状态显示出来。
 */
export const RdpView: React.FC<RdpViewProps> = ({ profile, visible }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<ViewStatus>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);

  const readBounds = useCallback((): PanelBounds | null => {
    const el = viewportRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const bounds = readBounds();
      if (!bounds) {
        setStatus("error");
        setMessage("面板尚未就绪，请重新打开这个会话");
        return;
      }
      try {
        const id = await rdpService.connect(profile.id, bounds);
        if (cancelled) {
          void rdpService.disconnect(id);
          return;
        }
        sessionIdRef.current = id;
        setSessionId(id);
        if (visible) void rdpService.show(id, bounds);
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setMessage(formatError(e));
        }
      }
    };
    void setup();

    return () => {
      cancelled = true;
      if (sessionIdRef.current) void rdpService.disconnect(sessionIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  useEffect(() => {
    if (!sessionId) return;
    const apply = (result: RdpStatus) => {
      setDiagnostics(result.diagnostics);
      if (result.state === "connected") {
        setStatus("connected");
        setMessage(null);
      } else if (result.state === "error" || result.state === "disconnected") {
        setStatus("error");
        setMessage(`RDP 连接已断开${result.reason ? `（错误码 ${result.reason}）` : ""}`);
      }
    };
    const timer = window.setInterval(() => {
      void rdpService.status(sessionId).then(apply).catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  useEffect(() => {
    const id = sessionIdRef.current;
    if (!id) return;
    if (visible) {
      const bounds = readBounds();
      if (bounds) void rdpService.show(id, bounds);
    } else {
      void rdpService.hide(id);
    }
  }, [visible, readBounds]);

  useEffect(() => {
    if (!visible) return;
    const el = viewportRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const id = sessionIdRef.current;
        if (!id) return;
        const bounds = readBounds();
        if (bounds) void rdpService.setBounds(id, bounds);
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [visible, readBounds]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {status !== "connected" && (
        <div
          className="remote-session-empty"
          style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "10px 14px", flex: "0 0 auto" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MonitorX style={{ width: 18, height: 18, color: "var(--text-disabled)" }} />
            <span>
              {status === "connecting" ? "正在连接远程桌面…" : `连接失败：${message ?? "未知错误"}`}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-disabled)" }}>
              {profile.username}@{profile.host}:{profile.port}
            </span>
          </div>
          {diagnostics && (
            <div style={{ fontSize: 11, color: "var(--text-disabled)", fontFamily: "Consolas, monospace", wordBreak: "break-all" }}>
              {diagnostics}
            </div>
          )}
        </div>
      )}
      {status === "connected" && diagnostics && (
        <div
          style={{
            flex: "0 0 auto",
            padding: "2px 10px",
            fontSize: 10,
            color: "var(--text-disabled)",
            fontFamily: "Consolas, monospace",
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border-color, rgba(255,255,255,0.08))",
          }}
        >
          {diagnostics}
        </div>
      )}
      <div ref={viewportRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
};
