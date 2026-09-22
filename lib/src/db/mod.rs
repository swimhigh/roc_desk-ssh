pub mod repo;

/// This tool's own SQLite schema (fresh consolidated form -- no need to replay
/// the host's incremental `ALTER TABLE` history since this is a brand new
/// database file, not a migration of existing host data).
pub const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_ssh_init",
    r#"
    CREATE TABLE connection_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT REFERENCES connection_groups(id)
    );
    CREATE TABLE connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        auth_method TEXT NOT NULL,
        credential_ref TEXT,
        group_id TEXT REFERENCES connection_groups(id),
        tags TEXT,
        jump_host_id TEXT REFERENCES connections(id),
        last_connected_at TEXT,
        created_at TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'ssh',
        options TEXT
    );
    CREATE TABLE known_hosts (
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        trusted_at TEXT NOT NULL,
        PRIMARY KEY (host, port)
    );
    CREATE TABLE IF NOT EXISTS agent_known_hosts (
        connection_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        trusted_at TEXT NOT NULL
    );
    CREATE TABLE transfer_log (
        id TEXT PRIMARY KEY,
        protocol TEXT NOT NULL,
        direction TEXT NOT NULL,
        profile_id TEXT,
        profile_name TEXT NOT NULL,
        local_path TEXT NOT NULL,
        remote_path TEXT NOT NULL,
        is_dir INTEGER NOT NULL,
        file_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error_message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        bytes_transferred INTEGER,
        total_bytes INTEGER
    );
    CREATE INDEX idx_transfer_log_finished_at ON transfer_log(finished_at DESC);
    "#,
)];
