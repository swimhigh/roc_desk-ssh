import React from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { AgentCertDialog } from "./AgentCertDialog";

/** 和 `HostKeyPromptHost` 是同一种模式，把 `agent:cert-prompt` 事件渲染成弹窗。
 * 原样搬自宿主 `src-web/src/components/ConnectionManager/AgentCertPromptHost.tsx`。*/
export const AgentCertPromptHost: React.FC = () => {
  const prompt = useConnectionStore((s) => s.pendingAgentCertPrompt);
  const resolve = useConnectionStore((s) => s.resolveAgentCertPrompt);

  if (!prompt) return null;

  if (!prompt.changed) {
    return (
      <AgentCertDialog
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
    <AgentCertDialog
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
