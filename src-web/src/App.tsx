import { useCallback, useEffect, useState } from "react";
import { connectionService } from "./services/connectionService";
import { sshService } from "./services/sshService";
import { TerminalView } from "./components/TerminalView";
import { SftpPanel } from "./components/SftpPanel";
import type { ConnectionProfile } from "./types/bindings";

type Tab =
  | { kind: "terminal"; id: string; profileId: string; profileName: string; channelId: string }
  | { kind: "sftp"; id: string; profileId: string; profileName: string };

interface NewConnectionForm {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
}

const emptyForm: NewConnectionForm = { name: "", host: "", port: "22", username: "root", password: "" };

export default function App() {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<NewConnectionForm>(emptyForm);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConnections(await connectionService.list());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addConnection = useCallback(async () => {
    if (!form.name.trim() || !form.host.trim()) {
      setError("名称和主机地址不能为空");
      return;
    }
    try {
      await connectionService.create({
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 22,
        username: form.username.trim(),
        auth_method: "password",
        secret: form.password || null,
        group_id: null,
        tags: [],
        jump_host_id: null,
        protocol: "ssh",
        options: null,
      });
      setForm(emptyForm);
      setShowAddForm(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [form, refresh]);

  const removeConnection = useCallback(
    async (id: string) => {
      try {
        await connectionService.delete(id);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const openTerminal = useCallback(async (profile: ConnectionProfile) => {
    setError(null);
    setConnecting(profile.id);
    try {
      await sshService.connect(profile.id);
      const channelId = await sshService.openShell(profile.id, 30, 100);
      const tab: Tab = { kind: "terminal", id: channelId, profileId: profile.id, profileName: profile.name, channelId };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(null);
    }
  }, []);

  const openSftp = useCallback(async (profile: ConnectionProfile) => {
    setError(null);
    setConnecting(profile.id);
    try {
      await sshService.connect(profile.id);
      const id = crypto.randomUUID();
      const tab: Tab = { kind: "sftp", id, profileId: profile.id, profileName: profile.name };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(null);
    }
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab?.kind === "terminal") {
        sshService.closeChannel(tab.profileId, tab.channelId).catch(() => {});
      }
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next);
      if (activeTabId === id) setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
    },
    [tabs, activeTabId],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif", color: "#e5e7eb" }}>
      <div style={{ width: 260, borderRight: "1px solid #374151", display: "flex", flexDirection: "column", background: "#111827" }}>
        <div style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #374151" }}>
          <strong>SSH / SFTP</strong>
          <button style={btn} onClick={() => setShowAddForm((v) => !v)}>
            + 新建
          </button>
        </div>

        {showAddForm && (
          <div style={{ padding: 10, borderBottom: "1px solid #374151", display: "flex", flexDirection: "column", gap: 6 }}>
            <input style={input} placeholder="连接名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input style={input} placeholder="主机地址" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            <input style={input} placeholder="端口" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            <input style={input} placeholder="用户名" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input
              style={input}
              placeholder="密码"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button style={{ ...btn, background: "#2563eb" }} onClick={addConnection}>
              保存
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto" }}>
          {connections.map((c) => (
            <div key={c.id} style={{ padding: "8px 10px", borderBottom: "1px solid #1f2937" }}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                {c.username}@{c.host}:{c.port}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button style={smallBtn} disabled={connecting === c.id} onClick={() => openTerminal(c)}>
                  终端
                </button>
                <button style={smallBtn} disabled={connecting === c.id} onClick={() => openSftp(c)}>
                  SFTP
                </button>
                <button style={{ ...smallBtn, color: "#f87171" }} onClick={() => removeConnection(c.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
          {connections.length === 0 && <div style={{ padding: 10, color: "#6b7280", fontSize: 13 }}>还没有连接，点击"+ 新建"添加一个。</div>}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #374151", background: "#111827" }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActiveTabId(t.id)}
              style={{
                padding: "8px 12px",
                borderRight: "1px solid #374151",
                cursor: "pointer",
                background: activeTabId === t.id ? "#1f2937" : "transparent",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>
                {t.kind === "terminal" ? "🖥️" : "📁"} {t.profileName}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                style={{ color: "#9ca3af" }}
              >
                ×
              </span>
            </div>
          ))}
        </div>

        {error && <div style={{ padding: "6px 12px", background: "#7f1d1d", color: "#fecaca" }}>{error}</div>}

        <div style={{ flex: 1, minHeight: 0 }}>
          {tabs.map((t) => (
            <div key={t.id} style={{ display: t.id === activeTabId ? "block" : "none", height: "100%" }}>
              {t.kind === "terminal" ? (
                <TerminalView profileId={t.profileId} channelId={t.channelId} />
              ) : (
                <SftpPanel profileId={t.profileId} />
              )}
            </div>
          ))}
          {!activeTab && (
            <div style={{ padding: 24, color: "#6b7280" }}>
              从左侧选择一个连接，打开终端或 SFTP。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#1f2937",
  color: "#e5e7eb",
  border: "1px solid #374151",
  borderRadius: 4,
  padding: "6px 10px",
  cursor: "pointer",
};
const smallBtn: React.CSSProperties = { ...btn, padding: "3px 8px", fontSize: 12 };
const input: React.CSSProperties = {
  background: "#0b1220",
  color: "#e5e7eb",
  border: "1px solid #374151",
  borderRadius: 4,
  padding: "6px 8px",
};
