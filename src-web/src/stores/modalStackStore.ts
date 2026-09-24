import { create } from "zustand";

interface ModalStackState {
  count: number;
  push: () => void;
  pop: () => void;
}

/**
 * 全局弹窗计数，原样搬自宿主 `src-web/src/stores/modalStackStore.ts`. 宿主用它来
 * 在弹窗打开时临时隐藏原生子 WebView（浏览器面板）。这个工具没有内嵌浏览器面板，
 * 但 `ConfirmDialog` 仍然 push/pop 这个计数——保留是为了不需要改 ConfirmDialog
 * 本身的代码，不是因为这里真的有订阅方在用它。
 */
export const useModalStackStore = create<ModalStackState>((set) => ({
  count: 0,
  push: () => set((s) => ({ count: s.count + 1 })),
  pop: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));
