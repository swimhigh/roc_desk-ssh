import { create } from "zustand";
import { connectionService } from "../services/connectionService";
import { connectionGroupService } from "../services/connectionGroupService";
import type { ConnectionGroup, ConnectionGroupInput, ConnectionProfile, ConnectionProfileInput } from "../types/bindings";

const EXPANDED_STORAGE_KEY = "roc_desk-session-tree-expanded";

function loadExpanded(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPANDED_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<string>) {
  localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(expanded)));
}

interface SessionTreeState {
  groups: ConnectionGroup[];
  connections: ConnectionProfile[];
  loading: boolean;
  expanded: Set<string>;

  load: () => Promise<void>;
  toggleExpanded: (groupId: string) => void;

  createGroup: (input: ConnectionGroupInput) => Promise<ConnectionGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  moveGroup: (id: string, parentId: string | null) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  createConnection: (input: ConnectionProfileInput) => Promise<ConnectionProfile>;
  updateConnection: (id: string, input: ConnectionProfileInput) => Promise<ConnectionProfile>;
  deleteConnection: (id: string) => Promise<void>;
}

/**
 * 会话树的数据源，原样搬自宿主 `src-web/src/stores/sessionTreeStore.ts`：分组+
 * 连接档案的扁平列表，树形结构由组件按 `parent_id`/`group_id` 在渲染时组装。
 */
export const useSessionTreeStore = create<SessionTreeState>((set, get) => ({
  groups: [],
  connections: [],
  loading: false,
  expanded: loadExpanded(),

  load: async () => {
    set({ loading: true });
    try {
      const [groups, connections] = await Promise.all([connectionGroupService.list(), connectionService.list()]);
      set({ groups, connections, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  toggleExpanded: (groupId) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      if (expanded.has(groupId)) expanded.delete(groupId);
      else expanded.add(groupId);
      saveExpanded(expanded);
      return { expanded };
    }),

  createGroup: async (input) => {
    const group = await connectionGroupService.create(input);
    set((s) => ({ groups: [...s.groups, group] }));
    return group;
  },

  renameGroup: async (id, name) => {
    const existing = get().groups.find((g) => g.id === id);
    if (!existing) return;
    const updated = await connectionGroupService.update(id, { name, parent_id: existing.parent_id });
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? updated : g)) }));
  },

  moveGroup: async (id, parentId) => {
    const existing = get().groups.find((g) => g.id === id);
    if (!existing) return;
    const updated = await connectionGroupService.update(id, { name: existing.name, parent_id: parentId });
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? updated : g)) }));
  },

  deleteGroup: async (id) => {
    await connectionGroupService.delete(id);
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id).map((g) => (g.parent_id === id ? { ...g, parent_id: null } : g)),
      connections: s.connections.map((c) => (c.group_id === id ? { ...c, group_id: null } : c)),
    }));
  },

  createConnection: async (input) => {
    const profile = await connectionService.create(input);
    set((s) => ({ connections: [...s.connections, profile] }));
    return profile;
  },

  updateConnection: async (id, input) => {
    const profile = await connectionService.update(id, input);
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? profile : c)) }));
    return profile;
  },

  deleteConnection: async (id) => {
    await connectionService.delete(id);
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
  },
}));
