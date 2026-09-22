// Minimal hand-written IPC binding types for the standalone SSH/SFTP tool.
// Kept intentionally small -- only the shapes actually used by this
// standalone frontend, not a full port of the host's generated bindings.

export type AuthMethod = "password" | "key" | "agent";
export type Protocol = "ssh" | "rdp" | "agent";

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: AuthMethod;
  credential_ref: string | null;
  group_id: string | null;
  tags: string[];
  jump_host_id: string | null;
  protocol: Protocol;
  options: unknown;
  last_connected_at: string | null;
  created_at: string;
}

export interface ConnectionProfileInput {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: AuthMethod;
  secret: string | null;
  group_id: string | null;
  tags: string[];
  jump_host_id: string | null;
  protocol: Protocol;
  options: unknown;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number | null;
}

export interface FileContent {
  text: string;
  encoding: string;
  mtime: number;
  total_size: number;
  truncated: boolean;
}

export type WriteOutcome =
  | { type: "Written"; mtime: number }
  | { type: "Conflict"; current_mtime: number; current_preview: string };

export interface BinaryInfo {
  format: string;
  [key: string]: unknown;
}

export interface JarInfo {
  [key: string]: unknown;
}

export interface HostStats {
  cpu_percent: number | null;
  mem_total_kb: number | null;
  mem_available_kb: number | null;
  rx_bytes_per_sec: number | null;
  tx_bytes_per_sec: number | null;
  disks: DiskUsage[];
  sampled_at_ms: number;
}

export interface DiskUsage {
  mount: string;
  total_kb: number;
  used_kb: number;
}

export interface TransferLogEntry {
  id: string;
  protocol: string;
  direction: string;
  profile_id: string | null;
  profile_name: string;
  local_path: string;
  remote_path: string;
  is_dir: boolean;
  file_count: number;
  status: string;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  bytes_transferred: number | null;
  total_bytes: number | null;
}

export interface SftpTransferProgressEvent {
  requestId: string;
  path: string;
  bytes: number;
  totalBytes: number;
}
