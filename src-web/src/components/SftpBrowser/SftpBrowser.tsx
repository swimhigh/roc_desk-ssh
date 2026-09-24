import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Folder, File as FileIcon, ArrowUp, ArrowUpNarrowWide, ArrowDownNarrowWide, Laptop, Pencil, Server, RotateCw, History, ArrowLeftRight, Search, X } from "lucide-react";
import { TransferLogDialog } from "./TransferLogDialog";
import { useSftpStore } from "../../stores/sftpStore";
import { useLocalFsStore } from "../../stores/localFsStore";
import { sftpService } from "../../services/sftpService";
import { localFsService } from "../../services/localFsService";
import { useToastStore } from "../shared/Toast";
import { ContextMenu, type ContextMenuItem } from "../shared/ContextMenu";
import { formatError, isCancelledTransferError } from "../../utils/error";
import { transferService } from "../../services/transferService";
import { useDualPaneDnd, type DndPayload, type PaneSide } from "../../hooks/useDualPaneDnd";
import type { FileEntry, SftpTransferProgressEvent } from "../../types/bindings";

function formatBytes(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function formatTime(epochSeconds: number | null): string {
  if (epochSeconds === null) return "—";
  const d = new Date(epochSeconds * 1000);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Side = PaneSide;

type SortField = "name" | "size" | "modified";
interface SortState {
  field: SortField;
  asc: boolean;
}
const DEFAULT_SORT: SortState = { field: "name", asc: true };

function sortEntries(entries: FileEntry[], sort: SortState): FileEntry[] {
  const dir = sort.asc ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    if (sort.field === "name" || a.is_dir) {
      return dir * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }
    if (sort.field === "size") {
      return dir * ((a.size ?? 0) - (b.size ?? 0));
    }
    return dir * ((a.modified ?? 0) - (b.modified ?? 0));
  });
}

function highlightMatch(name: string, query: string): React.ReactNode {
  if (!query) return name;
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark>{name.slice(idx, idx + query.length)}</mark>
      {name.slice(idx + query.length)}
    </>
  );
}

type DragPayload = DndPayload;

const SPLIT_STORAGE_KEY = "roc_desk-dual-pane-split-percent";
const SWAP_SIDES_KEY = "roc_desk-dual-pane-swap-sides";

interface SftpBrowserProps {
  profileId: string;
  workspaceId: string;
  initialRemotePath: string;
  rememberRemotePath?: boolean;
  initialLocalPath?: string;
  onPathsChange?: (localPath: string, remotePath: string) => void;
  onOpenFile: (entry: FileEntry) => void;
}

function localPathStorageKey(workspaceId: string): string {
  return `roc_desk-sftp-local-path-${workspaceId}`;
}

function remotePathStorageKey(id: string): string {
  return `roc_desk-sftp-remote-path-${id}`;
}

/**
 * SFTP 双栏浏览器：左远程/右本地，互相拖拽即下载/上传，也可以右键单条操作。
 * 原样搬自宿主 `src-web/src/components/SftpBrowser/SftpBrowser.tsx`。
 *
 * 唯一的功能性差异（范围边界，见 `docs/MULTI_REPO_SPLIT_PROGRESS.md`
 * 2026-09-23 restoration pass）：宿主版本右键菜单有一项"导入到本地搜索引擎"
 * （`logSearchService`），那是宿主 `roc_desk-common` 的 `common` 包
 * （日志搜索）的功能，这个工具没有依赖那个可选包，所以去掉了这一项菜单，
 * 不是保留一个点了会报错的死按钮。
 */
