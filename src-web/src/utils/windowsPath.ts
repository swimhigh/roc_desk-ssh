/** Windows（Agent 目标）路径工具：目标机器没有单一根目录 "/" 的概念，用空字符串
 * 表示"此电脑"下的盘符列表这一虚拟层级，选中某个盘符（如 "C:\\"）之后才是真正的
 * 目录路径。原样搬自宿主 `src-web/src/utils/windowsPath.ts`。 */
export const AGENT_ROOT = "";

export function isAgentRoot(path: string): boolean {
  return path === AGENT_ROOT;
}

/** 计算 Windows 路径的上一级：盘符根目录（"C:\\"）的上一级是虚拟的盘符列表
 * （AGENT_ROOT），不是继续往上"越过"盘符本身。 */
export function agentParentPath(path: string): string {
  const trimmed = path.replace(/\\+$/, "");
  const lastSep = trimmed.lastIndexOf("\\");
  if (lastSep <= 2) {
    return AGENT_ROOT;
  }
  return trimmed.slice(0, lastSep);
}
