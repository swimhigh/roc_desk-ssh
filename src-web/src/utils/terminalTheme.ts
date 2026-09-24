import type { ITheme } from "@xterm/xterm";

export type TerminalKind = "ssh" | "agent";

/**
 * Dracula 主题官方 ANSI 数值，原样搬自宿主 `src-web/src/utils/terminalTheme.ts`。
 * 应用主界面可能是浅色主题，但终端画布本身固定深色，不随应用亮/暗切换（用户
 * 2026-09-22 反馈确认过这个设计维持不变，见项目记忆 `feedback_terminal_fixed_dark_theme`）。
 */
const draculaTheme: ITheme = {
  background: "#282A36",
  foreground: "#F8F8F2",
  cursorAccent: "#282A36",
  selectionBackground: "rgba(68, 71, 90, 0.75)",
  selectionInactiveBackground: "rgba(68, 71, 90, 0.4)",

  black: "#21222C",
  red: "#FF5555",
  green: "#50FA7B",
  yellow: "#F1FA8C",
  blue: "#BD93F9",
  magenta: "#FF79C6",
  cyan: "#8BE9FD",
  white: "#F8F8F2",

  brightBlack: "#6272A4",
  brightRed: "#FF6E6E",
  brightGreen: "#69FF94",
  brightYellow: "#FFFFA5",
  brightBlue: "#D6ACFF",
  brightMagenta: "#FF92DF",
  brightCyan: "#A4FFFF",
  brightWhite: "#FFFFFF",
};

export function getTerminalTheme(kind: TerminalKind = "ssh"): ITheme {
  return {
    ...draculaTheme,
    // 本地/远程光标用不同颜色一眼分清当前敲的命令发去哪——这个工具只有远程终端
    // （SSH/Agent），固定橙色光标（原宿主逻辑里 "远程固定橙色" 那一支）。
    cursor: kind === "ssh" || kind === "agent" ? "#FFB000" : "#F8F8F2",
  };
}
