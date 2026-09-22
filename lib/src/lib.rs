//! SSH/SFTP/Agent/RDP integration boundary.
//!
//! Ported from the host's `src-tauri/src/{ssh,rdp,agent,connection,fsops}` +
//! `commands/{ssh,sftp,rdp,agent,connection,connection_group,transfer}.rs`.
//! Host `AppState` dependencies were replaced by this crate's own
//! [`RocDeskSshAppState`] (constructed in `standalone/`), following the
//! precedent set by `roc_desk-sql`'s `SqlAppState` -- the host's
//! `ConnectionManager`/SQLite-backed connection profiles, known-hosts TOFU,
//! and transfer log are genuinely SSH/SFTP/Agent/RDP-specific state, not
//! generic enough to belong in `roc_desk_core` yet (see
//! `docs/MULTI_REPO_SPLIT_PLAN.md` for the split rationale).
//!
//! ## Migration status
//! - **SSH terminal sessions** (connect/auth/PTY forwarding, host-key TOFU,
//!   multiplexed channels): fully ported, this is the core capability.
//! - **SFTP file operations** (list/read/write/rename/delete, upload/download
//!   with resume, recursive transfer with cancellation): fully ported.
//! - **Windows remote Agent** (TLS + pairing-token auth, cert TOFU, terminal,
//!   file browsing): fully ported, using the vendored `roc_desk_protocol`
//!   wire-format crate (a sibling workspace member here, copied from the
//!   host's `protocol/` -- not the standalone `roc_desk_agent.exe` binary
//!   under the host's `agent/`, which this migration does not touch).
//! - **RDP** (launches the system's `wfreerdp.exe` and embeds its top-level
//!   window as an owned window of the main window via Win32 APIs): ported
//!   as-is, Windows-only (`target.'cfg(windows)'.dependencies`), matching the
//!   host's own platform scope (the whole product is Windows-only, so the
//!   host source has no `#[cfg(windows)]` guard on this module either).

pub mod agent;
pub mod connection;
pub mod db;
pub mod error;
pub mod fsops;
pub mod rdp;
pub mod ssh;

pub const TOOL_NAME: &str = "roc_desk-ssh";
pub const TOOL_DESCRIPTION: &str = "SSH/SFTP：远程终端与文件传输";

pub fn tool_info() -> (&'static str, &'static str) {
    (TOOL_NAME, TOOL_DESCRIPTION)
}

