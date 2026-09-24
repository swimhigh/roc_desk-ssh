/** 给终端里滚动的原始文本按日志级别关键字/时间戳/方括号标签加颜色，原样搬自宿主
 * `src-web/src/utils/terminalHighlight.ts`。xterm.js 的 `term.write()` 本身就认
 * ANSI SGR 转义序列，这里只是把匹配到的关键字用同样的转义序列包起来再写进去。
 *
 * **安全边界**：一段数据只要已经含有 ESC（`\x1b`）字符就整段跳过、原样透传——
 * 避免和已有的 ANSI 转义序列插花/嵌套出问题。终端是"绝对不能出错"的地方，宁可
 * 少高亮几行，也不能有内容错乱或丢字节的风险。
 */

const HIGHLIGHT_RE = new RegExp(
  [
    String.raw`\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?`,
    String.raw`\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b`,
    String.raw`\[\s*(?:FATAL|CRITICAL|PANIC)\s*\]`,
    String.raw`\[\s*ERRORS?\s*\]`,
    String.raw`\[\s*WARN(?:ING)?\s*\]`,
    String.raw`\[\s*NOTICE\s*\]`,
    String.raw`\[\s*INFO\s*\]`,
    String.raw`\[\s*(?:DEBUG|TRACE)\s*\]`,
    String.raw`\b(?:FATAL|CRITICAL|PANIC)\b`,
    String.raw`\bERRORS?\b`,
    String.raw`\bWARN(?:ING)?\b`,
    String.raw`\bNOTICE\b`,
    String.raw`\bINFO\b`,
    String.raw`\b(?:DEBUG|TRACE)\b`,
    String.raw`\[[^\]\r\n]*\]`,
  ].join("|"),
  "g",
);

const SGR = {
  error: "\x1b[38;2;229;83;75m",
  warn: "\x1b[38;2;217;164;65m",
  info: "\x1b[38;2;88;166;255m",
  debug: "\x1b[38;2;154;156;161m",
  tag: "\x1b[38;2;79;140;255m",
  reset: "\x1b[0m",
} as const;

function colorFor(match: string): string {
  if (/^\[?\d{4}[-/]/.test(match) || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(match)) {
    return SGR.debug;
  }
  const inner = match.replace(/^\[|\]$/g, "").trim();
  if (/^(FATAL|CRITICAL|PANIC|ERRORS?)$/i.test(inner)) return SGR.error;
  if (/^WARN(ING)?$/i.test(inner)) return SGR.warn;
  if (/^(NOTICE|INFO)$/i.test(inner)) return SGR.info;
  if (/^(DEBUG|TRACE)$/i.test(inner)) return SGR.debug;
  return SGR.tag;
}

export function highlightTerminalChunk(text: string): string {
  if (text.indexOf("\x1b") !== -1) return text;
  return text.replace(HIGHLIGHT_RE, (m) => `${colorFor(m)}${m}${SGR.reset}`);
}
