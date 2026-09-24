import React from "react";
import { useModalStackStore } from "../../stores/modalStackStore";

export type DialogSeverity = "info" | "warning" | "danger";

interface ConfirmDialogProps {
  open: boolean;
  severity?: DialogSeverity;
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
  /** 高危确认类弹窗不响应 Esc / 点击遮罩关闭。*/
  dismissible?: boolean;
  closeOnBackdropClick?: boolean;
  onDismiss?: () => void;
}

/**
 * 所有阻塞式确认弹窗的基座，原样搬自宿主 `src-web/src/components/shared/ConfirmDialog.tsx`。
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  severity = "info",
  icon,
  title,
  children,
  actions,
  dismissible = true,
  closeOnBackdropClick = dismissible,
  onDismiss,
}) => {
  React.useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, dismissible, onDismiss]);

  React.useEffect(() => {
    if (!open) return;
    const { push, pop } = useModalStackStore.getState();
    push();
    return () => pop();
  }, [open]);

  if (!open) return null;

  const titleBarClass = severity === "danger" ? "dialog-title-bar danger" : `dialog-title-bar ${severity}`;

  return (
    <div
      className="dialog-overlay"
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true">
        <div className={titleBarClass}>
          {icon && <span>{icon}</span>}
          <span>{title}</span>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
};
