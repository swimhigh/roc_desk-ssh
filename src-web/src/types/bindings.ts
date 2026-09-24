// Hand-written IPC binding types for the SSH/SFTP/RDP/Agent standalone tool.
// Field names/shapes are cross-checked against the actual Rust structs in
// `lib/src/connection/*.rs`, `lib/src/ssh/monitor.rs`, and
// `roc_desk_common::fsops` (via `crate::fsops` re-exports) -- see
// `docs/MULTI_REPO_SPLIT_PROGRESS.md` 2026-09-23 restoration pass notes.

export type AppErrorKind =
  | "Connection"
  | "Auth"
  | "HostKeyRejected"
  | "PermissionDenied"
  | "NotFound"
  | "Database"
  | "Conflict"
  | "Internal";

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

export type AuthMethod = "password" | "key" | "agent";
/** "agent" 是远程 Windows Agent 协议——和上面 AuthMethod 里的 "agent"（SSH Agent
 * 认证）是两个不相关的概念，只是恰好同名，注意区分。 */
export type Protocol = "ssh" | "rdp" | "agent";

/** RDP 专属的少量额外字段，存在 ConnectionProfile.options 里（JSON，见后端
 * connection/profile.rs 注释）；SSH/Agent 连接的 options 一般是 null。 */
export interface RdpOptions {
  domain?: string;
  width?: number;
  height?: number;
  color_depth?: number;
}

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
  options: RdpOptions | null;
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
  options: RdpOptions | null;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface ConnectionGroupInput {
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

/** 远程主机资源使用率原始采样——只有累计计数器，CPU%/网速由前端拿相邻两次
 * 采样自己算差（后端 ssh/monitor.rs 顶部注释解释了为什么不在后端做）。 */
export interface HostStats {
  hostname: string;
  uptime_seconds: number;
  cpu_total: number;
  cpu_idle: number;
  mem_total_kb: number;
  mem_available_kb: number;
  net_rx_bytes: number;
  net_tx_bytes: number;
  disks: DiskUsage[];
  sampled_at_ms: number;
}

export interface DiskUsage {
  mount: string;
  total_kb: number;
  used_kb: number;
  used_percent: number;
}

export interface HostKeyPromptEvent {
  requestId: string;
  host: string;
  port: number;
  fingerprint: string;
  changed: boolean;
  oldFingerprint: string | null;
}

/** Agent TLS 证书指纹 TOFU 弹窗，和上面的 SSH 主机指纹弹窗结构几乎一样，多一个
 * connectionId 字段——指纹按连接档案而不是 host/port 存。 */
export interface AgentCertPromptEvent {
  requestId: string;
  connectionId: string;
  host: string;
  port: number;
  fingerprint: string;
  changed: boolean;
  oldFingerprint: string | null;
}

export interface SshDataEvent {
  channelId: string;
  data: number[]; // 字节数组，前端转 Uint8Array 后交给 xterm.js
}

export interface SshStatusEvent {
  channelId: string;
  status: "connected" | "connecting" | "disconnected" | "error";
}

export interface SftpTransferProgressEvent {
  requestId: string;
  path: string;
  bytes: number;
  totalBytes: number;
}

export interface TransferLogEntry {
  id: string;
  protocol: "sftp" | "agent";
  direction: "upload" | "download";
  profile_id: string | null;
  profile_name: string;
  local_path: string;
  remote_path: string;
  is_dir: boolean;
  file_count: number;
  status: "completed" | "cancelled" | "failed";
  error_message: string | null;
  started_at: string;
  finished_at: string;
  bytes_transferred: number | null;
  total_bytes: number | null;
}
