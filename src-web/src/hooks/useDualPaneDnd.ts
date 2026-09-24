import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export type PaneSide = "remote" | "local";

export interface DndPayload {
  side: PaneSide;
  path: string;
  isDir: boolean;
  name: string;
}

interface UseDualPaneDndOptions {
  /** 面板内互拖（远程行拖到本地面板 = 下载，反之上传）。*/
  onInternalTransfer: (payload: DndPayload, targetSide: PaneSide) => void;
  /** 从 Windows 资源管理器等外部窗口把真实文件拖进远程面板——本地面板故意不接受
   * 外部拖入，本地面板本来就是本机文件系统，拖进来没有"传输"语义。*/
  onExternalUpload: (paths: string[]) => void;
}

/**
 * SftpBrowser/AgentBrowser 共用的双栏拖拽交互，原样搬自宿主
 * `src-web/src/hooks/useDualPaneDnd.ts`。拆成两条完全独立的路径：
 *
 * 1. 面板内互拖，刻意不用浏览器原生 HTML5 Drag and Drop——Tauri 窗口
 *    `dragDropEnabled` 默认就是 `true`（第 2 点的外部文件拖入要靠它），会让
 *    Windows 上的 WebView2 整个吃掉 HTML5 拖拽事件。这里改用最朴素的鼠标事件
 *    手搓一套"虚拟拖拽"，完全绕开浏览器的 DnD API。
 *
 * 2. 外部文件拖入用 Tauri 自己的 `onDragDropEvent`，坐标是物理像素，要按
 *    devicePixelRatio 换算成 CSS 像素才能判断落在哪个面板的 DOM 矩形里。
 */
export function useDualPaneDnd({ onInternalTransfer, onExternalUpload }: UseDualPaneDndOptions) {
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const [dragOverSide, setDragOverSide] = useState<PaneSide | null>(null);

  const onExternalUploadRef = useRef(onExternalUpload);
  onExternalUploadRef.current = onExternalUpload;

  const sideAtPoint = (clientX: number, clientY: number): PaneSide | null => {
    const remoteRect = remoteRef.current?.getBoundingClientRect();
    if (remoteRect && clientX >= remoteRect.left && clientX <= remoteRect.right && clientY >= remoteRect.top && clientY <= remoteRect.bottom) {
      return "remote";
    }
    const localRect = localRef.current?.getBoundingClientRect();
    if (localRect && clientX >= localRect.left && clientX <= localRect.right && clientY >= localRect.top && clientY <= localRect.bottom) {
      return "local";
    }
    return null;
  };

  const beginDrag = (payload: DndPayload) => (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只认左键，右键要留给右键菜单
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const side = sideAtPoint(ev.clientX, ev.clientY);
      setDragOverSide(side && side !== payload.side ? side : null);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const side = sideAtPoint(ev.clientX, ev.clientY);
      setDragOverSide(null);
      if (side && side !== payload.side) onInternalTransfer(payload, side);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const fn = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDragOverSide(null);
          return;
        }
        const ratio = window.devicePixelRatio || 1;
        const side = sideAtPoint(event.payload.position.x / ratio, event.payload.position.y / ratio);
        if (event.payload.type === "drop") {
          setDragOverSide(null);
          if (side === "remote" && event.payload.paths.length > 0) onExternalUploadRef.current(event.payload.paths);
          return;
        }
        setDragOverSide(side === "remote" ? "remote" : null);
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { remoteRef, localRef, dragOverSide, beginDrag };
}