export const SftpBrowser: React.FC<SftpBrowserProps> = ({
  profileId,
  workspaceId,
  initialRemotePath,
  rememberRemotePath,
  initialLocalPath,
  onPathsChange,
  onOpenFile,
}) => {
  const remote = useSftpStore();
  const local = useLocalFsStore();
  const push = useToastStore((s) => s.push);
  const [menu, setMenu] = useState<{ x: number; y: number; side: Side; entry: FileEntry } | null>(null);
  const [transfer, setTransfer] = useState<{ requestId: string; count: number; path: string; bytes: number; totalBytes: number } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [editingSide, setEditingSide] = useState<Side | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sort, setSort] = useState<Record<Side, SortState>>({ remote: DEFAULT_SORT, local: DEFAULT_SORT });
  const [filter, setFilter] = useState<Record<Side, string>>({ remote: "", local: "" });
  const listRefs = useRef<Record<Side, HTMLDivElement | null>>({ remote: null, local: null });

  const toggleSort = (side: Side, field: SortField) => {
    setSort((s) => {
      const current = s[side];
      const asc = current.field === field ? !current.asc : true;
      return { ...s, [side]: { field, asc } };
    });
  };

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [splitPercent, setSplitPercent] = useState(() => {
    const stored = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
    return stored >= 20 && stored <= 80 ? stored : 50;
  });
  const onSplitDragStart = () => {
    const rect = splitContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    let latest = splitPercent;
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100));
      setSplitPercent(latest);
    };
    const onUp = () => {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(latest));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const [swapSides, setSwapSides] = useState(() => localStorage.getItem(SWAP_SIDES_KEY) === "1");
  const toggleSwapSides = () => {
    setSwapSides((s) => {
      const next = !s;
      localStorage.setItem(SWAP_SIDES_KEY, next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      const rememberedRemote = rememberRemotePath ? localStorage.getItem(remotePathStorageKey(workspaceId)) : null;
      await remote.navigate(profileId, rememberedRemote ?? initialRemotePath);
      if (rememberedRemote && useSftpStore.getState().error) {
        await remote.navigate(profileId, initialRemotePath);
      }
    })();

    (async () => {
      const remembered = initialLocalPath ?? localStorage.getItem(localPathStorageKey(workspaceId));
      if (remembered) {
        await local.navigate(remembered);
      }
      if (!remembered || useLocalFsStore.getState().error) {
        const home = await localFsService.homeDir();
        await local.navigate(home);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, initialRemotePath, initialLocalPath, workspaceId]);

  useEffect(() => {
    if (!local.cwd) return;
    localStorage.setItem(localPathStorageKey(workspaceId), local.cwd);
  }, [workspaceId, local.cwd]);

  useEffect(() => {
    if (!onPathsChange || !local.cwd || !remote.cwd) return;
    onPathsChange(local.cwd, remote.cwd);
  }, [onPathsChange, local.cwd, remote.cwd]);

  useEffect(() => {
    if (!rememberRemotePath || !remote.cwd) return;
    localStorage.setItem(remotePathStorageKey(workspaceId), remote.cwd);
  }, [rememberRemotePath, workspaceId, remote.cwd]);

  useEffect(() => setFilter((f) => (f.remote ? { ...f, remote: "" } : f)), [remote.cwd]);
  useEffect(() => setFilter((f) => (f.local ? { ...f, local: "" } : f)), [local.cwd]);

  const runTransfer = async (payload: DragPayload, targetSide: Side) => {
    if (payload.side === targetSide) return;
    const requestId = crypto.randomUUID();
    setTransfer({ requestId, count: 0, path: payload.path, bytes: 0, totalBytes: 0 });
    const unlisten = await listen<SftpTransferProgressEvent>("sftp:transfer-progress", (event) => {
      if (event.payload.requestId !== requestId) return;
      setTransfer((s) => (s && s.requestId === requestId ? { ...s, count: s.count + 1, path: event.payload.path || s.path, bytes: event.payload.bytes ?? s.bytes, totalBytes: event.payload.totalBytes ?? s.totalBytes } : s));
    });
    try {
      if (payload.side === "remote") {
        await sftpService.downloadEntry(profileId, payload.path, payload.isDir, local.cwd, requestId);
        await local.navigate(local.cwd);
        push("success", `已下载 ${payload.name}`);
      } else {
        await sftpService.uploadEntry(profileId, payload.path, payload.isDir, remote.cwd, requestId);
        await remote.navigate(profileId, remote.cwd);
        push("success", `已上传 ${payload.name}`);
      }
    } catch (e) {
      if (isCancelledTransferError(e)) {
        push("info", "已停止传输");
        await Promise.all([remote.navigate(profileId, remote.cwd), local.navigate(local.cwd)]);
      } else {
        push("error", `传输失败：${formatError(e)}`);
      }
    } finally {
      unlisten();
      setTransfer(null);
    }
  };

  const uploadExternalPaths = async (paths: string[]) => {
    for (const path of paths) {
      const name = path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
      const requestId = crypto.randomUUID();
      setTransfer({ requestId, count: 0, path, bytes: 0, totalBytes: 0 });
      const unlisten = await listen<SftpTransferProgressEvent>("sftp:transfer-progress", (event) => {
        if (event.payload.requestId !== requestId) return;
        setTransfer((s) => (s && s.requestId === requestId ? { ...s, count: s.count + 1, path: event.payload.path || s.path, bytes: event.payload.bytes ?? s.bytes, totalBytes: event.payload.totalBytes ?? s.totalBytes } : s));
      });
      let cancelled = false;
      try {
        const isDir = await localFsService.isDir(path);
        await sftpService.uploadEntry(profileId, path, isDir, remote.cwd, requestId);
        push("success", `已上传 ${name}`);
      } catch (e) {
        if (isCancelledTransferError(e)) {
          cancelled = true;
          push("info", "已停止传输");
        } else {
          push("error", `上传失败：${formatError(e)}`);
        }
      } finally {
        unlisten();
        setTransfer(null);
      }
      if (cancelled) break;
    }
    await remote.navigate(profileId, remote.cwd);
  };

  const { remoteRef, localRef, dragOverSide, beginDrag } = useDualPaneDnd({
    onInternalTransfer: (payload, targetSide) => void runTransfer(payload, targetSide),
    onExternalUpload: (paths) => void uploadExternalPaths(paths),
  });

  const remoteMenuItems = (entry: FileEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (!entry.is_dir) items.push({ label: "打开", onClick: () => onOpenFile(entry) });
    items.push(
      { label: "下载到本地", onClick: () => runTransfer({ side: "remote", path: entry.path, isDir: entry.is_dir, name: entry.name }, "local") },
    );
    // 宿主版本这里还有一项"导入到本地搜索引擎"（roc_desk-common 的 common 包
    // 日志搜索能力），这个工具没有依赖那个可选包，故意不放这一项，见文件顶部注释。
    items.push(
      { label: "复制路径", onClick: () => navigator.clipboard.writeText(entry.path), separatorBefore: true },
      {
        label: "删除",
        danger: true,
        separatorBefore: true,
        onClick: async () => {
          try {
            await sftpService.delete(profileId, entry.path, entry.is_dir);
            await remote.navigate(profileId, remote.cwd);
          } catch (e) {
            push("error", `删除失败：${formatError(e)}`);
          }
        },
      },
    );
    return items;
  };

  const localMenuItems = (entry: FileEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: "上传到远程", onClick: () => runTransfer({ side: "local", path: entry.path, isDir: entry.is_dir, name: entry.name }, "remote") },
    ];
    items.push({ label: "复制路径", onClick: () => navigator.clipboard.writeText(entry.path), separatorBefore: true });
    items.push({ label: "删除", danger: true, separatorBefore: true, onClick: async () => {
      if (!window.confirm(`确认删除"${entry.name}"吗？`)) return;
      try { await localFsService.deletePath(entry.path, entry.is_dir); await local.navigate(local.cwd); push("success", "已删除"); }
      catch (e) { push("error", `删除失败：${formatError(e)}`); }
    }});
    return items;
  };

  const renderPane = (
    side: Side,
    icon: React.ReactNode,
    label: string,
    state: { cwd: string; entries: FileEntry[]; loading: boolean; error: string | null; selectedPath: string | null },
    navigate: (path: string) => void,
    select: (path: string | null) => void,
    onRowDoubleClick: (entry: FileEntry) => void,
  ) => {
    const isUnix = side === "remote" || state.cwd.startsWith("/");
    const segments = state.cwd.split(/[/\\]/).filter(Boolean);
    const dirCount = state.entries.filter((e) => e.is_dir).length;
    const fileCount = state.entries.length - dirCount;
    const paneSort = sort[side];
    const sortedEntries = sortEntries(state.entries, paneSort);
    const filterQuery = filter[side].trim();
    const visibleEntries = filterQuery
      ? sortedEntries.filter((e) => e.name.toLowerCase().includes(filterQuery.toLowerCase()))
      : sortedEntries;
    const sortIcon = (field: SortField) => {
      if (paneSort.field !== field) return null;
      const Icon = paneSort.asc ? ArrowUpNarrowWide : ArrowDownNarrowWide;
      return <Icon style={{ width: 12, height: 12 }} />;
    };
    const headerCell = (field: SortField, label: string) => (
      <span
        onClick={() => toggleSort(side, field)}
        style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" }}
        title="点击排序"
      >
        {label}
        {sortIcon(field)}
      </span>
    );
    const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (visibleEntries.length === 0) return;
      e.preventDefault();
      const idx = visibleEntries.findIndex((it) => it.path === state.selectedPath);
      const nextIdx =
        idx === -1
          ? e.key === "ArrowDown"
            ? 0
            : visibleEntries.length - 1
          : e.key === "ArrowDown"
            ? Math.min(idx + 1, visibleEntries.length - 1)
            : Math.max(idx - 1, 0);
      const next = visibleEntries[nextIdx];
      select(next.path);
      listRefs.current[side]?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: "nearest" });
    };

    return (
      <div
        ref={side === "remote" ? remoteRef : localRef}
        data-external-drop-zone="dual-pane"
        style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: dragOverSide === side ? "var(--accent-dim)" : undefined }}
      >
        <div className="sftp-toolbar">
          {icon}
          <span style={{ fontWeight: 600, marginRight: 4 }}>{label}</span>
          {editingSide === side ? (
            <input
              className="form-input"
              style={{ flex: 1, height: 22, fontSize: 12, fontFamily: "var(--font-mono)" }}
              autoFocus
              value={editValue}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const value = editValue.trim();
                  if (value) navigate(value);
                  setEditingSide(null);
                } else if (e.key === "Escape") {
                  setEditingSide(null);
                }
              }}
              onBlur={() => setEditingSide(null)}
            />
          ) : (
            <div className="breadcrumb" style={{ overflow: "hidden" }}>
              {isUnix && (
                <span className="crumb" onClick={() => navigate("/")}>
                  /
                </span>
              )}
              {segments.map((seg, i) => {
                const path = isUnix ? "/" + segments.slice(0, i + 1).join("/") : segments.slice(0, i + 1).join("/") + "/";
                const isLast = i === segments.length - 1;
                return (
                  <span key={path}>
                    <span className="sep">›</span>{" "}
                    <span className={`crumb ${isLast ? "current" : ""}`} onClick={() => !isLast && navigate(path)}>
                      {seg}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
          <button
            className="btn ghost sm"
            title="编辑路径"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setEditingSide(side);
              setEditValue(state.cwd);
            }}
          >
            <Pencil style={{ width: 12, height: 12 }} />
          </button>
          <button
            className="btn ghost sm"
            onClick={() => navigate(state.cwd.replace(/[/\\][^/\\]*[/\\]?$/, "") || (isUnix ? "/" : state.cwd))}
            disabled={state.cwd === "/" || segments.length === 0}
          >
            <ArrowUp style={{ width: 14, height: 14 }} />
          </button>
          <button className="btn ghost sm" title="刷新" onClick={() => navigate(state.cwd)}>
            <RotateCw style={{ width: 14, height: 14 }} />
          </button>
          {side === "remote" && (
            <button className="btn ghost sm" title="传输日志" onClick={() => setShowLog(true)}>
              <History style={{ width: 14, height: 14 }} />
            </button>
          )}
          <button className="btn ghost sm" title={swapSides ? "恢复默认左右布局" : "远程/本地左右调换"} onClick={toggleSwapSides}>
            <ArrowLeftRight style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {state.error && <div className="toast error" style={{ margin: 8 }}>{state.error}</div>}

        <div className="sftp-filter-bar">
          <Search style={{ width: 12, height: 12, color: "var(--text-secondary)", flexShrink: 0 }} />
          <input
            className="form-input"
            style={{ flex: 1, height: 22, fontSize: 12 }}
            placeholder="过滤文件名…"
            value={filter[side]}
            onChange={(e) => setFilter((f) => ({ ...f, [side]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter[side]) {
                e.stopPropagation();
                setFilter((f) => ({ ...f, [side]: "" }));
              }
            }}
          />
          {filterQuery && (
            <>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", flexShrink: 0 }}>{visibleEntries.length} 项匹配</span>
              <button className="btn ghost sm" title="清空过滤" onClick={() => setFilter((f) => ({ ...f, [side]: "" }))}>
                <X style={{ width: 12, height: 12 }} />
              </button>
            </>
          )}
        </div>

        <div
          ref={(el) => { listRefs.current[side] = el; }}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          style={{ flex: 1, overflowY: "auto", outline: "none" }}
        >
          <div className="file-header">
            {headerCell("name", "名称")}
            {headerCell("size", "大小")}
            {headerCell("modified", "修改时间")}
          </div>
          {state.loading ? (
            <div style={{ padding: 16, fontSize: 12, color: "var(--text-secondary)" }}>加载中…</div>
          ) : state.entries.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: "var(--text-secondary)" }}>此目录是空的</div>
          ) : visibleEntries.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: "var(--text-secondary)" }}>没有匹配"{filterQuery}"的文件</div>
          ) : (
            visibleEntries.map((entry) => (
              <div
                key={entry.path}
                data-path={entry.path}
                className={`file-row ${state.selectedPath === entry.path ? "selected" : ""}`}
                style={{ cursor: "grab" }}
                onMouseDown={beginDrag({ side, path: entry.path, isDir: entry.is_dir, name: entry.name })}
                onClick={() => {
                  select(entry.path);
                  listRefs.current[side]?.focus();
                }}
                onDoubleClick={() => onRowDoubleClick(entry)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  select(entry.path);
                  setMenu({ x: e.clientX, y: e.clientY, side, entry });
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                  {entry.is_dir ? <Folder className="file-icon is-dir" /> : <FileIcon className="file-icon" />}
                  <span className="file-name">{highlightMatch(entry.name, filterQuery)}</span>
                </span>
                <span className="file-size">{entry.is_dir ? "—" : formatBytes(entry.size)}</span>
                <span className="file-time">{formatTime(entry.modified)}</span>
              </div>
            ))
          )}
        </div>

        <div className="sftp-footer">
          {dirCount} 目录, {fileCount} 文件 · 拖到{(side === "remote") === swapSides ? "左侧" : "右侧"}
          {side === "remote" ? "下载" : "上传"}
          {side === "remote" && " · 也可从资源管理器拖文件到此上传"}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {transfer && (
        <div style={{ padding: "4px 12px", fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            传输中… {transfer.path} {transfer.totalBytes > 0 ? `· ${formatBytes(transfer.bytes)} / ${formatBytes(transfer.totalBytes)}` : transfer.bytes > 0 ? `· ${formatBytes(transfer.bytes)}` : ""}
          </span>
          <button className="btn ghost sm" style={{ flexShrink: 0 }} onClick={() => transferService.cancel(transfer.requestId)}>
            停止
          </button>
        </div>
      )}
      {(() => {
        const remotePane = renderPane(
          "remote",
          <Server style={{ width: 14, height: 14 }} />,
          "远程",
          remote,
          (p) => remote.navigate(profileId, p),
          remote.select,
          (entry) => (entry.is_dir ? remote.navigate(profileId, entry.path) : onOpenFile(entry)),
        );
        const localPane = renderPane(
          "local",
          <Laptop style={{ width: 14, height: 14 }} />,
          "本地",
          local,
          (p) => local.navigate(p),
          local.select,
          (entry) => entry.is_dir && local.navigate(entry.path),
        );
        const [firstPane, secondPane] = swapSides ? [localPane, remotePane] : [remotePane, localPane];
        return (
          <div ref={splitContainerRef} style={{ flex: 1, display: "flex", overflow: "hidden", borderTop: "1px solid var(--border-default)" }}>
            <div style={{ width: `${splitPercent}%`, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {firstPane}
            </div>
            <div className="sftp-pane-resize-handle" onMouseDown={onSplitDragStart} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {secondPane}
            </div>
          </div>
        );
      })()}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.side === "remote" ? remoteMenuItems(menu.entry) : localMenuItems(menu.entry)} onClose={() => setMenu(null)} />
      )}
      {showLog && <TransferLogDialog onClose={() => setShowLog(false)} />}
    </div>
  );
};
