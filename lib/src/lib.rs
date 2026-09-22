//! SSH/SFTP/Agent/RDP integration boundary.
pub const TOOL_NAME: &str = "roc_desk-ssh";
pub const TOOL_DESCRIPTION: &str = "SSH/SFTP：远程终端与文件传输";
pub use roc_desk_core::connection::{ConnectionKind, ConnectionProfile};
pub fn tool_info() -> (&'static str, &'static str) { (TOOL_NAME, TOOL_DESCRIPTION) }
pub fn connection_profile(id: &str, name: &str, host: &str, username: &str) -> ConnectionProfile {
    ConnectionProfile::ssh(id, name, host, username)
}
