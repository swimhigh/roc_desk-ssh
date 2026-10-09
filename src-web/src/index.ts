/**
 * Public entry point for embedding a small slice of this tool's frontend in
 * another tool's frontend (e.g. `roc_desk-workspace`'s "连接远程主机并选择
 * 目录" dialog). Import from `@roc_desk/tool-ssh` (this package) rather than
 * reaching into `src/components/*`/`src/services/*` directly.
 *
 * This barrel deliberately exports only what that one flow needs -- not the
 * whole SSH tool's UI (terminal/RDP/SFTP dual-pane browser/transfer log
 * etc. stay un-exported). See `docs/MULTI_REPO_SPLIT_PROGRESS.md`'s
 * "独立版对齐 roc_desk.exe" phase 2 notes for why.
 */

export { ConnectionForm } from "./components/ConnectionManager/ConnectionForm";
export type { ConnectionFormValue, AuthMethod } from "./components/ConnectionManager/ConnectionForm";

export { connectionService } from "./services/connectionService";
export { connectionGroupService } from "./services/connectionGroupService";
export { sftpService } from "./services/sftpService";
export { agentService } from "./services/agentService";
export { sshService } from "./services/sshService";

/** Interactive terminal (SSH/Agent only -- no "local" kind, see the
 * component's own doc comment) for a remote workspace's "终端" tab. */
export { TerminalView } from "./components/Terminal/TerminalView";
export type { TerminalTab } from "./components/Terminal/TerminalView";

/**
 * Host-key / Agent-cert TOFU trust prompts -- mount `<HostKeyPromptHost/>`
 * and `<AgentCertPromptHost/>` once near the embedder's app root and call
 * both `register*Listener()` functions on startup, or a first-time SSH/
 * Agent connection from `ConnectionForm`/`sftpService`/`agentService` above
 * will hang forever waiting for a trust decision nothing is listening for.
 */
export { HostKeyPromptHost } from "./components/ConnectionManager/HostKeyPromptHost";
export { AgentCertPromptHost } from "./components/ConnectionManager/AgentCertPromptHost";
export { registerHostKeyPromptListener, registerAgentCertPromptListener } from "./stores/connectionStore";

export * from "./types/bindings";
