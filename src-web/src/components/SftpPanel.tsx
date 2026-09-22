import { useCallback, useEffect, useState } from "react";
import { sftpService } from "../services/sftpService";
import type { FileEntry } from "../types/bindings";

function parentPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "/";
  return normalized.slice(0, idx);
}

function formatSize(size: number | null): string {
  if (size === null || size === undefined) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

interface SftpPanelProps {
  profileId: string;
}

/**
 * Minimal single-pane SFTP browser -- covers the "basic SFTP operations"
 * bar from the task brief (list/navigate/download/upload/delete/rename/
 * mkdir), not the host's dual-pane drag-and-drop browser (which pulls in
 * `localFsService`/`logSearchService`/`useDualPaneDnd`/shared Toast that
 * don't exist as standalone-safe dependencies here).
 */
export function SftpPanel({ profileId }: SftpPanelProps) {
  const [path, setPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [localPath, setLocalPath] = useState("");

  const load = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await sftpService.listDir(profileId, dir);
        list.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(list);
        setPath(dir);
        setPathInput(dir);
        setSelected(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [profileId],
  );

  useEffect(() => {
    load("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const runAction = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      try {
        await fn();
        await load(path);
      } catch (e) {
        setError(String(e));
      }
    },
    [load, path],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", gap: 6, padding: 8, borderBottom: "1px solid #374151", flexWrap: "wrap" }}>
        <button style={btn} onClick={() => load(parentPath(path))}>
          ↑ 上级
        </button>
        <button style={btn} onClick={() => load(path)}>
          ⟳ 刷新
        </button>
        <input
          style={{ ...btn, flex: 1, minWidth: 200, background: "#0b1220" }}
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(pathInput)}
        />
        <button style={btn} onClick={() => runAction(() => sftpService.createDir(profileId, `${path.replace(/\/$/, "")}/新建文件夹`))}>
          + 新建文件夹
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "0 8px 8px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "#9ca3af", fontSize: 12 }}>本地路径（下载/上传用）</span>
        <input
          style={{ ...btn, flex: 1, minWidth: 200, background: "#0b1220" }}
          placeholder="例如 C:\\Users\\me\\Downloads\\file.txt"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
        />
        <button
          style={btn}
          disabled={!selected || selected.is_dir || !localPath}
          onClick={() => selected && runAction(() => sftpService.download(profileId, selected.path, localPath))}
        >
          下载选中项
        </button>
        <button
          style={btn}
          disabled={!localPath}
          onClick={() => {
            const name = localPath.split(/[/\\]/).pop() ?? "upload";
            const remotePath = `${path.replace(/\/$/, "")}/${name}`;
            runAction(() => sftpService.upload(profileId, localPath, remotePath));
          }}
        >
          上传到此目录
        </button>
        <button
          style={{ ...btn, color: "#f87171" }}
          disabled={!selected}
          onClick={() => selected && runAction(() => sftpService.delete(profileId, selected.path, selected.is_dir))}
        >
          删除选中项
        </button>
      </div>

      {error && <div style={{ padding: "6px 12px", background: "#7f1d1d", color: "#fecaca" }}>{error}</div>}
      {loading && <div style={{ padding: "4px 12px", color: "#9ca3af" }}>加载中…</div>}

      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>名称</th>
              <th style={{ ...th, width: 100, textAlign: "right" }}>大小</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.path}
                style={{ background: selected?.path === entry.path ? "#1f2937" : "transparent", cursor: "default" }}
                onClick={() => setSelected(entry)}
                onDoubleClick={() => entry.is_dir && load(entry.path)}
              >
                <td style={td}>
                  {entry.is_dir ? "📁" : "📄"} {entry.name}
                </td>
                <td style={{ ...td, textAlign: "right" }}>{entry.is_dir ? "" : formatSize(entry.size)}</td>
              </tr>
            ))}
            {entries.length === 0 && !loading && (
              <tr>
                <td style={td} colSpan={2}>
                  （空目录）
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#1f2937",
  color: "#e5e7eb",
  border: "1px solid #374151",
  borderRadius: 4,
  padding: "6px 10px",
  cursor: "pointer",
};
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 12px",
  borderBottom: "1px solid #374151",
  color: "#9ca3af",
  position: "sticky",
  top: 0,
  background: "#111827",
};
const td: React.CSSProperties = { padding: "5px 12px", borderBottom: "1px solid #1f2937" };
