import { invoke } from "@tauri-apps/api/core";
import type { ConnectionGroup, ConnectionGroupInput } from "../types/bindings";

/** 原样搬自宿主 `src-web/src/services/connectionGroupService.ts`（现有
 * `connectionService.groupList()` 只覆盖了列表读取，会话树的分组增删改还是需要
 * 这个独立的服务模块，和宿主保持同样的模块划分）。*/
export const connectionGroupService = {
  list(): Promise<ConnectionGroup[]> {
    return invoke("connection_group_list");
  },
  create(input: ConnectionGroupInput): Promise<ConnectionGroup> {
    return invoke("connection_group_create", { input });
  },
  update(id: string, input: ConnectionGroupInput): Promise<ConnectionGroup> {
    return invoke("connection_group_update", { id, input });
  },
  delete(id: string): Promise<void> {
    return invoke("connection_group_delete", { id });
  },
};
