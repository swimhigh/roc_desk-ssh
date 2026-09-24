import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "../types/bindings";

/**
 * SFTP/Agent 双栏浏览器的本地一侧。只封装这个工具的后端实际导出的四个 `local_*`
 * 命令（`local_list_dir`/`local_home_dir`/`local_is_dir`/`local_delete`，见
 * `lib/src/lib.rs` cmd 模块顶部注释）——宿主原版 `localFsService.ts` 还有
 * `listDrives`/`rename`/`copy`/`move`/`createDir`，那些是资源管理器（Total
 * Commander 式双栏）的操作，这个工具的双栏浏览器右键菜单里没有这几项，没有
 * 对应后端命令，故意不在这里声明（调用了也只会是运行时 "command not found"）。
 */
export const localFsService = {
  listDir(path: string): Promise<FileEntry[]> {
    return invoke("local_list_dir", { path });
  },
  homeDir(): Promise<string> {
    return invoke("local_home_dir");
  },
  /** 从外部拖真实文件进来时用——判断是文件还是目录，决定走单文件还是整目录上传。*/
  isDir(path: string): Promise<boolean> {
    return invoke("local_is_dir", { path });
  },
  deletePath(path: string, isDir: boolean): Promise<void> {
    return invoke("local_delete", { path, isDir });
  },
};
