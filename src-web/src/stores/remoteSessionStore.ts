import { create } from "zustand";
import { sshService } from "../services/sshService";
import { agentService } from "../services/agentService";
import type { ConnectionProfile } from "../types/bindings";

export type RemoteSessionTab =
  | { id: string; kind: "ssh-terminal"; profileId: string; title: string; disconnected?: boolean }
  | { id: string; kind: "agent-terminal"; profileId: string; title: string; disconnected?: boolean }
  | { id: string; kind: "sftp"; profileId: string; title: string }
  | { id: string; kind: "agent-browse"; profileId: string; title: string }
  | { id: string; kind: "rdp"; profileId: string; title: string };

function isTerminalTab(tab: RemoteSessionTab): tab is Extract<RemoteSessionTab, { kind: "ssh-terminal" | "agent-terminal" }> {
  return tab.kind === "ssh-terminal" || tab.kind === "agent-terminal";
}

interface RemoteSessionState {
  tabs: RemoteSessionTab[];
  activeId: string | null;
  /** 多路执行模式（参考 MobaXterm 的 MultiExec）：开着的时候，任意一个未被排除的
   * SSH 终端里敲的字符会广播给其它所有未被排除的 SSH 终端。 */
  multiExecEnabled: boolean;
  multiExecExcluded: Set<string>;

  openSshTerminal: (profile: ConnectionProfile) => Promise<string>;
  openAgentTerminal: (profile: ConnectionProfile) => Promise<string>;
  openSftp: (profile: ConnectionProfile) => string;
  openAgentBrowse: (profile: ConnectionProfile) => string;
  openRdp: (profile: ConnectionProfile) => string;
  closeTab: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  markDisconnected: (id: string) => void;
  reconnectSshTerminal: (id: string) => Promise<void>;
  reconnectAgentTerminal: (id: string) => Promise<void>;
  toggleMultiExec: () => void;
  toggleExcludedFromMultiExec: (id: string) => void;
  broadcastInput: (sourceTabId: string, data: Uint8Array) => void;
  reset: () => void;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

/**
 * 远程工具模式的会话标签状态，原样搬自宿主 `src-web/src/stores/remoteSessionStore.ts`。
 * 总是新开一个标签（不做"同一个连接已经开过就复用"的去重）——用户点几次就要几个
 * 独立标签，SSH 场景下"多开一个终端到同一台机器"是常见操作。
 */
export const useRemoteSessionStore = create<RemoteSessionState>((set, get) => ({
  tabs: [],
  activeId: null,
  multiExecEnabled: false,
  multiExecExcluded: new Set(),

  openSshTerminal: async (profile) => {
    await sshService.connect(profile.id);
    const count = get().tabs.filter((t) => t.kind === "ssh-terminal" && t.profileId === profile.id).length;
    const channelId = await sshService.openShell(profile.id, 24, 80);
    const tab: RemoteSessionTab = {
      id: channelId,
      kind: "ssh-terminal",
      profileId: profile.id,
      title: count > 0 ? `${profile.name} (${count + 1})` : profile.name,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: channelId }));
    return channelId;
  },

  openAgentTerminal: async (profile) => {
    const count = get().tabs.filter((t) => t.kind === "agent-terminal" && t.profileId === profile.id).length;
    const channelId = await agentService.openShell(profile.id, 24, 80);
    const tab: RemoteSessionTab = {
      id: channelId,
      kind: "agent-terminal",
      profileId: profile.id,
      title: count > 0 ? `${profile.name} (${count + 1})` : profile.name,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: channelId }));
    return channelId;
  },

  openSftp: (profile) => {
    const id = nextId("sftp");
    const tab: RemoteSessionTab = { id, kind: "sftp", profileId: profile.id, title: `${profile.name} · SFTP` };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    return id;
  },

  openAgentBrowse: (profile) => {
    const id = nextId("agent-browse");
    const tab: RemoteSessionTab = { id, kind: "agent-browse", profileId: profile.id, title: `${profile.name} · 文件传输` };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    return id;
  },

  openRdp: (profile) => {
    const id = nextId("rdp");
    const tab: RemoteSessionTab = { id, kind: "rdp", profileId: profile.id, title: `${profile.name} · RDP` };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    return id;
  },

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId = s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId;
      return { tabs, activeId };
    });
    if (tab.kind === "ssh-terminal") {
      try {
        await sshService.closeChannel(tab.profileId, id);
      } catch (e) {
        console.error("关闭终端失败", e);
      }
    } else if (tab.kind === "agent-terminal") {
      try {
        await agentService.closeChannel(tab.profileId, id);
      } catch (e) {
        console.error("关闭终端失败", e);
      }
    }
  },

  setActive: (id) => set({ activeId: id }),

  markDisconnected: (id) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && isTerminalTab(t) ? { ...t, disconnected: true } : t)) })),

  reconnectSshTerminal: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.kind !== "ssh-terminal") return;
    const newChannelId = await sshService.openShell(tab.profileId, 24, 80);
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, id: newChannelId, disconnected: false } : t)),
      activeId: s.activeId === id ? newChannelId : s.activeId,
    }));
  },

  reconnectAgentTerminal: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.kind !== "agent-terminal") return;
    const newChannelId = await agentService.openShell(tab.profileId, 24, 80);
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, id: newChannelId, disconnected: false } : t)),
      activeId: s.activeId === id ? newChannelId : s.activeId,
    }));
  },

  toggleMultiExec: () => set((s) => ({ multiExecEnabled: !s.multiExecEnabled })),

  toggleExcludedFromMultiExec: (id) =>
    set((s) => {
      const excluded = new Set(s.multiExecExcluded);
      if (excluded.has(id)) excluded.delete(id);
      else excluded.add(id);
      return { multiExecExcluded: excluded };
    }),

  broadcastInput: (sourceTabId, data) => {
    const { tabs, multiExecEnabled, multiExecExcluded } = get();
    if (!multiExecEnabled) return;
    for (const tab of tabs) {
      if (tab.kind !== "ssh-terminal") continue;
      if (tab.id === sourceTabId || tab.disconnected) continue;
      if (multiExecExcluded.has(tab.id)) continue;
      void sshService.write(tab.profileId, tab.id, data);
    }
  },

  reset: () => set({ tabs: [], activeId: null, multiExecEnabled: false, multiExecExcluded: new Set() }),
}));
