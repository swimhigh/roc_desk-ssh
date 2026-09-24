import React from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { HostKeyDialog } from "./HostKeyDialog";

/**
 * 挂载在 App 顶层的全局宿主：把 `ssh:host-key-prompt` 事件渲染成 TOFU / 指纹变化
 * 弹窗，任何终端标签触发的握手都走这一个实例。原样搬自宿主
 * `src-web/src/components/ConnectionManager/HostKeyPromptHost.tsx`。
 */
export const HostKeyPromptHost: React.FC = () => {
  const prompt = useConnectionStore((s) => s.pendingHostKeyPrompt);
  const resolve = useConnectionStore((s) => s.resolveHostKeyPrompt);

  if (!prompt) return null;

  if (!prompt.changed) {
    return (
      <HostKeyDialog
        open
        kind="tofu"
        host={prompt.host}
        fingerprint={prompt.fingerprint}
        onCancel={() => resolve(false)}
        onTrust={() => resolve(true)}
      />
    );
  }

  return (
    <HostKeyDialog
      open
      kind="changed"
      host={prompt.host}
      oldFingerprint={prompt.oldFingerprint ?? ""}
      newFingerprint={prompt.fingerprint}
      onCancel={() => resolve(false)}
      onTrustAnyway={() => resolve(true)}
    />
  );
};
