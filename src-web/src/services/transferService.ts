import { invoke } from "@tauri-apps/api/core";
import type { TransferLogEntry } from "../types/bindings";

/** SFTP/Agent 双栏浏览器共用——"停止传输"和"传输历史查询"都是协议无关的命令。
 * 原样搬自宿主 `src-web/src/services/transferService.ts`。 */
export const transferService = {
  cancel(requestId: string): Promise<void> {
    return invoke("transfer_cancel", { requestId });
  },
  listLog(limit: number, offset: number, search?: string): Promise<TransferLogEntry[]> {
    return invoke("transfer_log_list", { limit, offset, search: search || null });
  },
  clearLog(): Promise<void> {
    return invoke("transfer_log_clear");
  },
};