/// Convenience constructor kept for callers that only need a bare profile
/// value (e.g. quick smoke tests) without the full `RocDeskSshAppState`.
pub fn connection_profile(
    id: uuid::Uuid,
    name: &str,
    host: &str,
    username: &str,
) -> connection::ConnectionProfile {
    connection::ConnectionProfile {
        id,
        name: name.to_string(),
        host: host.to_string(),
        port: 22,
        username: username.to_string(),
        auth_method: connection::AuthMethod::Password,
        credential_ref: None,
        group_id: None,
        tags: Vec::new(),
        jump_host_id: None,
        protocol: connection::Protocol::Ssh,
        options: None,
        last_connected_at: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// Shared state for this tool's Tauri commands. Constructed once at startup
/// (see [`RocDeskSshAppState::new`]) and registered with `tauri::Builder::manage`.
pub struct RocDeskSshAppState {
    pub connection_manager: std::sync::Arc<connection::ConnectionManager>,
    pub connection_group_manager: std::sync::Arc<connection::ConnectionGroupManager>,
    pub ssh_pool: std::sync::Arc<ssh::SshConnectionPool>,
    pub trust_prompts: ssh::TrustPromptRegistry,
    pub agent_pool: std::sync::Arc<agent::AgentConnectionPool>,
    pub agent_trust_prompts: agent::AgentTrustPromptRegistry,
    pub rdp_sessions: std::sync::Arc<rdp::RdpSessionManager>,
    pub cancelled_transfers: std::sync::Arc<std::sync::Mutex<std::collections::HashSet<uuid::Uuid>>>,
    pub transfer_log: std::sync::Arc<db::repo::transfer_log_repo::TransferLogRepo>,
}

impl RocDeskSshAppState {
    /// `db_path` is this tool's own SQLite file (connection profiles/groups,
    /// known-hosts TOFU tables, transfer log) -- a fresh, self-contained
    /// database, not a copy of the host's `sql_data_sources.db`-style shared
    /// file (see the module doc above for why this state doesn't reuse host
    /// `AppState`).
    pub fn new(db_path: &std::path::Path, app_handle: tauri::AppHandle) -> Result<Self, error::AppError> {
        let pool = roc_desk_core::db::pool::create_pool(db_path)?;
        {
            let conn = pool.get().map_err(error::AppError::from)?;
            roc_desk_core::db::migrate::apply_migrations(&conn, db::MIGRATIONS)?;
        }

        let credential_store: std::sync::Arc<dyn roc_desk_core::credential::CredentialStore> =
            std::sync::Arc::new(roc_desk_core::credential::KeyringStore);

        let connections_repo = std::sync::Arc::new(db::repo::connections_repo::ConnectionsRepo::new(pool.clone()));
        let groups_repo = std::sync::Arc::new(db::repo::connection_groups_repo::ConnectionGroupsRepo::new(pool.clone()));
        let known_hosts_repo = std::sync::Arc::new(db::repo::known_hosts_repo::KnownHostsRepo::new(pool.clone()));
        let agent_known_hosts_repo =
            std::sync::Arc::new(db::repo::agent_known_hosts_repo::AgentKnownHostsRepo::new(pool.clone()));
        let transfer_log = std::sync::Arc::new(db::repo::transfer_log_repo::TransferLogRepo::new(pool.clone()));

        let connection_manager = std::sync::Arc::new(connection::ConnectionManager::new(
            connections_repo,
            credential_store,
        ));
        let connection_group_manager =
            std::sync::Arc::new(connection::ConnectionGroupManager::new(groups_repo));

        let trust_prompts = ssh::TrustPromptRegistry::default();
        let verifier = std::sync::Arc::new(ssh::KnownHostsVerifier::new(
            known_hosts_repo,
            trust_prompts.clone(),
            app_handle.clone(),
        ));
        let ssh_pool = std::sync::Arc::new(ssh::SshConnectionPool::new(
            connection_manager.clone(),
            verifier,
        ));

        let agent_trust_prompts = agent::AgentTrustPromptRegistry::default();
        let agent_verifier = std::sync::Arc::new(agent::AgentCertVerifier::new(
            agent_known_hosts_repo,
            agent_trust_prompts.clone(),
            app_handle.clone(),
        ));
        let agent_pool = std::sync::Arc::new(agent::AgentConnectionPool::new(
            connection_manager.clone(),
            agent_verifier,
        ));

        let rdp_sessions = std::sync::Arc::new(rdp::RdpSessionManager::new(connection_manager.clone()));

        Ok(Self {
            connection_manager,
            connection_group_manager,
            ssh_pool,
            trust_prompts,
            agent_pool,
            agent_trust_prompts,
            rdp_sessions,
            cancelled_transfers: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
            transfer_log,
        })
    }
}

/// All of this tool's `#[tauri::command]` handlers live in a submodule, not
/// crate root -- Tauri's command macro emits both a `#[macro_export]` macro
/// and a self-referential `pub use` of the same name, which collide with
/// `E0255` at crate root (same fix `roc_desk-explorer`/`roc_desk-sql` already
/// applied). `standalone/src/main.rs` and the host reference these as
/// `roc_desk_ssh::cmd::ssh_connect`, etc.
pub mod cmd {
    use std::sync::atomic::AtomicU64;
    use std::sync::Arc;

    use base64::Engine;
    use tauri::{AppHandle, Emitter, State};
    use tauri_plugin_opener::OpenerExt;
    use uuid::Uuid;

    use crate::connection::{ConnectionGroup, ConnectionGroupInput, ConnectionProfile, ConnectionProfileInput};
    use crate::db::repo::transfer_log_repo::{TransferLogEntry, TransferLogInput};
    use crate::error::AppError;
    use crate::fsops::{
        self, binary_info, jar_info, local::LocalFileOps, office_convert, BinaryInfo, FileContent,
        FileEntry, FileOps, JarInfo, WriteOutcome, BINARY_PREVIEW_MAX_BYTES, EXECUTABLE_INSPECT_MAX_BYTES,
    };
    use crate::rdp::PanelBounds;
    use crate::ssh::{parse_probe_output, HostStats, PROBE_SCRIPT};
    use crate::RocDeskSshAppState as AppState;

    // -----------------------------------------------------------------------
    // 连接档案 CRUD（会话树，DESIGN.md §3.9）
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub async fn connection_list(
        state: State<'_, AppState>,
        group_id: Option<Uuid>,
    ) -> Result<Vec<ConnectionProfile>, AppError> {
        state.connection_manager.list(group_id)
    }

    #[tauri::command]
    pub async fn connection_create(
        state: State<'_, AppState>,
        input: ConnectionProfileInput,
    ) -> Result<ConnectionProfile, AppError> {
        state.connection_manager.create(input).await
    }

    #[tauri::command]
    pub async fn connection_update(
        state: State<'_, AppState>,
        id: Uuid,
        input: ConnectionProfileInput,
    ) -> Result<ConnectionProfile, AppError> {
        let profile = state.connection_manager.update(id, input).await?;
        let _ = state.ssh_pool.disconnect(id).await;
        let _ = state.agent_pool.disconnect(id).await;
        Ok(profile)
    }

    #[tauri::command]
    pub async fn connection_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
        state.connection_manager.delete(id).await?;
        let _ = state.ssh_pool.disconnect(id).await;
        let _ = state.agent_pool.disconnect(id).await;
        Ok(())
    }

    #[tauri::command]
    pub async fn connection_group_list(state: State<'_, AppState>) -> Result<Vec<ConnectionGroup>, AppError> {
        state.connection_group_manager.list()
    }

    #[tauri::command]
    pub async fn connection_group_create(
        state: State<'_, AppState>,
        input: ConnectionGroupInput,
    ) -> Result<ConnectionGroup, AppError> {
        state.connection_group_manager.create(input)
    }

    #[tauri::command]
    pub async fn connection_group_update(
        state: State<'_, AppState>,
        id: Uuid,
        input: ConnectionGroupInput,
    ) -> Result<ConnectionGroup, AppError> {
        state.connection_group_manager.update(id, input)
    }

    #[tauri::command]
    pub async fn connection_group_delete(state: State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
        state.connection_group_manager.delete(id)
    }

    // -----------------------------------------------------------------------
    // SSH 终端会话
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub async fn ssh_connect(state: State<'_, AppState>, profile_id: Uuid) -> Result<Uuid, AppError> {
        state.ssh_pool.get_or_connect(profile_id).await?;
        Ok(profile_id)
    }

    #[tauri::command]
    pub async fn ssh_open_shell(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        profile_id: Uuid,
        rows: u16,
        cols: u16,
        cwd: Option<String>,
    ) -> Result<Uuid, AppError> {
        let session = state
            .ssh_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active ssh session for {profile_id}")))?;
        session.open_shell(rows, cols, cwd.as_deref(), app_handle).await
    }

    #[tauri::command]
    pub async fn ssh_write(
        state: State<'_, AppState>,
        profile_id: Uuid,
        channel_id: Uuid,
        data: Vec<u8>,
    ) -> Result<(), AppError> {
        let session = state
            .ssh_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active ssh session for {profile_id}")))?;
        session.write(channel_id, data).await
    }

    #[tauri::command]
    pub async fn ssh_resize(
        state: State<'_, AppState>,
        profile_id: Uuid,
        channel_id: Uuid,
        rows: u16,
        cols: u16,
    ) -> Result<(), AppError> {
        let session = state
            .ssh_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active ssh session for {profile_id}")))?;
        session.resize(channel_id, rows, cols).await
    }

    #[tauri::command]
    pub async fn ssh_disconnect(state: State<'_, AppState>, profile_id: Uuid) -> Result<(), AppError> {
        state.ssh_pool.disconnect(profile_id).await
    }

    #[tauri::command]
    pub async fn ssh_close_channel(
        state: State<'_, AppState>,
        profile_id: Uuid,
        channel_id: Uuid,
    ) -> Result<(), AppError> {
        let session = state
            .ssh_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active ssh session for {profile_id}")))?;
        session.close_channel(channel_id).await
    }

    #[tauri::command]
    pub async fn ssh_host_stats(state: State<'_, AppState>, profile_id: Uuid) -> Result<HostStats, AppError> {
        let session = state
            .ssh_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active ssh session for {profile_id}")))?;
        let output = session.exec(PROBE_SCRIPT).await?;
        let sampled_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(parse_probe_output(&output, sampled_at_ms))
    }

    #[tauri::command]
    pub async fn ssh_confirm_host_key(
        state: State<'_, AppState>,
        request_id: Uuid,
        trust: bool,
    ) -> Result<(), AppError> {
        state.trust_prompts.resolve(request_id, trust).await;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // SFTP 自由浏览快捷工具（故意不做工作区边界检查）
    // -----------------------------------------------------------------------

    fn finish_transfer_log(
        state: &AppState,
        request_id: Uuid,
        profile_id: Uuid,
        protocol: &str,
        direction: &str,
        local_path: &str,
        remote_path: &str,
        is_dir: bool,
        file_count: u64,
        started_at: &str,
        result: &Result<(), AppError>,
    ) {
        state.cancelled_transfers.lock().unwrap().remove(&request_id);
        let profile_name = state
            .connection_manager
            .get(profile_id)
            .ok()
            .flatten()
            .map(|p| p.name)
            .unwrap_or_else(|| "未知连接".into());
        let error_message = result.as_ref().err().map(|e| e.to_string());
        let status = match &error_message {
            None => "completed",
            Some(msg) if msg.contains(fsops::TRANSFER_CANCELLED_MESSAGE) => "cancelled",
            Some(_) => "failed",
        };
        state.transfer_log.record(TransferLogInput {
            protocol,
            direction,
            profile_id: Some(profile_id),
            profile_name: &profile_name,
            local_path,
            remote_path,
            is_dir,
            file_count,
            status,
            error_message: error_message.as_deref(),
            started_at,
            bytes_transferred: None,
            total_bytes: None,
        });
    }

    #[tauri::command]
    pub async fn sftp_list_dir(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<Vec<FileEntry>, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        ops.list_dir(&path).await
    }

    #[tauri::command]
    pub async fn sftp_read_file(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<FileContent, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        ops.read_file_for_editor(&path).await
    }

    #[tauri::command]
    pub async fn sftp_read_binary_preview(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<String, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let bytes = ops.read_binary_for_preview(&path, BINARY_PREVIEW_MAX_BYTES).await?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    #[tauri::command]
    pub async fn sftp_open_externally(
        app_handle: AppHandle,
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let file_name = path.rsplit('/').next().unwrap_or(&path);
        let tmp_dir = std::env::temp_dir().join("roc_desk_ssh_open");
        std::fs::create_dir_all(&tmp_dir)?;
        let local_path = tmp_dir.join(file_name);
        ops.download_to_local_file(&path, &local_path.to_string_lossy())
            .await?;
        app_handle
            .opener()
            .open_path(local_path.to_string_lossy().to_string(), None::<&str>)
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    #[tauri::command]
    pub async fn sftp_convert_legacy_office_to_pdf(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<String, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let tmp_dir = std::env::temp_dir().join("roc_desk_ssh_office_convert");
        std::fs::create_dir_all(&tmp_dir)?;
        let file_name = path.rsplit('/').next().unwrap_or(&path);
        let local_path = tmp_dir.join(file_name);
        ops.download_to_local_file(&path, &local_path.to_string_lossy())
            .await?;

        let pdf_path = office_convert::convert_to_pdf(&local_path, &tmp_dir).await?;
        let bytes = tokio::fs::read(&pdf_path).await.map_err(AppError::from)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    #[tauri::command]
    pub async fn sftp_inspect_binary(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<BinaryInfo, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let bytes = ops
            .read_binary_for_preview(&path, EXECUTABLE_INSPECT_MAX_BYTES)
            .await?;
        binary_info::inspect(&bytes)
    }

    #[tauri::command]
    pub async fn sftp_peek_is_binary(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<bool, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let (head, _mtime) = ops.read_file_raw_bounded(&path, 64).await?;
        Ok(binary_info::looks_like_binary(&head))
    }

    #[tauri::command]
    pub async fn sftp_inspect_jar(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<JarInfo, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let bytes = ops
            .read_binary_for_preview(&path, EXECUTABLE_INSPECT_MAX_BYTES)
            .await?;
        jar_info::inspect(&bytes)
    }

    #[tauri::command]
    pub async fn sftp_write_file(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
        content: String,
        expected_mtime: Option<i64>,
    ) -> Result<WriteOutcome, AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        ops.write_file(&path, &content, expected_mtime).await
    }

    #[tauri::command]
    pub async fn sftp_download(
        state: State<'_, AppState>,
        profile_id: Uuid,
        remote_path: String,
        local_path: String,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let offset = match (
            tokio::fs::metadata(&local_path).await,
            ops.file_size(&remote_path).await,
        ) {
            (Ok(local), Ok(remote)) if local.is_file() && local.len() <= remote => local.len(),
            _ => 0,
        };
        ops.download_range_to_local(&remote_path, &local_path, offset, Arc::new(|_| {}), Arc::new(|| false))
            .await
    }

    #[tauri::command]
    pub async fn sftp_upload(
        state: State<'_, AppState>,
        profile_id: Uuid,
        local_path: String,
        remote_path: String,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let offset = match (
            tokio::fs::metadata(&local_path).await,
            ops.file_size(&remote_path).await,
        ) {
            (Ok(local), Ok(remote)) if local.is_file() && remote <= local.len() => remote,
            _ => 0,
        };
        ops.upload_range_from_local(&local_path, &remote_path, offset, Arc::new(|_| {}), Arc::new(|| false))
            .await
    }

    #[tauri::command]
    pub async fn sftp_download_entry(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        profile_id: Uuid,
        remote_path: String,
        is_dir: bool,
        local_dir: String,
        request_id: Uuid,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let name = remote_path.trim_end_matches('/').rsplit('/').next().unwrap_or(&remote_path);
        let local_target = format!("{}/{}", local_dir.trim_end_matches('/'), name);

        let started_at = chrono::Utc::now().to_rfc3339();
        let cancelled_transfers = state.cancelled_transfers.clone();
        let should_cancel: Arc<dyn Fn() -> bool + Send + Sync> =
            Arc::new(move || cancelled_transfers.lock().unwrap().contains(&request_id));
        let file_count = AtomicU64::new(0);

        let result = if is_dir {
            ops.download_recursive(
                &remote_path,
                &local_target,
                Some((app_handle, request_id)),
                should_cancel.clone(),
                &file_count,
            )
            .await
        } else {
            let offset = match (
                tokio::fs::metadata(&local_target).await,
                ops.file_size(&remote_path).await,
            ) {
                (Ok(local), Ok(remote)) if local.is_file() && local.len() <= remote => local.len(),
                _ => 0,
            };
            let app = app_handle.clone();
            let id = request_id;
            let path = remote_path.clone();
            let total = ops.file_size(&remote_path).await.unwrap_or(0);
            ops.download_range_to_local(
                &remote_path,
                &local_target,
                offset,
                Arc::new(move |bytes| {
                    let _ = app.emit(
                        "sftp:transfer-progress",
                        serde_json::json!({"requestId": id, "path": path, "bytes": bytes, "totalBytes": total}),
                    );
                }),
                should_cancel.clone(),
            )
            .await
            .inspect(|_| {
                file_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            })
        };

        finish_transfer_log(
            &state,
            request_id,
            profile_id,
            "sftp",
            "download",
            &local_target,
            &remote_path,
            is_dir,
            file_count.load(std::sync::atomic::Ordering::Relaxed),
            &started_at,
            &result,
        );
        result
    }

    #[tauri::command]
    pub async fn sftp_upload_entry(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        profile_id: Uuid,
        local_path: String,
        is_dir: bool,
        remote_dir: String,
        request_id: Uuid,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        let name = local_path
            .trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&local_path);
        let remote_target = format!("{}/{}", remote_dir.trim_end_matches('/'), name);

        let started_at = chrono::Utc::now().to_rfc3339();
        let cancelled_transfers = state.cancelled_transfers.clone();
        let should_cancel: Arc<dyn Fn() -> bool + Send + Sync> =
            Arc::new(move || cancelled_transfers.lock().unwrap().contains(&request_id));
        let file_count = AtomicU64::new(0);

        let result = if is_dir {
            ops.upload_recursive(
                &local_path,
                &remote_target,
                Some((app_handle, request_id)),
                should_cancel.clone(),
                &file_count,
            )
            .await
        } else {
            let total = tokio::fs::metadata(&local_path).await.map(|m| m.len()).unwrap_or(0);
            let offset = match ops.file_size(&remote_target).await {
                Ok(remote) if remote <= total => remote,
                _ => 0,
            };
            let app = app_handle.clone();
            let id = request_id;
            let path = local_path.clone();
            ops.upload_range_from_local(
                &local_path,
                &remote_target,
                offset,
                Arc::new(move |bytes| {
                    let _ = app.emit(
                        "sftp:transfer-progress",
                        serde_json::json!({"requestId": id, "path": path, "bytes": bytes, "totalBytes": total}),
                    );
                }),
                should_cancel.clone(),
            )
            .await
            .inspect(|_| {
                file_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            })
        };

        finish_transfer_log(
            &state,
            request_id,
            profile_id,
            "sftp",
            "upload",
            &local_path,
            &remote_target,
            is_dir,
            file_count.load(std::sync::atomic::Ordering::Relaxed),
            &started_at,
            &result,
        );
        result
    }

    #[tauri::command]
    pub async fn sftp_delete(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
        is_dir: bool,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        ops.delete(&path, is_dir).await
    }

    #[tauri::command]
    pub async fn sftp_rename(
        state: State<'_, AppState>,
        profile_id: Uuid,
        from: String,
        to: String,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        ops.rename(&from, &to).await
    }

    #[tauri::command]
    pub async fn sftp_create_dir(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<(), AppError> {
        let ops = state.ssh_pool.get_file_ops(profile_id).await?;
        ops.create_dir(&path).await
    }

    // -----------------------------------------------------------------------
    // RDP
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub async fn rdp_connect(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        profile_id: Uuid,
        bounds: PanelBounds,
    ) -> Result<Uuid, AppError> {
        state.rdp_sessions.connect(&app_handle, profile_id, bounds).await
    }

    #[tauri::command]
    pub async fn rdp_set_bounds(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        session_id: Uuid,
        bounds: PanelBounds,
    ) -> Result<(), AppError> {
        state.rdp_sessions.set_bounds(&app_handle, session_id, bounds)
    }

    #[tauri::command]
    pub async fn rdp_hide(state: State<'_, AppState>, session_id: Uuid) -> Result<(), AppError> {
        state.rdp_sessions.hide(session_id)
    }

    #[tauri::command]
    pub async fn rdp_show(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        session_id: Uuid,
        bounds: PanelBounds,
    ) -> Result<(), AppError> {
        state.rdp_sessions.show(&app_handle, session_id, bounds)
    }

    #[tauri::command]
    pub async fn rdp_disconnect(state: State<'_, AppState>, session_id: Uuid) -> Result<(), AppError> {
        state.rdp_sessions.disconnect(session_id)
    }

    #[tauri::command]
    pub async fn rdp_status(state: State<'_, AppState>, session_id: Uuid) -> Result<crate::rdp::RdpStatus, AppError> {
        state.rdp_sessions.status(session_id)
    }

    // -----------------------------------------------------------------------
    // Windows 远程 Agent
    // -----------------------------------------------------------------------

    async fn agent_file_ops(state: &AppState, profile_id: Uuid) -> Result<crate::agent::AgentFileOps, AppError> {
        let session = state.agent_pool.get_or_connect(profile_id).await?;
        Ok(crate::agent::AgentFileOps::new(session))
    }

    #[tauri::command]
    pub async fn agent_connect(state: State<'_, AppState>, profile_id: Uuid) -> Result<Uuid, AppError> {
        state.agent_pool.get_or_connect(profile_id).await?;
        Ok(profile_id)
    }

    #[tauri::command]
    pub async fn agent_disconnect(state: State<'_, AppState>, profile_id: Uuid) -> Result<(), AppError> {
        state.agent_pool.disconnect(profile_id).await
    }

    #[tauri::command]
    pub async fn agent_confirm_cert(
        state: State<'_, AppState>,
        request_id: Uuid,
        trust: bool,
    ) -> Result<(), AppError> {
        state.agent_trust_prompts.resolve(request_id, trust).await;
        Ok(())
    }

    #[tauri::command]
    pub async fn agent_test_connection(host: String, port: u16, token: String) -> Result<String, AppError> {
        let result = crate::agent::AgentSession::test_connect(&host, port, token).await?;
        Ok(format!(
            "连接成功：主机 {}，Agent 版本 {}，证书指纹 {}",
            result.hostname, result.server_version, result.fingerprint
        ))
    }

    #[tauri::command]
    pub async fn agent_list_dir(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<Vec<FileEntry>, AppError> {
        agent_file_ops(&state, profile_id).await?.list_dir(&path).await
    }

    #[tauri::command]
    pub async fn agent_list_roots(state: State<'_, AppState>, profile_id: Uuid) -> Result<Vec<String>, AppError> {
        let session = state.agent_pool.get_or_connect(profile_id).await?;
        match session.request(roc_desk_protocol::Request::ListRoots).await? {
            roc_desk_protocol::Response::Ok(roc_desk_protocol::ResponseBody::Roots(roots)) => Ok(roots),
            roc_desk_protocol::Response::Error { message, .. } => Err(AppError::Internal(message)),
            _ => Err(AppError::Internal("Agent 返回了意外的响应类型".into())),
        }
    }

    #[tauri::command]
    pub async fn agent_open_shell(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        profile_id: Uuid,
        rows: u16,
        cols: u16,
        cwd: Option<String>,
    ) -> Result<Uuid, AppError> {
        let session = state.agent_pool.get_or_connect(profile_id).await?;
        session
            .open_shell(rows, cols, cwd.as_deref().unwrap_or(""), app_handle)
            .await
    }

    #[tauri::command]
    pub async fn agent_write(
        state: State<'_, AppState>,
        profile_id: Uuid,
        channel_id: Uuid,
        data: Vec<u8>,
    ) -> Result<(), AppError> {
        let session = state
            .agent_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active agent session for {profile_id}")))?;
        session.write_shell(channel_id, data).await
    }

    #[tauri::command]
    pub async fn agent_resize(
        state: State<'_, AppState>,
        profile_id: Uuid,
        channel_id: Uuid,
        rows: u16,
        cols: u16,
    ) -> Result<(), AppError> {
        let session = state
            .agent_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active agent session for {profile_id}")))?;
        session.resize_shell(channel_id, cols, rows).await
    }

    #[tauri::command]
    pub async fn agent_close_channel(
        state: State<'_, AppState>,
        profile_id: Uuid,
        channel_id: Uuid,
    ) -> Result<(), AppError> {
        let session = state
            .agent_pool
            .get(profile_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("no active agent session for {profile_id}")))?;
        session.close_shell(channel_id).await
    }

    #[tauri::command]
    pub async fn agent_read_file(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<FileContent, AppError> {
        agent_file_ops(&state, profile_id).await?.read_file_for_editor(&path).await
    }

    #[tauri::command]
    pub async fn agent_write_file(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
        content: String,
        expected_mtime: Option<i64>,
    ) -> Result<WriteOutcome, AppError> {
        agent_file_ops(&state, profile_id)
            .await?
            .write_file(&path, &content, expected_mtime)
            .await
    }

    #[tauri::command]
    pub async fn agent_delete(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
        is_dir: bool,
    ) -> Result<(), AppError> {
        agent_file_ops(&state, profile_id).await?.delete(&path, is_dir).await
    }

    #[tauri::command]
    pub async fn agent_rename(
        state: State<'_, AppState>,
        profile_id: Uuid,
        from: String,
        to: String,
    ) -> Result<(), AppError> {
        agent_file_ops(&state, profile_id).await?.rename(&from, &to).await
    }

    #[tauri::command]
    pub async fn agent_create_dir(
        state: State<'_, AppState>,
        profile_id: Uuid,
        path: String,
    ) -> Result<(), AppError> {
        agent_file_ops(&state, profile_id).await?.create_dir(&path).await
    }

    #[tauri::command]
    pub async fn agent_download(
        state: State<'_, AppState>,
        profile_id: Uuid,
        remote_path: String,
        local_path: String,
    ) -> Result<(), AppError> {
        let ops = agent_file_ops(&state, profile_id).await?;
        let file_count = AtomicU64::new(0);
        fsops::copy_between(&ops, &remote_path, &LocalFileOps, &local_path, false, &None, &|| false, &file_count).await
    }

    #[tauri::command]
    pub async fn agent_upload(
        state: State<'_, AppState>,
        profile_id: Uuid,
        local_path: String,
        remote_path: String,
    ) -> Result<(), AppError> {
        let ops = agent_file_ops(&state, profile_id).await?;
        let file_count = AtomicU64::new(0);
        fsops::copy_between(&LocalFileOps, &local_path, &ops, &remote_path, false, &None, &|| false, &file_count).await
    }

    #[tauri::command]
    pub async fn agent_download_entry(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        profile_id: Uuid,
        remote_path: String,
        is_dir: bool,
        local_dir: String,
        request_id: Uuid,
    ) -> Result<(), AppError> {
        let ops = agent_file_ops(&state, profile_id).await?;
        let name = remote_path
            .trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&remote_path);
        let local_target = format!("{}/{}", local_dir.trim_end_matches(['/', '\\']), name);

        let started_at = chrono::Utc::now().to_rfc3339();
        let cancelled_transfers = state.cancelled_transfers.clone();
        let should_cancel = move || cancelled_transfers.lock().unwrap().contains(&request_id);
        let file_count = AtomicU64::new(0);

        let result = fsops::copy_between(
            &ops,
            &remote_path,
            &LocalFileOps,
            &local_target,
            is_dir,
            &Some((app_handle, request_id)),
            &should_cancel,
            &file_count,
        )
        .await;

        finish_transfer_log(
            &state,
            request_id,
            profile_id,
            "agent",
            "download",
            &local_target,
            &remote_path,
            is_dir,
            file_count.load(std::sync::atomic::Ordering::Relaxed),
            &started_at,
            &result,
        );
        result
    }

    #[tauri::command]
    pub async fn agent_upload_entry(
        state: State<'_, AppState>,
        app_handle: AppHandle,
        profile_id: Uuid,
        local_path: String,
        is_dir: bool,
        remote_dir: String,
        request_id: Uuid,
    ) -> Result<(), AppError> {
        let ops = agent_file_ops(&state, profile_id).await?;
        let name = local_path
            .trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&local_path);
        let remote_target = format!("{}/{}", remote_dir.trim_end_matches('/'), name);

        let started_at = chrono::Utc::now().to_rfc3339();
        let cancelled_transfers = state.cancelled_transfers.clone();
        let should_cancel = move || cancelled_transfers.lock().unwrap().contains(&request_id);
        let file_count = AtomicU64::new(0);

        let result = fsops::copy_between(
            &LocalFileOps,
            &local_path,
            &ops,
            &remote_target,
            is_dir,
            &Some((app_handle, request_id)),
            &should_cancel,
            &file_count,
        )
        .await;

        finish_transfer_log(
            &state,
            request_id,
            profile_id,
            "agent",
            "upload",
            &local_path,
            &remote_target,
            is_dir,
            file_count.load(std::sync::atomic::Ordering::Relaxed),
            &started_at,
            &result,
        );
        result
    }

    // -----------------------------------------------------------------------
    // 传输控制 / 传输日志
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub fn transfer_cancel(state: State<'_, AppState>, request_id: Uuid) {
        state.cancelled_transfers.lock().unwrap().insert(request_id);
    }

    #[tauri::command]
    pub fn transfer_log_list(
        state: State<'_, AppState>,
        limit: u32,
        offset: u32,
        search: Option<String>,
    ) -> Result<Vec<TransferLogEntry>, AppError> {
        state.transfer_log.list(limit, offset, search.as_deref())
    }

    #[tauri::command]
    pub fn transfer_log_clear(state: State<'_, AppState>) -> Result<(), AppError> {
        state.transfer_log.clear()
    }

    /// The full list of this tool's commands, for `standalone/`'s
    /// `generate_handler!` and (later, if the host wires this tool in) the
    /// host's own handler list.
    pub fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
        tauri::generate_handler![
            connection_list,
            connection_create,
            connection_update,
            connection_delete,
            connection_group_list,
            connection_group_create,
            connection_group_update,
            connection_group_delete,
            ssh_connect,
            ssh_open_shell,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ssh_close_channel,
            ssh_host_stats,
            ssh_confirm_host_key,
            sftp_list_dir,
            sftp_read_file,
            sftp_read_binary_preview,
            sftp_open_externally,
            sftp_convert_legacy_office_to_pdf,
            sftp_inspect_binary,
            sftp_peek_is_binary,
            sftp_inspect_jar,
            sftp_write_file,
            sftp_download,
            sftp_upload,
            sftp_download_entry,
            sftp_upload_entry,
            sftp_delete,
            sftp_rename,
            sftp_create_dir,
            rdp_connect,
            rdp_set_bounds,
            rdp_hide,
            rdp_show,
            rdp_disconnect,
            rdp_status,
            agent_connect,
            agent_disconnect,
            agent_confirm_cert,
            agent_test_connection,
            agent_list_dir,
            agent_list_roots,
            agent_open_shell,
            agent_write,
            agent_resize,
            agent_close_channel,
            agent_read_file,
            agent_write_file,
            agent_delete,
            agent_rename,
            agent_create_dir,
            agent_download,
            agent_upload,
            agent_download_entry,
            agent_upload_entry,
            transfer_cancel,
            transfer_log_list,
            transfer_log_clear,
        ]
    }
}
