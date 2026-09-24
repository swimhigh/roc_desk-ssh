import { create } from "zustand";
import { localFsService } from "../services/localFsService";
import { formatError } from "../utils/error";
import type { FileEntry } from "../types/bindings";

interface LocalFsState {
  cwd: string;
  entries: FileEntry[];
  loading: boolean;
  selectedPath: string | null;
  error: string | null;

  navigate: (path: string) => Promise<void>;
  select: (path: string | null) => void;
}

/** SFTP/Agent 双栏浏览器本地一侧的状态，原样搬自宿主 `src-web/src/stores/localFsStore.ts`。*/
export const useLocalFsStore = create<LocalFsState>((set) => ({
  cwd: "",
  entries: [],
  loading: false,
  selectedPath: null,
  error: null,

  navigate: async (path) => {
    set({ loading: true, error: null });
    try {
      const entries = await localFsService.listDir(path);
      set({ cwd: path, entries, loading: false, selectedPath: null });
    } catch (e) {
      set({ loading: false, error: formatError(e) });
    }
  },

  select: (path) => set({ selectedPath: path }),
}));
