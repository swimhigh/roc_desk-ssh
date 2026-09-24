import { create } from "zustand";
import { sftpService } from "../services/sftpService";
import { formatError } from "../utils/error";
import type { FileEntry } from "../types/bindings";

interface SftpState {
  cwd: string;
  entries: FileEntry[];
  loading: boolean;
  selectedPath: string | null;
  error: string | null;

  navigate: (profileId: string, path: string) => Promise<void>;
  select: (path: string | null) => void;
}

/** SFTP 自由浏览快捷工具的状态，原样搬自宿主 `src-web/src/stores/sftpStore.ts`。 */
export const useSftpStore = create<SftpState>((set) => ({
  cwd: "/",
  entries: [],
  loading: false,
  selectedPath: null,
  error: null,

  navigate: async (profileId, path) => {
    set({ loading: true, error: null });
    try {
      const entries = await sftpService.listDir(profileId, path);
      set({ cwd: path, entries, loading: false, selectedPath: null });
    } catch (e) {
      set({ loading: false, error: formatError(e) });
    }
  },

  select: (path) => set({ selectedPath: path }),
}));
