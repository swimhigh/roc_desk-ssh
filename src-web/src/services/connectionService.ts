import { invoke } from "@tauri-apps/api/core";
import type { ConnectionGroup, ConnectionProfile, ConnectionProfileInput } from "../types/bindings";

export const connectionService = {
  list(groupId?: string | null): Promise<ConnectionProfile[]> {
    return invoke("connection_list", { groupId: groupId ?? null });
  },
  create(input: ConnectionProfileInput): Promise<ConnectionProfile> {
    return invoke("connection_create", { input });
  },
  update(id: string, input: ConnectionProfileInput): Promise<ConnectionProfile> {
    return invoke("connection_update", { id, input });
  },
  delete(id: string): Promise<void> {
    return invoke("connection_delete", { id });
  },
  groupList(): Promise<ConnectionGroup[]> {
    return invoke("connection_group_list");
  },
};
