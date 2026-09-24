import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "roc_desk-theme";

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function loadInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" ? "light" : "dark"; // 深色优先，无存储偏好时默认深色，和宿主一致
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

/**
 * 主题切换，原样搬自宿主 `src-web/src/stores/themeStore.ts`——用户明确要求
 * "roc_desk 右上角的主题模式每个工具都需要继承"，这个 store + `ThemeToggle.tsx`
 * + `styles/theme.css` 是这个要求的完整实现（`data-theme` 属性 + `localStorage`，
 * 和宿主/roc_desk-explorer/roc_desk-editor 同一套模式）。
 */
export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = loadInitialTheme();
  applyTheme(initial);
  return {
    theme: initial,
    toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
    setTheme: (theme) => {
      applyTheme(theme);
      localStorage.setItem(STORAGE_KEY, theme);
      set({ theme });
    },
  };
});
