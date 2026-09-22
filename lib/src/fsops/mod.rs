//! Local/remote-agnostic file operations for this tool.
//!
//! The `FileOps` trait, `LocalFileOps`, and the generic file-preview/binary
//! inspection helpers already live in `roc_desk_common` (shared with the
//! explorer/editor tools). This module re-exports them under one roof and
//! adds the two pieces that are genuinely SSH/Agent-specific: `remote`
//! (SFTP-backed `FileOps`) and the `copy_between`/`TRANSFER_CANCELLED_MESSAGE`
//! cross-backend-copy helper, which needs `tauri::AppHandle`/`Emitter` and so
//! can't live in the host-agnostic common crate (same reasoning the explorer
//! migration used for `open_path_or_launch_exe`).

pub mod remote;

pub use roc_desk_common::fsops::{
    local, FileContent, FileEntry, FileOps, LocalFileOps, WriteOutcome,
    BINARY_PREVIEW_MAX_BYTES, EDITOR_PREVIEW_MAX_BYTES, EDITOR_PREVIEW_THRESHOLD_BYTES,
    EXECUTABLE_INSPECT_MAX_BYTES,
};
pub use roc_desk_common::binary_info::{self, BinaryInfo, SectionInfo};
pub use roc_desk_common::encoding;
pub use roc_desk_common::jar_info::{self, JarEntryInfo, JarInfo, ManifestAttribute};
pub use roc_desk_common::office_convert;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::error::AppError;

/// Shared cancellation-sentinel message: command handlers match on this
/// string to distinguish a user-cancelled transfer ('cancelled') from a real
/// failure ('failed') when writing to `transfer_log`.
pub const TRANSFER_CANCELLED_MESSAGE: &str = "传输已取消";

/// Cross-backend copy (local disk <-> Agent remote host). Unlike the trait's
/// default `copy` (same `&self` on both sides), this takes two different
/// `FileOps` implementations: files are read/written whole, directories are
/// created on the destination then recursed -- not streamed like
/// `fsops::remote::download_recursive`/`upload_recursive` (those are
/// SFTP-specific), but the same order-of-magnitude cost as the trait's
/// default `copy`. Progress is reported per-completed-file via the
/// `agent:transfer-progress` event (kept distinct from SFTP's
/// `sftp:transfer-progress` so the two transfer kinds don't interfere).
pub async fn copy_between(
    src: &dyn FileOps,
    src_path: &str,
    dst: &dyn FileOps,
    dst_path: &str,
    is_dir: bool,
    progress: &Option<(AppHandle, Uuid)>,
    should_cancel: &(dyn Fn() -> bool + Send + Sync),
    file_count: &std::sync::atomic::AtomicU64,
) -> Result<(), AppError> {
    if should_cancel() {
        return Err(AppError::Internal(TRANSFER_CANCELLED_MESSAGE.into()));
    }
    if !is_dir {
        let (bytes, _) = src.read_file_raw(src_path).await?;
        dst.write_file_bytes(dst_path, &bytes, None).await?;
        file_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if let Some((app, request_id)) = progress {
            let _ = app.emit(
                "agent:transfer-progress",
                serde_json::json!({ "requestId": request_id, "path": src_path }),
            );
        }
        return Ok(());
    }
    dst.create_dir(dst_path).await?;
    for entry in src.list_dir(src_path).await? {
        let child_dst = format!("{}/{}", dst_path.trim_end_matches(['/', '\\']), entry.name);
        Box::pin(copy_between(
            src,
            &entry.path,
            dst,
            &child_dst,
            entry.is_dir,
            progress,
            should_cancel,
            file_count,
        ))
        .await?;
    }
    Ok(())
}
