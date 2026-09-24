import React from "react";
import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../../stores/themeStore";

/** 原样搬自宿主 `src-web/src/components/shared/ThemeToggle.tsx`. 挂载在
 * `RemoteTool/HomeShell.tsx` 顶部工具栏右上角，见该文件顶部注释。 */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { theme, toggle } = useThemeStore();
  return (
    <button
      className={className ?? "quick-tool-btn"}
      onClick={toggle}
      title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );
};
