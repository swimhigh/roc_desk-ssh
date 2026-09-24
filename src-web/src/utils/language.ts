/** 文件名 → Monaco 语言 id，覆盖常见文本类型。原样搬自宿主
 * `src-web/src/utils/language.ts`，去掉了 "log" 自定义 Monarch 语言的注释引用——
 * 那是宿主 `monacoSetup.ts` 注册的自定义语言/主题，这个工具没有搬那一套，
 * 用内置的 "log" id 会退回 Monaco 默认高亮（没有自定义 token 配色，但仍然可用）。*/
const EXTENSION_LANGUAGE: Record<string, string> = {
  json: "json",
  jsonc: "jsonc",
  md: "markdown",
  markdown: "markdown",
  log: "log",
  txt: "plaintext",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "shell",
  bash: "shell",
  env: "ini",
  csv: "plaintext",
  sql: "sql",
  lua: "lua",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  dockerfile: "dockerfile",
  mk: "makefile",
  mak: "makefile",
};

const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
};

export function detectLanguage(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const byName = FILENAME_LANGUAGE[fileName.toLowerCase()];
  if (byName) return byName;
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_LANGUAGE[ext] ?? "plaintext";
}
