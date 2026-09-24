/** SFTP 查看器按扩展名分流的文件类型，原样搬自宿主 `src-web/src/utils/previewFile.ts`
 * 的分类表（`classifyPreview`/`hasNoExtension`/`binaryMimeType`），但**不**搬那边
 * 依赖 `mammoth`/`xlsx` 的 Word/Excel 富预览渲染部分——那是宿主 Editor 工具生态的
 * 一部分（`components/Editor/ExcelPreview.tsx` 等），这个仓库没有把 Editor 工具
 * 整套预览组件搬过来（见 `docs/MULTI_REPO_SPLIT_PROGRESS.md` 2026-09-23 restoration
 * pass 的说明：这是一个刻意的范围边界，不是遗漏）。这里分类仍然完整识别
 * word/excel/executable/jar/legacy-office，只是 `SftpFileViewer.tsx` 对这几类统一
 * 展示"该类型预览需要完整编辑器套件，请用系统程序打开"，而不是重新实现一遍
 * mammoth/xlsx/BinaryInfoPanel/JarInfoPanel 那一整条渲染链路。
 */
export type PreviewKind = "text" | "image" | "pdf" | "word" | "excel" | "executable" | "jar" | "legacy-office" | "unsupported-binary";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

const WORD_EXTENSIONS = new Set(["docx"]);
const EXCEL_EXTENSIONS = new Set(["xlsx"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const EXECUTABLE_EXTENSIONS = new Set(["exe", "dll", "so", "dylib"]);
const JAR_EXTENSIONS = new Set(["jar"]);
const LEGACY_OFFICE_EXTENSIONS = new Set(["doc", "xls", "ppt", "pptx"]);

const UNSUPPORTED_BINARY_EXTENSIONS = new Set([
  "zip", "tar", "gz", "7z", "rar",
  "pdb",
  "woff", "woff2", "ttf", "eot",
  "db", "sqlite", "class", "wasm",
  "mp4", "mp3", "wav", "avi", "mov",
]);

function extensionOf(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
}

/** Linux 下的可执行文件习惯上不带扩展名——`classifyPreview` 单看扩展名会把它们
 * 当成普通文本，调用方对这种文件需要额外嗅探文件头前几个字节才能确认是不是 ELF。*/
export function hasNoExtension(path: string): boolean {
  return extensionOf(path) === "";
}

export function classifyPreview(path: string): PreviewKind {
  const ext = extensionOf(path);
  if (ext in IMAGE_MIME) return "image";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (WORD_EXTENSIONS.has(ext)) return "word";
  if (EXCEL_EXTENSIONS.has(ext)) return "excel";
  if (EXECUTABLE_EXTENSIONS.has(ext)) return "executable";
  if (JAR_EXTENSIONS.has(ext)) return "jar";
  if (LEGACY_OFFICE_EXTENSIONS.has(ext)) return "legacy-office";
  if (UNSUPPORTED_BINARY_EXTENSIONS.has(ext)) return "unsupported-binary";
  return "text";
}

export function binaryMimeType(path: string): string {
  const ext = extensionOf(path);
  if (ext in IMAGE_MIME) return IMAGE_MIME[ext];
  if (PDF_EXTENSIONS.has(ext)) return "application/pdf";
  return "application/octet-stream";
}
