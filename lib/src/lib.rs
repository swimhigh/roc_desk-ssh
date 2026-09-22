//! SSH/SFTP：远程终端与文件传输
//! 
//! This crate is the stable integration boundary for the host and standalone shell.
pub const TOOL_NAME: &str = "roc_desk-ssh";
pub const TOOL_DESCRIPTION: &str = "SSH/SFTP：远程终端与文件传输";

/// Returns the user-visible metadata used by the standalone shell and host launcher.
pub fn tool_info() -> (&'static str, &'static str) {
    (TOOL_NAME, TOOL_DESCRIPTION)
}
