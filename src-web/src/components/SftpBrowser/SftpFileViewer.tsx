import React, { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { KeyCode, KeyMod } from "monaco-editor";
import { ExternalLink } from "lucide-react";
import { sftpService } from "../../services/sftpService";
import { detectLanguage } from "../../utils/language";
import { formatError } from "../../utils/error";
import { useToastStore } from "../shared/Toast";
import { useThemeStore } from "../../stores/themeStore";
import { formatBytes } from "../../utils/format";
import { classifyPreview, hasNoExtension, binaryMimeType, type PreviewKind } from "../../utils/previewFile";
import type { WriteOutcome } from "../../types/bindings";

interface SftpFileViewerProps {
  profileId: string;
  path: string;
  onBack: () => void;
}

/**
 * SFTP 快捷工具打开文件的查看器，原样搬自宿主
 * `src-web/src/components/SftpBrowser/SftpFileViewer.tsx` 的文本/图片/PDF 预览路径
 * 和默认只读+显式编辑的交互模式，**但简化了二进制预览**（这是一个刻意的范围
 * 边界，记录在 `docs/MULTI_REPO_SPLIT_PROGRESS.md` 2026-09-23 restoration pass）：
 *
 * 宿主版本对 Word/Excel/旧版 Office/EXE|DLL|SO/JAR 各有一个专门的富预览面板
 * （`components/Editor/ExcelPreview.tsx`/`BinaryInfoPanel.tsx`/`JarInfoPanel.tsx`/
 * `LegacyOfficePreview.tsx`），依赖 `mammoth`/`xlsx`/`dompurify` 三个库——这些是
 * 宿主 Editor 工具生态的一部分，`roc_desk-editor` 才是这些组件的正主。这个仓库
 * 没有把 Editor 工具整套预览组件和依赖搬进来，对这几类文件统一走下面的
 * `RichPreviewUnavailable` 面板："该类型预览需要完整编辑器套件，请用系统程序
 * 打开"——不是功能缺失被隐藏，是明确告知 + 提供替代路径（系统默认程序）。
 * 文本编辑（最常见的 SSH/SFTP 用途：查看/改配置文件、脚本、日志）、图片、PDF
 * 三类是完整实现，不受这个范围边界影响。
 */
export const SftpFileViewer: React.FC<SftpFileViewerProps> = ({ profileId, path, onBack }) => {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<PreviewKind>(() => classifyPreview(path));
  const [mtime, setMtime] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [totalSize, setTotalSize] = useState(0);
  const [dirty, setDirty] = useState(false);
  const push = useToastStore((s) => s.push);
  const monacoTheme = useThemeStore((s) => (s.theme === "dark" ? "vs-dark" : "vs"));
  const isPreviewOnly = kind !== "text";
  const isRichPreviewUnavailable = kind === "word" || kind === "excel" || kind === "executable" || kind === "jar" || kind === "legacy-office" || kind === "unsupported-binary";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditMode(false);
    setDirty(false);

    const fail = (e: unknown) => {
      if (cancelled) return;
      push("error", `打开失败：${formatError(e)}`);
      setLoading(false);
    };

    (async () => {
      let resolvedKind = classifyPreview(path);
      if (resolvedKind === "text" && hasNoExtension(path)) {
        try {
          if (await sftpService.peekIsBinary(profileId, path)) resolvedKind = "executable";
        } catch {
          // 嗅探失败不影响后续正常走文本读取路径。
        }
      }
      if (cancelled) return;
      setKind(resolvedKind);

      if (
        resolvedKind === "unsupported-binary" ||
        resolvedKind === "executable" ||
        resolvedKind === "jar" ||
        resolvedKind === "legacy-office" ||
        resolvedKind === "word" ||
        resolvedKind === "excel"
      ) {
        // 这几类都不读内容——直接给"用系统默认程序打开"的入口，见组件顶部注释。
        setLoading(false);
        return;
      }

      if (resolvedKind === "image" || resolvedKind === "pdf") {
        sftpService.readBinaryPreview(profileId, path).then((base64) => {
          if (cancelled) return;
          setContent(`data:${binaryMimeType(path)};base64,${base64}`);
          setLoading(false);
        }, fail);
        return;
      }

      sftpService.readFile(profileId, path).then((res) => {
        if (cancelled) return;
        setContent(res.text);
        setMtime(res.mtime);
        setTruncated(res.truncated);
        setTotalSize(res.total_size);
        setLoading(false);
      }, fail);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, path]);

  const handleSave = async () => {
    if (isPreviewOnly) {
      push("error", "该文件类型不支持编辑保存");
      return;
    }
    if (truncated) {
      push("error", "文件过大，当前只是只读预览，无法保存");
      return;
    }
    try {
      const outcome: WriteOutcome = await sftpService.writeFile(profileId, path, content, mtime);
      if (outcome.type === "Conflict") {
        push("error", `保存冲突：文件已在别处被修改（当前 mtime ${outcome.current_mtime}），请重新打开后再编辑`);
        return;
      }
      setMtime(outcome.mtime);
      setDirty(false);
      push("success", "已保存");
    } catch (e) {
      push("error", `保存失败：${formatError(e)}`, { label: "重试保存", onClick: handleSave });
    }
  };

  const handleOpenExternally = async () => {
    try {
      await sftpService.openExternally(profileId, path);
    } catch (e) {
      push("error", `打开失败：${formatError(e)}`);
    }
  };

  const fileName = path.split("/").pop() ?? path;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="sftp-toolbar">
        <div className="breadcrumb">
          <span className="crumb" onClick={onBack}>{path.slice(0, path.length - fileName.length).replace(/\/$/, "") || "/"}</span>
          <span className="sep">›</span>
          <span className="crumb current">{fileName}</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          {isPreviewOnly ? (
            <button className="btn ghost sm" onClick={handleOpenExternally} title="用系统默认程序打开">
              <ExternalLink style={{ width: 14, height: 14 }} /> 用系统程序打开
            </button>
          ) : (
            <>
              {dirty && <span className="dirty-dot" title="未保存" />}
              {!editMode ? (
                <button
                  className="btn ghost sm"
                  onClick={() => setEditMode(true)}
                  disabled={truncated}
                  title={truncated ? "文件过大，当前只是只读预览，无法编辑" : undefined}
                >
                  ✎ 编辑
                </button>
              ) : (
                <button className="btn ghost sm" onClick={handleSave}>💾 保存</button>
              )}
            </>
          )}
          <button className="btn ghost sm" onClick={onBack}>↩ 返回</button>
        </div>
      </div>

      {!isPreviewOnly && truncated && (
        <div className="editor-large-file-banner">
          文件过大（{formatBytes(totalSize)}），仅预览前 {formatBytes(content.length)}，只读模式，无法编辑保存。
        </div>
      )}

      {loading ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-secondary)" }}>加载中…</div>
      ) : kind === "image" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)" }}>
          <img src={content} alt={path} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      ) : kind === "pdf" ? (
        <iframe title={path} src={content} style={{ flex: 1, minHeight: 0, border: "none", background: "#fff" }} />
      ) : isRichPreviewUnavailable ? (
        <RichPreviewUnavailable kind={kind} onOpenExternally={handleOpenExternally} />
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            path={path}
            language={detectLanguage(path)}
            value={content}
            theme={monacoTheme}
            onChange={(value) => {
              setContent(value ?? "");
              setDirty(true);
            }}
            onMount={(editor) => {
              editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => {
                if (editMode) handleSave();
              });
            }}
            options={{
              readOnly: !editMode || truncated,
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: true },
              wordWrap: "on",
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      )}
    </div>
  );
};

const KIND_LABEL: Record<string, string> = {
  word: "Word 文档 (.doc/.docx)",
  excel: "Excel 表格 (.xls/.xlsx)",
  executable: "可执行文件 (.exe/.dll/.so)",
  jar: "JAR 包",
  "legacy-office": "旧版 Office 文档",
  "unsupported-binary": "二进制文件",
};

const RichPreviewUnavailable: React.FC<{ kind: PreviewKind; onOpenExternally: () => void }> = ({ kind, onOpenExternally }) => (
  <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--text-secondary)" }}>
    <div>{KIND_LABEL[kind] ?? "该类型文件"}的富预览需要完整编辑器套件（roc_desk-editor 工具），本工具暂不支持内容预览</div>
    <button className="btn primary sm" onClick={onOpenExternally}>
      <ExternalLink style={{ width: 14, height: 14 }} /> 用系统默认程序打开
    </button>
  </div>
);
